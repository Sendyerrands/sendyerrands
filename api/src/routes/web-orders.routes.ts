import { randomBytes } from 'node:crypto';

import { OrderStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, notFound } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { deliveryCode, normalisePhone, orderReference, paymentReference, referralCode } from '@/lib/reference';
import { asyncHandler, validate, webBookingLimiter } from '@/middleware';
import { createUploadSignature } from '@/services/cloudinary';
import { transitionOrder } from '@/services/orders';
import { initializeTransaction } from '@/services/paystack';

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

/**
 * An HTML form submits every field it has, so an untouched optional input
 * arrives as `""` rather than being absent. Zod's `.optional()` means "may be
 * undefined", not "may be empty" — so a booking from someone who skipped the
 * optional email field was rejected outright with "Invalid email".
 *
 * Blank is how a form says nothing, so blank is read as nothing here.
 */
const blankAsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const bookingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(10).max(20),
  altPhone: blankAsAbsent(z.string().trim().min(10).max(20)),
  email: blankAsAbsent(z.string().trim().email().max(190)),
  /// One of the website's service categories, e.g. "Market Shopping".
  service: z.string().trim().min(2).max(80),
  /**
   * One character, not four.
   *
   * The website's own form has no minimum, so a four-character floor here
   * rejected a booking the form had already accepted — and the customer saw
   * "we could not submit your booking", which names nothing they could fix.
   * A short address is a quality problem for the dispatcher to sort out on
   * WhatsApp, which happens on every booking anyway; a lost booking is not
   * recoverable. Matching the form is what keeps the two from disagreeing.
   */
  pickupAddress: z.string().trim().min(1).max(240),
  dropoffAddress: z.string().trim().min(1).max(240),
  /** How to find the door once the rider is on the street. */
  landmark: blankAsAbsent(z.string().trim().max(160)),
  details: blankAsAbsent(z.string().trim().max(1000)),
  /**
   * Optional, and the caller decides what it means. The website derives one
   * per booking so that a form resubmitted after a timeout resolves to the
   * order that was already created rather than a second one. Absent, the
   * request is treated as new every time — which is the old behaviour, and
   * still correct for a caller that can tell whether its request landed.
   */
  idempotencyKey: blankAsAbsent(z.string().trim().min(8).max(200)),
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

    /**
     * Sendy's own fee, from the service catalogue, at booking time.
     *
     * A web booking used to be created with every money column at zero, so the
     * dispatch fee had to be typed into the dashboard by hand on every single
     * order before anything could be charged. The rider already reports the
     * item price from the market; this is the other half, and unlike the item
     * price it is knowable the moment a service is picked.
     *
     * Base fee only. The catalogue also carries PER_KM and an urgency
     * multiplier, inherited from the contractors' data, and neither can ever be
     * applied — nothing in this system measures distance or flags an order as
     * urgent. Using them would be inventing a number.
     *
     * The website posts the service's display name; the slug is accepted too so
     * a caller using either works. An unmatched service leaves the fee at zero
     * and ops set it by hand, which is the old behaviour — a booking is never
     * refused over a catalogue miss.
     */
    const service = await prisma.service.findFirst({
      where: {
        isActive: true,
        OR: [
          { name: { equals: body.service, mode: 'insensitive' } },
          { slug: { equals: body.service, mode: 'insensitive' } },
        ],
      },
      select: { slug: true, baseFeeKobo: true },
    });
    const serviceFeeKobo = service?.baseFeeKobo ?? 0;
    if (!service) {
      console.warn(`[web booking] no catalogue match for service "${body.service}" — fee left at 0`);
    }

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
          /**
           * What this customer owes Sendy. The item cost is NOT part of it —
           * that goes to the seller directly and Sendy never touches it.
           */
          serviceFeeKobo,
          totalKobo: serviceFeeKobo,
          /**
           * The 4-digit code the customer reads out at the door.
           *
           * Every other create path mints one; this one did not, and the effect
           * was invisible until the last possible moment. The rider's DELIVERED
           * step compares the code it is given against this column, so a null
           * here can never match — every website delivery would have been
           * rejected at the doorstep with "that code does not match", after the
           * errand was already run.
           */
          deliveryCode: deliveryCode(),
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
              /**
               * "Opposite the blue gate" — the schema's own comment says this
               * matters more than a street number here, and it was right. Much
               * of Lagos has patchy street naming, so this is frequently the
               * only thing that actually gets a rider to the door. The column
               * existed and nothing filled it.
               */
              landmark: body.landmark ?? null,
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
        id: true,
        reference: true,
        status: true,
        channel: true,
        createdAt: true,
        assignedAt: true,
        deliveredAt: true,
        /**
         * What this customer owes Sendy, and nothing else.
         *
         * The fee breakdown, the rider's cut and the goods budget all stay out:
         * they are internal, and the amount due is the only figure the person
         * holding this link has to act on. Published because it is their own
         * order and the token is unguessable — not because money columns are
         * safe here generally.
         */
        totalKobo: true,
        /**
         * The lines behind that total.
         *
         * Withheld at first on the grounds that money columns are internal,
         * which was too broad a rule: a delivery fee and a service fee are what
         * this customer is being charged and what any receipt is expected to
         * itemise. The genuinely internal figure is riderPayoutKobo — what
         * Sendy keeps versus what the rider earns is nobody else's business —
         * and that stays out.
         */
        deliveryFeeKobo: true,
        serviceFeeKobo: true,
        /**
         * The customer's own door code. Published here because the customer is
         * the only person who is supposed to have it — they read it to the
         * rider, and the rider cannot complete the delivery without it. Keeping
         * it from this page would leave the one person who needs it unable to
         * find it anywhere.
         */
        deliveryCode: true,
        payments: { where: { status: 'SUCCESS' }, select: { amountKobo: true } },
        /**
         * The errand pricing state, so the website can run the same loop the
         * app does: the rider reports what the item actually costs and whose
         * account to pay, and the customer accepts or walks away.
         *
         * merchantAccountName is Paystack's answer, never what the rider typed
         * — see POST /rider/jobs/:id/quote. Publishing it is the entire safety
         * property of paying a stranger's account: the customer reads the name
         * before they transfer, and a rider entering their own number has to
         * watch their own name appear here.
         */
        errandDetail: {
          select: {
            task: true,
            pickupAddress: true,
            actualItemKobo: true,
            merchantAccountNo: true,
            merchantAccountName: true,
            merchantBankName: true,
            merchantPaidAt: true,
            paymentProofUrl: true,
          },
        },
        address: { select: { line1: true } },
        rider: { select: { firstName: true } },
      },
    });

    if (!order) throw notFound('Order');

    const paidKobo = order.payments.reduce((sum, p) => sum + p.amountKobo, 0);
    const amountDueKobo = Math.max(0, order.totalKobo - paidKobo);
    const settled = ['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status);

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
        totalKobo: order.totalKobo,
        deliveryFeeKobo: order.deliveryFeeKobo,
        serviceFeeKobo: order.serviceFeeKobo,
        paidKobo,
        amountDueKobo,
        // Withheld once the errand is closed: a delivered order's code proves
        // nothing and is one more secret sitting on a shareable link.
        deliveryCode: settled ? null : order.deliveryCode,
        /**
         * Whether to offer a Pay now button at all. An unpriced errand has
         * nothing to charge for, and a cancelled one must not take money.
         * Paying is optional either way — cash on delivery is still how most
         * of these settle — so this being false is not an error state.
         */
        canPayOnline: order.totalKobo > 0 && amountDueKobo > 0 && !settled,

        /**
         * The errand's own pricing stage, mirroring the app.
         *
         * itemCostKobo is what the customer pays the SELLER directly — it is
         * not part of totalKobo and Sendy never touches it. Keeping the two
         * apart in the payload is what stops the website doing what the admin
         * drawer once did and presenting the goods budget as a Sendy charge.
         */
        itemCostKobo: order.errandDetail?.actualItemKobo ?? null,
        merchant: order.errandDetail?.merchantAccountNo
          ? {
              accountNumber: order.errandDetail.merchantAccountNo,
              accountName: order.errandDetail.merchantAccountName,
              bankName: order.errandDetail.merchantBankName,
            }
          : null,
        merchantPaidAt: order.errandDetail?.merchantPaidAt ?? null,
        paymentProofUrl: order.errandDetail?.paymentProofUrl ?? null,
        /**
         * Accepting means "I have transferred the item cost to that account",
         * and the dispatch fee has to be settled first — the same ordering the
         * app enforces, for the same reason: once the rider is told the seller
         * is paid they collect the goods and the job is done.
         */
        canAcceptPrice:
          order.status === 'PRICE_PROPOSED' &&
          !!order.errandDetail?.merchantAccountNo &&
          amountDueKobo === 0,
        /**
         * Declining is an ordinary cancel, offered only while it is still free
         * to walk away. Once the seller has been paid there is nothing to
         * cancel — that money is gone from Sendy's reach entirely.
         */
        canDecline: ['QUOTE_REQUESTED', 'PRICE_PROPOSED'].includes(order.status),
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
 * POST /web/orders/:trackingId/pay — start a card payment for a web booking.
 *
 * Public, and authorised by the tracking token alone. That token is a cuid the
 * customer was handed at booking and is the same thing that already exposes the
 * order's status — there is no account to sign into, because a web booking
 * deliberately never creates a password. What it authorises is narrow: begin a
 * payment TO this order. It cannot move money out, change an address or cancel
 * anything.
 *
 * WHAT IS BEING CHARGED
 *
 * Only what the customer owes Sendy — the delivery and service fee. The cost of
 * the goods never passes through here; it goes from the customer to the
 * merchant, exactly as in the app. That is a deliberate limit on how much of
 * other people's money sits on the platform: a disputed ₦45,000 grocery run
 * never lands on the Paystack balance, so there is nothing to refund and
 * nothing to hold.
 *
 * Paying is optional. Cash on delivery still works and is how most of these
 * settle; this is a convenience, not a gate on dispatch.
 */
webOrdersRouter.post(
  '/orders/:trackingId/pay',
  webBookingLimiter,
  validate(
    z.object({
      /** Where Paystack returns the customer. Must be on our own site. */
      callbackUrl: z.string().trim().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const trackingId = req.params.trackingId!;
    const { callbackUrl: requestedCallback } = req.body as { callbackUrl?: string };

    /**
     * Paystack sends the browser wherever this points once payment finishes, so
     * it is not something a caller gets to choose freely — that is a redirect
     * off our own checkout to anywhere, laundered through a domain the customer
     * just decided to trust with their card. Anything unrecognised is dropped
     * rather than rejected: Paystack then uses the callback configured on the
     * dashboard, and the payment still completes.
     */
    const ALLOWED_CALLBACK_ORIGINS = [
      'https://sendyerrands.com',
      'https://www.sendyerrands.com',
    ];
    const callbackUrl =
      requestedCallback && ALLOWED_CALLBACK_ORIGINS.some((origin) => requestedCallback.startsWith(origin + '/'))
        ? requestedCallback
        : undefined;

    const order = await prisma.order.findUnique({
      where: { id: trackingId },
      select: {
        id: true,
        reference: true,
        status: true,
        channel: true,
        totalKobo: true,
        customer: { select: { email: true, phone: true } },
        payments: {
          where: { status: { in: ['SUCCESS', 'PENDING'] } },
          select: { id: true, status: true, amountKobo: true, provider: true, authorizationUrl: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) throw notFound('Order');

    if (order.totalKobo <= 0) {
      throw badRequest('This errand has not been priced yet. We will confirm the amount with you first.');
    }

    if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw conflict('This errand is closed, so there is nothing to pay.');
    }

    const paidKobo = order.payments
      .filter((p) => p.status === 'SUCCESS')
      .reduce((sum, p) => sum + p.amountKobo, 0);
    const dueKobo = order.totalKobo - paidKobo;

    if (dueKobo <= 0) throw conflict('This errand is already paid for.');

    /**
     * Reuse a checkout that is still good rather than minting another.
     *
     * A customer who closes the Paystack tab and presses Pay again would
     * otherwise leave a trail of abandoned PENDING rows, each one looking like
     * money in flight on the Payments page. Paystack keeps an unpaid
     * authorization alive for about an hour.
     */
    const reusable = order.payments.find(
      (p) =>
        p.status === 'PENDING' &&
        p.provider === 'PAYSTACK' &&
        p.authorizationUrl &&
        p.amountKobo === dueKobo &&
        Date.now() - p.createdAt.getTime() < 45 * 60 * 1000
    );

    if (reusable?.authorizationUrl) {
      return res.json({
        data: { authorizationUrl: reusable.authorizationUrl, amountKobo: dueKobo, reused: true },
      });
    }

    /**
     * Paystack requires an email. A web booking that collected none has a
     * synthesised `.invalid` address, which is syntactically valid and
     * guaranteed never to resolve — so Paystack accepts it and no receipt is
     * ever sent into the void. The customer sees their receipt on screen.
     */
    const email =
      order.customer?.email ?? `${(order.customer?.phone ?? 'web').replace('+', '')}@web.sendyerrands.invalid`;

    // PSK-WEB, so app and website transactions are separable in Paystack's own
    // dashboard search and CSV exports, where metadata is not always carried.
    const reference = paymentReference('PSK-WEB');

    const init = await initializeTransaction({
      email,
      amountKobo: dueKobo,
      reference,
      metadata: {
        orderId: order.id,
        orderReference: order.reference,
        /**
         * Not `channel`. Paystack already uses that word for card/bank/USSD on
         * every transaction it returns, and two fields of the same name meaning
         * different things is a reconciliation bug waiting to happen.
         */
        source: order.channel,
        custom_fields: [
          { display_name: 'Order', variable_name: 'order_reference', value: order.reference },
          { display_name: 'Booked from', variable_name: 'source', value: order.channel === 'WEB' ? 'Website' : 'Mobile app' },
        ],
      },
      ...(callbackUrl ? { callbackUrl } : {}),
    });

    // Paystack answers in snake_case; the Payment column is camelCase.
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'PAYSTACK',
        reference,
        amountKobo: dueKobo,
        status: 'PENDING',
        authorizationUrl: init.authorization_url,
      },
    });

    res.status(201).json({
      data: { authorizationUrl: init.authorization_url, amountKobo: dueKobo, reused: false },
    });
  })
);

/**
 * The errand loop, website side.
 *
 * These are the two answers only the customer can give once a rider has stood
 * at the stall and reported the real price: yes, I have paid the seller — or
 * no, not at that price. The app has had both since the errand flow was built;
 * the website had neither, so a web errand reached PRICE_PROPOSED and stopped
 * there with nothing on the page to move it.
 *
 * Authorised by holding the tracking link, like every other /web endpoint. The
 * id is a random token, not a sequence, and it is the same authority that
 * already lets the holder pay the order and read the door code.
 */

/**
 * POST /web/orders/:trackingId/receipt-signature
 *
 * Lets a website customer attach a PHOTO of their transfer receipt instead of
 * a link to one.
 *
 * The field on the track page asked for a URL, and almost nobody has one: a
 * bank app hands you a screenshot, not a shareable address. So the only proof
 * most customers could actually produce was the one thing the form would not
 * take, and the field went unused.
 *
 * Authorised by the tracking id alone, like merchant-paid and decline either
 * side of it — that token is what the customer was handed at booking and is
 * already what authorises confirming the payment itself. Narrowed on purpose:
 * one fixed folder the caller cannot choose, rate-limited, and only while the
 * order is at a status where a receipt means anything. An order anyone can
 * name must not become free image hosting.
 */
webOrdersRouter.post(
  '/orders/:trackingId/receipt-signature',
  webBookingLimiter,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.trackingId! },
      select: { id: true, status: true },
    });
    if (!order) throw notFound('Order');

    // PRICE_PROPOSED is where the customer is about to confirm; MERCHANT_PAID
    // covers adding the receipt they forgot the first time.
    if (order.status !== 'PRICE_PROPOSED' && order.status !== 'MERCHANT_PAID') {
      throw conflict('There is nothing to attach a receipt to on this order.');
    }

    // `errand-photos` rather than a new folder: this is the same kind of
    // artefact the app already files there for the same orders.
    res.json({ data: createUploadSignature('errand-photos') });
  })
);

/**
 * POST /web/orders/:trackingId/merchant-paid
 *
 * Records a CLAIM that the customer transferred the item cost to the seller,
 * exactly as POST /orders/:id/merchant-paid does for the app. Sendy never sees
 * that money — it goes bank to bank — so there is no transaction to verify
 * against. What this gives a later dispute is a timestamp, the resolved account
 * name the customer was shown, and their receipt.
 */
webOrdersRouter.post(
  '/orders/:trackingId/merchant-paid',
  validate(z.object({ proofUrl: z.string().url().optional() })),
  asyncHandler(async (req, res) => {
    const { proofUrl } = req.body as { proofUrl?: string };

    const order = await prisma.order.findUnique({
      where: { id: req.params.trackingId! },
      select: {
        id: true,
        status: true,
        type: true,
        totalKobo: true,
        errandDetail: { select: { merchantAccountNo: true } },
        payments: { where: { status: 'SUCCESS' }, select: { amountKobo: true } },
      },
    });

    if (!order) throw notFound('Order');
    if (order.type !== 'ERRAND') throw badRequest('That order is not an errand.');
    if (order.status !== 'PRICE_PROPOSED') {
      throw conflict(
        order.status === 'QUOTE_REQUESTED'
          ? 'No rider has priced this errand yet.'
          : 'This errand is past the payment stage.'
      );
    }
    // Without a resolved merchant there is nothing the customer could have
    // paid, and nothing a dispute could point at.
    if (!order.errandDetail?.merchantAccountNo) {
      throw badRequest('The rider has not provided the seller’s account yet.');
    }

    /**
     * The dispatch fee first, the same ordering the app enforces. It is the
     * only enforcement point there is: Sendy never touches the item money, so
     * the fee is the entire commercial relationship, and once the rider is told
     * the seller has been paid they collect the goods and the job is done.
     */
    const paidKobo = order.payments.reduce((sum, p) => sum + p.amountKobo, 0);
    if (paidKobo < order.totalKobo) {
      throw conflict('Pay the Sendy Errands dispatch fee first.');
    }

    await prisma.errandDetail.update({
      where: { orderId: order.id },
      data: { merchantPaidAt: new Date(), paymentProofUrl: proofUrl },
    });

    // No customer account behind a web booking, so the actor is the order
    // itself rather than a signed-in person.
    const updated = await transitionOrder(order.id, 'MERCHANT_PAID', { type: 'system', id: order.id });

    res.json({ data: { status: updated.status } });
  })
);

/**
 * POST /web/orders/:trackingId/decline — the customer will not pay that price.
 *
 * An ordinary cancel, named for what the customer is actually doing. Allowed
 * only while walking away is still free: once MERCHANT_PAID is recorded the
 * money has left their bank for a stranger's, and cancelling there would close
 * the order while the website pretended to have handled something it has no
 * power over.
 */
webOrdersRouter.post(
  '/orders/:trackingId/decline',
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };

    const order = await prisma.order.findUnique({
      where: { id: req.params.trackingId! },
      select: { id: true, status: true },
    });

    if (!order) throw notFound('Order');
    if (!['QUOTE_REQUESTED', 'PRICE_PROPOSED'].includes(order.status)) {
      throw conflict(
        order.status === 'MERCHANT_PAID'
          ? 'You have already paid the seller for this one, and that transfer cannot be reversed from here. Contact support.'
          : 'This errand can no longer be declined. Contact support.'
      );
    }

    const updated = await transitionOrder(
      order.id,
      'CANCELLED',
      { type: 'system', id: order.id },
      { note: reason, extra: { cancelReason: reason ?? 'Price declined by customer' } }
    );

    res.json({ data: { status: updated.status } });
  })
);

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
