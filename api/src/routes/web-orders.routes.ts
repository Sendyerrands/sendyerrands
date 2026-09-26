import { randomBytes } from 'node:crypto';

import { OrderStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { badRequest, notFound } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { normalisePhone, orderReference, paymentReference, referralCode } from '@/lib/reference';
import { asyncHandler, validate, webBookingLimiter } from '@/middleware';

/**
 * The website's booking surface.
 *
 * Deliberately NOT part of ordersRouter: that router does
 * `requireAuth('customer')` for every route in it, and these two cannot be
 * authenticated — the website books without an account and always has ("no
 * account needed to start" is on the page). Keeping them in their own router
 * means the public surface is exactly these two endpoints and is visible as
 * such, rather than being one unguarded route hiding inside an otherwise
 * protected file.
 *
 * Nothing here modifies an existing endpoint. The app's own create paths are
 * untouched.
 */
export const webOrdersRouter = Router();

const bookingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(10).max(20),
  altPhone: z.string().trim().min(10).max(20).optional(),
  email: z.string().trim().email().max(190).optional(),
  /// One of the website's service categories, e.g. "Market Shopping".
  service: z.string().trim().min(2).max(80),
  pickupAddress: z.string().trim().min(4).max(240),
  dropoffAddress: z.string().trim().min(4).max(240),
  details: z.string().trim().max(1000).optional(),
  /**
   * Optional, and the caller decides what it means. The website derives one
   * per booking so that a form resubmitted after a timeout resolves to the
   * order that was already created rather than a second one. Absent, the
   * request is treated as new every time — which is the old behaviour, and
   * still correct for a caller that can tell whether its request landed.
   */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

type Booking = z.infer<typeof bookingSchema>;

/** The only columns a booking response is ever built from. */
const ORDER_RESULT = { id: true, reference: true, status: true, createdAt: true } as const;

/**
 * `id` is the tracking key, not `reference`. The reference is sequential and
 * therefore guessable, so handing it out as the lookup key would let anyone
 * counting upwards read a stranger's addresses and phone number. The cuid is
 * unguessable — the same property the old PHP site got from a separate
 * `track_token` column, without needing the column.
 */
function bookingResponse(order: {
  id: string;
  reference: string;
  status: OrderStatus;
  createdAt: Date;
}) {
  return {
    reference: order.reference,
    trackingId: order.id,
    status: order.status,
    createdAt: order.createdAt,
  };
}

/**
 * A website booking has no account behind it, but Order.customerId is required
 * and every query in the system assumes a customer is there. Rather than make
 * that column nullable — which would mean auditing every read path in the app
 * and the admin for a null it has never had to handle — a booking mints the
 * customer it implies.
 *
 * Phone is the identity, because it is what the business actually uses: the
 * whole flow runs over WhatsApp. So a returning caller is recognised, and their
 * web bookings and app orders end up on one customer rather than two.
 */
async function findOrCreateWebCustomer(booking: {
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
}) {
  const existing = await prisma.user.findUnique({ where: { phone: booking.phone } });
  if (existing) return existing;

  /**
   * Email is required and unique, but the booking form does not have to collect
   * one. The synthesised address uses the `.invalid` TLD, which RFC 2606
   * reserves precisely so it can never resolve — a placeholder on a real domain
   * would eventually have mail sent to it, and either bounce or, if a catch-all
   * is ever enabled, reach a stranger.
   */
  const email = booking.email ?? `${booking.phone.replace('+', '')}@web.sendyerrands.invalid`;

  /**
   * There is no password, and there must not be a guessable one. Hashing random
   * bytes leaves an account that cannot be signed into by anybody, including
   * whoever booked — they become a real customer only by going through the
   * existing password-reset flow, which proves they hold the number.
   */
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

  try {
    return await prisma.user.create({
      data: {
        email,
        phone: booking.phone,
        passwordHash,
        firstName: booking.firstName,
        lastName: booking.lastName,
        referralCode: referralCode(booking.firstName),
      },
    });
  } catch (err) {
    /**
     * Two bookings from the same number at once, or an email that is already
     * taken by an account under a different number. Re-reading by phone settles
     * the first; the second is a genuine clash the caller has to resolve, since
     * silently attaching the order to someone else's account would be worse
     * than failing.
     */
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.user.findUnique({ where: { phone: booking.phone } });
      if (raced) return raced;
      throw badRequest('That email address is already in use by another account. Leave it blank, or use the address you registered with.');
    }
    throw err;
  }
}

/** POST /web/orders — a booking from the website, with no account behind it. */
webOrdersRouter.post(
  '/orders',
  webBookingLimiter,
  validate(bookingSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as Booking;

    const phone = normalisePhone(body.phone);
    if (!phone) {
      throw badRequest('That phone number does not look right. Use the number you use for WhatsApp, like 08031234567.');
    }

    // Optional, so a number we cannot parse is dropped rather than failing the
    // whole booking — it is a convenience for the dispatcher, not the contact.
    const altPhone = body.altPhone ? normalisePhone(body.altPhone) : null;

    /**
     * The form collects one name field, because that is what someone typing on
     * a phone will fill in. Anything after the first word becomes the surname,
     * and a single word leaves it empty — an empty surname is honest, where a
     * placeholder like "(none)" would show up in the dashboard as if the person
     * had typed it.
     */
    const [firstName = body.name, ...rest] = body.name.split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ');

    /**
     * Resolved before anything is written. A retry must not mint a customer and
     * an address on its way to discovering the order already exists — those
     * would be orphans left behind by a request that ultimately changes nothing.
     */
    if (body.idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
        select: ORDER_RESULT,
      });
      if (existing) {
        // 200, not 201: this request created nothing.
        res.status(200).json({ data: bookingResponse(existing) });
        return;
      }
    }

    const customer = await findOrCreateWebCustomer({ phone, email: body.email, firstName, lastName });

    const notes = [body.details, altPhone ? `Alternate contact: ${altPhone}` : null]
      .filter(Boolean)
      .join('\n\n');

    try {
      const order = await prisma.order.create({
        data: {
          reference: orderReference(),
          type: 'ERRAND',
          channel: 'WEB',
          idempotencyKey: body.idempotencyKey ?? null,
          /**
           * Not PENDING_PAYMENT. The website takes nothing online — the price is
           * agreed on WhatsApp and settled in cash or by transfer on completion —
           * which is exactly what QUOTE_REQUESTED already describes for errands.
           */
          status: 'QUOTE_REQUESTED',
          // `connect` rather than a bare customerId: Prisma treats a create as
          // either all scalar foreign keys or all relation writes, and nesting
          // the address below puts this one in the latter camp.
          customer: { connect: { id: customer.id } },
          /**
           * Nested, so the address and the order succeed or fail as one. Created
           * separately and first, a duplicate key colliding on the order would
           * leave the address orphaned behind it.
           *
           * The destination lives in an Address rather than free text so the
           * admin dashboard reads a web order's drop-off through the relation it
           * already uses for app orders — no dashboard-side special-casing.
           */
          address: {
            create: {
              userId: customer.id,
              label: 'Website booking',
              line1: body.dropoffAddress,
              contact: body.name,
              phone,
            },
          },
          errandDetail: {
            create: {
              task: body.service,
              details: notes || null,
              pickupName: body.name,
              pickupAddress: body.pickupAddress,
            },
          },
        },
        select: ORDER_RESULT,
      });

      res.status(201).json({ data: bookingResponse(order) });
    } catch (err) {
      /**
       * Two submissions of one booking racing each other: the first took the
       * unique key, this one lost. The customer asked for a single errand and it
       * exists, so return it rather than an error for a booking that did in fact
       * go through.
       */
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        body.idempotencyKey
      ) {
        const raced = await prisma.order.findUnique({
          where: { idempotencyKey: body.idempotencyKey },
          select: ORDER_RESULT,
        });
        if (raced) {
          res.status(200).json({ data: bookingResponse(raced) });
          return;
        }
      }
      throw err;
    }
  })
);

/** GET /web/orders/:trackingId — public tracking, no account required. */
webOrdersRouter.get(
  '/orders/:trackingId',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.trackingId },
      /**
       * Curated, never `include: { … }` wholesale. This response is raw JSON
       * with nothing downstream to filter it, so anything selected here is
       * published to whoever holds the link. The customer's email, the rider's
       * phone and every money column are deliberately absent.
       */
      select: {
        reference: true,
        status: true,
        channel: true,
        createdAt: true,
        assignedAt: true,
        deliveredAt: true,
        errandDetail: { select: { task: true, pickupAddress: true } },
        address: { select: { line1: true } },
        rider: { select: { firstName: true } },
      },
    });

    if (!order) throw notFound('Order');

    res.json({
      data: {
        reference: order.reference,
        status: order.status,
        service: order.errandDetail?.task ?? null,
        pickupAddress: order.errandDetail?.pickupAddress ?? null,
        dropoffAddress: order.address?.line1 ?? null,
        riderFirstName: order.rider?.firstName ?? null,
        createdAt: order.createdAt,
        assignedAt: order.assignedAt,
        deliveredAt: order.deliveredAt,
      },
    });
  })
);

/**
 * GET /web/services — the bookable service catalogue.
 *
 * This is the endpoint that lets the website stop reading MySQL. The PHP
 * booking form queries its own `services` table on every page load to render
 * the picker and its prices, which is the last thing binding that form to the
 * old database.
 *
 * Public and unauthenticated, because the page that needs it is public. It
 * publishes nothing a visitor cannot already see printed on the site.
 */
webOrdersRouter.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        slug: true,
        name: true,
        shortDescription: true,
        icon: true,
        baseFeeKobo: true,
      },
    });

    res.json({
      data: services.map((s) => ({
        ...s,
        // Naira alongside kobo: the PHP side formats prices in naira, and
        // making it divide by 100 itself invites one of them getting it wrong.
        baseFeeNaira: s.baseFeeKobo / 100,
      })),
    });
  })
);

const supportSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190).optional(),
  phone: z.string().trim().min(10).max(20).optional(),
  subject: z.string().trim().min(3).max(150),
  category: z
    .enum(['ORDER_ISSUE', 'MISSING_ITEM', 'DELIVERY_PROBLEM', 'REFUND_REQUEST', 'PAYMENT_ISSUE', 'GENERAL'])
    .default('GENERAL'),
  message: z.string().trim().min(5).max(4000),
  /** The tracking id from a booking, when the question is about one errand. */
  trackingId: z.string().trim().max(60).optional(),
});

/**
 * POST /web/support — a request for help from the website.
 *
 * Recorded so ops can see it and track whether it was dealt with. The reply
 * does not happen here: support runs on WhatsApp and the mailbox behind the
 * domain's MX, which is where the customer already is.
 */
webOrdersRouter.post(
  '/support',
  webBookingLimiter,
  validate(supportSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof supportSchema>;

    const phone = body.phone ? normalisePhone(body.phone) : null;

    // Linked when the reference resolves, ignored when it does not — a typo in
    // a tracking id must not lose the request.
    let orderId: string | null = null;
    let userId: string | null = null;
    if (body.trackingId) {
      const order = await prisma.order.findUnique({
        where: { id: body.trackingId },
        select: { id: true, customerId: true },
      });
      if (order) {
        orderId = order.id;
        userId = order.customerId;
      }
    }

    // Falling back to the phone means a returning customer's requests gather
    // under the account they already have.
    if (!userId && phone) {
      const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (user) userId = user.id;
    }

    const request = await prisma.supportRequest.create({
      data: {
        reference: paymentReference('SUP'),
        userId,
        orderId,
        name: body.name,
        email: body.email ?? null,
        phone: phone ?? body.phone ?? null,
        subject: body.subject,
        category: body.category,
        message: body.message,
      },
      select: { reference: true, createdAt: true },
    });

    res.status(201).json({
      data: {
        reference: request.reference,
        createdAt: request.createdAt,
        // Said here so the page can tell the customer the truth about what
        // happens next, rather than implying someone is typing a reply.
        nextStep: 'We reply on WhatsApp or by email, usually within opening hours.',
      },
    });
  })
);

/**
 * GET /web/reviews — published customer reviews for the public site.
 *
 * Only PUBLISHED rows are ever returned: a review sits in the moderation queue
 * until someone has read it, and this endpoint is the public side of that.
 *
 * Names are cut to a first name and a surname initial ("Adaeze O."), which is
 * how the site has always shown them. A full name attached to a delivery
 * address is more than a customer agreed to publish by leaving a rating.
 */
webOrdersRouter.get(
  '/reviews',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const reviews = await prisma.review.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        overallRating: true,
        comment: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
        order: { select: { errandDetail: { select: { task: true } } } },
      },
    });

    res.json({
      data: reviews.map((r) => ({
        id: r.id,
        rating: r.overallRating,
        comment: r.comment,
        createdAt: r.createdAt,
        author: `${r.customer.firstName} ${r.customer.lastName.charAt(0)}${r.customer.lastName ? '.' : ''}`.trim(),
        service: r.order.errandDetail?.task ?? null,
      })),
    });
  })
);
