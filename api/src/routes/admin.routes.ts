import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, forbidden, notFound, unauthorized } from '@/lib/errors';
import { signToken } from '@/lib/jwt';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { transitionOrder } from '@/services/orders';
import {
  PAYOUT_HOLD_HOURS,
  PAYOUT_MIN_KOBO,
  payableFor,
  reconcilePayout,
  sendPayout,
  voidEarningForOrder,
} from '@/services/payouts';

export const adminRouter = Router();

/**
 * Phone numbers are stored E.164 ("+2348031234567") and nobody in Lagos types
 * them that way — a customer's number arrives as "0803 123 4567" in a WhatsApp
 * message. Searching for what ops actually pastes has to match both, so a local
 * 0-prefixed number is also tried as its +234 equivalent, and vice versa.
 *
 * Returns every form worth trying, including the original.
 */
function phoneVariants(q: string): string[] {
  const digits = q.replace(/[\s()-]/g, '');
  const forms = new Set([q, digits]);

  if (/^0\d{6,}$/.test(digits)) forms.add(`+234${digits.slice(1)}`);
  if (/^234\d{6,}$/.test(digits)) forms.add(`+${digits}`);
  if (/^\+?234\d{6,}$/.test(digits)) forms.add(`0${digits.replace(/^\+?234/, '')}`);

  return [...forms].filter(Boolean);
}

/** POST /admin/login — email + password (admins don't use OTP). */
adminRouter.post(
  '/login',
  validate(z.object({ email: z.string().email(), password: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
    // Compare regardless, so a missing account and a wrong password take the
    // same time and can't be told apart.
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? '$2a$10$invalidhashinvalidhashinvalidhashinvalidhash');

    if (!admin || !admin.isActive || !ok) throw unauthorized('Those credentials are not correct.');

    res.json({
      data: {
        token: signToken({ sub: admin.id, actor: 'admin' }),
        admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
      },
    });
  })
);

adminRouter.use(requireAuth('admin'));

/** GET /admin/dashboard — the KPI tiles. */
adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [ordersToday, gmv, activeRiders, pendingRiders, openRequests, liveOrders] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      // GMV is the value of what was ORDERED today, not what has landed — a
      // dashboard that only counted deliveries read ₦0 all morning while the
      // board filled with live orders. Cancelled orders are excluded because
      // they never become revenue.
      prisma.order.aggregate({
        where: {
          createdAt: { gte: todayStart },
          status: { notIn: ['CANCELLED', 'REFUNDED', 'PENDING_PAYMENT'] },
        },
        _sum: { totalKobo: true },
      }),
      prisma.rider.count({ where: { isOnline: true, status: 'APPROVED' } }),
      prisma.rider.count({ where: { status: 'IN_REVIEW' } }),
      prisma.marketplaceRequest.count({ where: { status: 'OPEN', closesAt: { gt: new Date() } } }),
      prisma.order.count({
        where: { status: { in: ['PLACED', 'VENDOR_ACCEPTED', 'RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } },
      }),
    ]);

    res.json({
      data: {
        ordersToday,
        gmvTodayKobo: gmv._sum.totalKobo ?? 0,
        activeRiders,
        pendingVerifications: pendingRiders,
        openRequests,
        liveOrders,
      },
    });
  })
);

/** GET /admin/riders?status=IN_REVIEW — the verification queue. */
adminRouter.get(
  '/riders',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    const riders = await prisma.rider.findMany({
      where: status ? { status: status as never } : {},
      include: { documents: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ data: riders });
  })
);

/** PATCH /admin/riders/:id/verify — approve or reject a rider. */
adminRouter.patch(
  '/riders/:id/verify',
  validate(
    z.object({
      status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
      note: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { status, note } = req.body as { status: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; note?: string };
    const riderId = req.params.id!;

    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw notFound('Rider');

    const updated = await prisma.$transaction(async (tx) => {
      // A rejected or suspended rider must not stay online holding jobs.
      const r = await tx.rider.update({
        where: { id: riderId },
        data: { status, ...(status === 'APPROVED' ? {} : { isOnline: false }) },
      });

      await tx.riderDocument.updateMany({
        where: { riderId, status: 'IN_REVIEW' },
        data: {
          status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          reviewNote: note,
          reviewedAt: new Date(),
        },
      });

      return r;
    });

    res.json({ data: updated });
  })
);

/** GET /admin/orders — order management, filterable. */
adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const channel = req.query.channel as string | undefined;
    const q = req.query.q as string | undefined;

    const orders = await prisma.order.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(type ? { type: type as never } : {}),
        // Filtering here rather than in the dashboard because this query is
        // capped at 100 rows: narrowing after the fact would quietly mean
        // "web orders among the last 100", not "the last 100 web orders".
        ...(channel ? { channel: channel as never } : {}),
        /**
         * Reference or customer. Ops is usually working from a phone number a
         * customer just sent on WhatsApp, not from a reference they would have
         * to be told first — and the Customers page links here by phone.
         */
        ...(q
          ? {
              OR: [
                { reference: { contains: q, mode: 'insensitive' as const } },
                ...phoneVariants(q).map((p) => ({ customer: { phone: { contains: p } } })),
                { customer: { firstName: { contains: q, mode: 'insensitive' as const } } },
                { customer: { lastName: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { firstName: true, lastName: true, phone: true } },
        rider: { select: { firstName: true, lastName: true, phone: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ data: orders });
  })
);

/** GET /admin/orders/:id */
adminRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id! },
      include: {
        customer: true,
        rider: true,
        vendor: true,
        address: true,
        items: true,
        events: { orderBy: { createdAt: 'asc' } },
        // recordedBy so the drawer can say whose word it is that cash arrived.
        payments: { include: { recordedBy: { select: { name: true } } } },
        errandDetail: true,
        packageDetail: true,
      },
    });

    if (!order) throw notFound('Order');
    res.json({ data: order });
  })
);

/** POST /admin/orders/:id/assign — manual rider assignment. */
adminRouter.post(
  '/orders/:id/assign',
  validate(z.object({ riderId: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id!;
    const { riderId } = req.body as { riderId: string };

    const [order, rider] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, riderId: true } }),
      prisma.rider.findUnique({ where: { id: riderId }, select: { id: true, status: true } }),
    ]);

    if (!order) throw notFound('Order');
    if (!rider) throw notFound('Rider');
    if (rider.status !== 'APPROVED') throw conflict('That rider is not approved yet.');
    if (order.riderId && order.riderId !== riderId) {
      throw conflict('This order already has a rider. Unassign them first.');
    }

    await prisma.order.update({ where: { id: orderId }, data: { riderId } });
    const updated = await transitionOrder(orderId, 'RIDER_ASSIGNED', { type: 'admin', id: req.auth!.id });

    res.json({ data: updated });
  })
);

/** POST /admin/orders/:id/status — ops override for stuck orders. */
adminRouter.post(
  '/orders/:id/status',
  validate(
    z.object({
      status: z.enum([
        'PLACED', 'VENDOR_ACCEPTED', 'RIDER_ASSIGNED',
        'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED',
      ]),
      note: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { status, note } = req.body as { status: never; note?: string };
    const updated = await transitionOrder(req.params.id!, status, { type: 'admin', id: req.auth!.id }, { note });
    res.json({ data: updated });
  })
);

/**
 * POST /admin/orders/:id/refund — refunds to the Sendy Errands Wallet.
 *
 * Wallet credit is instant, which is what customers actually want; bank
 * reversals through Paystack are a Phase-2 concern.
 */
adminRouter.post(
  '/orders/:id/refund',
  validate(z.object({ amountKobo: z.number().int().min(1).optional(), reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id!;
    const body = req.body as { amountKobo?: number; reason?: string };

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw notFound('Order');

      const amountKobo = body.amountKobo ?? order.totalKobo;
      const user = await tx.user.findUnique({ where: { id: order.customerId } });
      if (!user) throw notFound('Customer');

      const balanceKobo = user.walletBalanceKobo + amountKobo;

      await tx.user.update({ where: { id: user.id }, data: { walletBalanceKobo: balanceKobo } });
      await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: 'REFUND',
          amountKobo,
          balanceKobo,
          description: `Refund for ${order.reference}${body.reason ? ` — ${body.reason}` : ''}`,
          reference: order.reference,
        },
      });
      await tx.payment.updateMany({
        where: { orderId, status: 'SUCCESS' },
        data: { status: 'REFUNDED' },
      });

      /**
       * The rider was owed for this delivery. Refunding reverses the sale, so
       * the earning has to go with it — otherwise the rider is still owed for
       * something that no longer exists, and once transfers go live we pay it.
       *
       * If the money already left, say so rather than quietly rewriting
       * history: recovering it is a conversation, not a database update.
       */
      const earning = await voidEarningForOrder(
        orderId,
        `Order ${order.reference} refunded${body.reason ? ` — ${body.reason}` : ''}`,
        tx
      );

      await transitionOrder(orderId, 'REFUNDED', { type: 'admin', id: req.auth!.id }, { note: body.reason, tx });

      return { amountKobo, balanceKobo, riderEarning: earning };
    });

    res.json({ data: result });
  })
);

/**
 * GET /admin/payouts — the ledger, plus who is currently owed.
 *
 * Read-only by design. Sending the money is phase 3, and creating a payout is
 * what marks earnings as paid — exposing that button before anything can settle
 * it would let ops mark riders paid with nothing behind it.
 */
adminRouter.get(
  '/payouts',
  asyncHandler(async (_req, res) => {
    const [payouts, riders] = await Promise.all([
      prisma.payout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          rider: { select: { firstName: true, lastName: true, phone: true } },
          _count: { select: { earnings: true } },
        },
      }),
      prisma.rider.findMany({
        where: { earnings: { some: { isPaidOut: false, voidedAt: null } } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          bankName: true,
          bankAccountNo: true,
          bankAccountName: true,
        },
      }),
    ]);

    // One query per owed rider. Fine at this size — the list is riders with
    // unpaid work, not the whole fleet — and worth revisiting past a few dozen.
    const due = await Promise.all(riders.map(async (r) => ({ ...r, ...(await payableFor(r.id)) })));

    res.json({
      data: {
        holdHours: PAYOUT_HOLD_HOURS,
        minimumKobo: PAYOUT_MIN_KOBO,
        due: due.sort((a, b) => b.payableKobo - a.payableKobo),
        payouts,
      },
    });
  })
);

/**
 * POST /admin/riders/:id/payout — pays a rider what they are owed.
 *
 * Restricted to OPERATIONS and SUPERADMIN. Support staff can see the ledger and
 * cannot move money on it.
 */
adminRouter.post(
  '/riders/:id/payout',
  validate(z.object({ ignoreMinimum: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const admin = await prisma.admin.findUnique({
      where: { id: req.auth!.id },
      select: { role: true },
    });
    if (admin?.role !== 'OPERATIONS' && admin?.role !== 'SUPERADMIN') {
      throw forbidden('Only operations staff can release payouts.');
    }

    const { ignoreMinimum } = req.body as { ignoreMinimum?: boolean };
    res.json({ data: await sendPayout(req.params.id!, { ignoreMinimum }) });
  })
);

/**
 * POST /admin/payouts/:id/reconcile — asks Paystack what became of a payout.
 *
 * The way out of PENDING when a transfer request died in flight, and the manual
 * equivalent of a webhook that never arrived.
 */
adminRouter.post(
  '/payouts/:id/reconcile',
  asyncHandler(async (req, res) => {
    res.json({ data: await reconcilePayout(req.params.id!) });
  })
);

/** GET /admin/requests — errand & marketplace request management. */
adminRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    const requests = await prisma.marketplaceRequest.findMany({
      where: status ? { status: status as never } : {},
      include: {
        customer: { select: { firstName: true, lastName: true, phone: true } },
        bids: { include: { vendor: { select: { name: true } } } },
        invitedVendors: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ data: requests });
  })
);

/**
 * POST /admin/requests/:id/invite — choose which vendors get to quote.
 *
 * Replaces the whole set rather than appending, so the dashboard's multi-select
 * is the source of truth and unticking a vendor actually removes it.
 *
 * An empty list is meaningful, not a no-op: it returns the request to being
 * open to every eligible vendor. See GET /marketplace/open-requests.
 */
adminRouter.post(
  '/requests/:id/invite',
  validate(z.object({ vendorIds: z.array(z.string().min(1)).max(50) })),
  asyncHandler(async (req, res) => {
    const { vendorIds } = req.body as { vendorIds: string[] };

    const request = await prisma.marketplaceRequest.findUnique({
      where: { id: req.params.id! },
      select: { id: true, status: true },
    });
    if (!request) throw notFound('Request');

    if (request.status !== 'OPEN') {
      throw conflict('Bidding is closed on this request, so vendors cannot be invited.');
    }

    // Only vendors that can actually bid — inviting one that cannot would show
    // ops a vendor on the request who will never see it.
    const eligible = await prisma.vendor.findMany({
      where: { id: { in: vendorIds }, canBid: true, isVerified: true },
      select: { id: true },
    });

    if (eligible.length !== vendorIds.length) {
      throw badRequest('One or more of those vendors is not verified or cannot bid.');
    }

    const updated = await prisma.marketplaceRequest.update({
      where: { id: request.id },
      data: { invitedVendors: { set: eligible.map((v) => ({ id: v.id })) } },
      include: { invitedVendors: { select: { id: true, name: true } } },
    });

    res.json({ data: updated });
  })
);

/**
 * GET /admin/vendors — every vendor, for the management table.
 *
 * Deliberately not the public `GET /vendors`: that one caps `limit` at 50 and
 * hides nothing-to-sell vendors behind catalogue sorting, so ops would silently
 * stop seeing vendors past the cap. Management needs the whole list, including
 * unverified and closed ones.
 */
adminRouter.get(
  '/vendors',
  asyncHandler(async (_req, res) => {
    const vendors = await prisma.vendor.findMany({
      orderBy: [{ isVerified: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true, orders: true } } },
    });
    res.json({ data: vendors });
  })
);

/** PATCH /admin/vendors/:id — approve a vendor and its bidding eligibility. */
adminRouter.patch(
  '/vendors/:id',
  validate(
    z.object({
      isVerified: z.boolean().optional(),
      canBid: z.boolean().optional(),
      isOpen: z.boolean().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.update({
      where: { id: req.params.id! },
      data: req.body,
    });
    res.json({ data: vendor });
  })
);

/** GET /admin/vendor-applications?status=PENDING — the onboarding queue. */
adminRouter.get(
  '/vendor-applications',
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    const valid = ['PENDING', 'APPROVED', 'REJECTED'] as const;
    const filter = valid.find((s) => s === status);

    const applications = await prisma.vendorApplication.findMany({
      where: filter ? { status: filter } : {},
      // Pending first, then oldest first: an application waiting three days
      // should be the one ops sees, not the one that arrived this morning.
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        applicant: { select: { id: true, firstName: true, lastName: true, phone: true } },
        vendor: { select: { id: true, name: true, slug: true } },
      },
      take: 200,
    });

    res.json({ data: applications });
  })
);

/**
 * Turns a business name into a URL slug, with a numeric suffix if taken.
 *
 * Vendor.slug is unique and is what the app routes on, so two applicants both
 * called "Mama's Kitchen" must not collide — the second approval would throw a
 * constraint error and lose the review.
 */
async function uniqueVendorSlug(businessName: string): Promise<string> {
  const base =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'vendor';

  for (let n = 0; ; n++) {
    const slug = n === 0 ? base : `${base}-${n}`;
    const taken = await prisma.vendor.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
}

/**
 * POST /admin/vendor-applications/:id/decide — approve or reject.
 *
 * Approving creates the Vendor unverified and closed. The application carries
 * nothing about delivery fees, opening hours or a catalogue, so a vendor that
 * went live on approval would be an empty storefront customers could tap into.
 * Ops fills those in, then flips verified — see the isVerified filter on the
 * public vendor list.
 */
adminRouter.post(
  '/vendor-applications/:id/decide',
  validate(
    z.object({
      decision: z.enum(['APPROVE', 'REJECT']),
      note: z.string().max(500).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { decision, note } = req.body as { decision: 'APPROVE' | 'REJECT'; note?: string };

    const application = await prisma.vendorApplication.findUnique({
      where: { id: req.params.id! },
    });
    if (!application) throw notFound('Application');

    if (application.status !== 'PENDING') {
      throw conflict(`This application was already ${application.status.toLowerCase()}.`);
    }

    if (decision === 'REJECT') {
      const updated = await prisma.vendorApplication.update({
        where: { id: application.id },
        data: { status: 'REJECTED', note, reviewedAt: new Date() },
      });
      res.json({ data: updated });
      return;
    }

    const slug = await uniqueVendorSlug(application.businessName);

    /**
     * The application's phone becomes the vendor's login, so approval is the
     * moment the applicant can actually sign in. It is unique across vendors —
     * if that number already runs one, ops has to sort out which business it
     * belongs to rather than have the second approval fail on a constraint.
     */
    const phoneTaken = await prisma.vendor.findUnique({
      where: { phone: application.phone },
      select: { id: true, name: true },
    });

    if (phoneTaken) {
      throw conflict(
        `${application.phone} already signs in for ${phoneTaken.name}. Ask the applicant for a different number before approving.`
      );
    }

    // One transaction: a Vendor with no application pointing at it would be an
    // orphan ops could not trace back to who asked for it.
    const [, updated] = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({
        data: {
          name: application.businessName,
          slug,
          area: application.area,
          state: application.state,
          // Doubles as the login for /phone?role=vendor.
          phone: application.phone,
          tags: [application.category],
          isVerified: false,
          isOpen: false,
        },
      });

      const app = await tx.vendorApplication.update({
        where: { id: application.id },
        data: { status: 'APPROVED', note, reviewedAt: new Date(), vendorId: vendor.id },
        include: { vendor: { select: { id: true, name: true, slug: true } } },
      });

      return [vendor, app] as const;
    });

    res.json({ data: updated });
  })
);

/** GET /admin/vendors/:id/products — the vendor's catalogue, for managing listings. */
adminRouter.get(
  '/vendors/:id/products',
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id! },
      select: { id: true, name: true },
    });
    if (!vendor) throw notFound('Vendor');

    const products = await prisma.product.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ section: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { orderItems: true } } },
    });

    res.json({ data: { vendor, products } });
  })
);

/**
 * DELETE /admin/products/:id — remove a listing.
 *
 * A hard delete is safe here, which is not obvious. OrderItem denormalises the
 * name and unit price at the time of purchase and its productId is nullable
 * with ON DELETE SET NULL, so past orders keep reading correctly — they simply
 * stop linking to a catalogue entry that no longer exists. Soft-deleting
 * instead would mean every catalogue query in the app growing an
 * `isDeleted: false` filter, and the first one that forgot would resurrect the
 * listing for customers.
 */
adminRouter.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id! },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!product) throw notFound('Product');

    await prisma.product.delete({ where: { id: product.id } });

    res.json({
      data: {
        id: product.id,
        name: product.name,
        // Lets the dashboard say what the delete touched rather than guess.
        orderItemsUnlinked: product._count.orderItems,
      },
    });
  })
);

/**
 * DELETE /admin/vendors/:id — remove a vendor that never traded.
 *
 * Refused once the vendor has orders. Order.vendorId is ON DELETE SET NULL and
 * Order stores no vendor name of its own, so deleting a traded vendor would
 * quietly erase who fulfilled every one of its past orders — unrecoverable, and
 * invisible until someone went looking for the history. Taking the vendor
 * offline achieves what deleting is usually meant to achieve, without that.
 */
adminRouter.delete(
  '/vendors/:id',
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id! },
      include: { _count: { select: { products: true, orders: true } } },
    });
    if (!vendor) throw notFound('Vendor');

    if (vendor._count.orders > 0) {
      throw conflict(
        `${vendor.name} has ${vendor._count.orders} order(s) and cannot be deleted — ` +
          'that would erase which vendor fulfilled them. Switch it to unverified and ' +
          'closed instead to take it off the app.'
      );
    }

    // Products cascade (Product.vendor is onDelete: Cascade).
    await prisma.vendor.delete({ where: { id: vendor.id } });

    res.json({
      data: { id: vendor.id, name: vendor.name, productsDeleted: vendor._count.products },
    });
  })
);

/**
 * POST /admin/password-reset — set a new password for a locked-out account.
 *
 * Stands in for the self-service reset flow, which needs an email provider the
 * deployment does not have yet. Support takes the address over the phone, types
 * it here, and reads the generated password back to the customer.
 *
 * The password is generated rather than chosen by whoever is on the call: an
 * operator picking one produces "sendy123" every time, and it means a human
 * decided the credential for an account they do not own. It is shown once, in
 * the response, and never stored in readable form — asking again generates a
 * different one.
 *
 * This is deliberately not a way to sign in AS a customer. It changes the
 * password, which the account holder will notice, rather than minting a token
 * that would let an operator act as them silently.
 */
const adminResetSchema = z.object({
  email: z
    .string()
    .email('Enter the account email.')
    .transform((v) => v.trim().toLowerCase()),
  role: z.enum(['customer', 'rider', 'vendor']),
});

/**
 * Ambiguity-free alphabet — no O/0, l/1/I. The whole point is that this gets
 * read aloud down a phone line and typed by someone who cannot see it.
 */
const SPEAKABLE = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += SPEAKABLE[bytes[i]! % SPEAKABLE.length];
  return out;
}

adminRouter.post(
  '/password-reset',
  validate(adminResetSchema),
  asyncHandler(async (req, res) => {
    const { email, role } = req.body as z.infer<typeof adminResetSchema>;

    const account =
      role === 'vendor'
        ? await prisma.vendor.findUnique({ where: { email }, select: { id: true, name: true } })
        : role === 'rider'
          ? await prisma.rider.findUnique({
              where: { email },
              select: { id: true, firstName: true, lastName: true },
            })
          : await prisma.user.findUnique({
              where: { email },
              select: { id: true, firstName: true, lastName: true },
            });

    // Named plainly. This endpoint is behind an admin token, so there is no
    // account-enumeration concern to protect against — and an operator on a
    // call needs to know the address is simply wrong.
    if (!account) throw notFound(`No ${role} account uses ${email}`);

    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    if (role === 'vendor') {
      await prisma.vendor.update({ where: { email }, data: { passwordHash } });
    } else if (role === 'rider') {
      await prisma.rider.update({ where: { email }, data: { passwordHash } });
    } else {
      await prisma.user.update({ where: { email }, data: { passwordHash } });
    }

    // Any live reset codes for this address are now stale.
    await prisma.otpCode.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const name =
      'name' in account
        ? account.name
        : `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim();

    console.warn(`[admin] password reset for ${role} ${email} by admin ${req.auth!.id}`);

    res.json({ data: { email, role, name, password } });
  })
);

/* ---------------------------------------------------------------------------
 * Service catalogue
 *
 * Replaces the PHP admin's services.php and pricing.php. Both the website's
 * booking form and this dashboard now read one catalogue, instead of the form
 * reading MySQL and the dashboard knowing nothing about services at all.
 * ------------------------------------------------------------------------- */

/** GET /admin/services — the catalogue, inactive ones included. */
adminRouter.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const services = await prisma.service.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { pricingRules: { orderBy: { type: 'asc' } } },
    });
    res.json({ data: services });
  })
);

const serviceBody = z.object({
  name: z.string().trim().min(2).max(120),
  shortDescription: z.string().trim().max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  icon: z.string().trim().max(60).optional(),
  /** Kobo, like every other money field. The dashboard converts from naira. */
  baseFeeKobo: z.number().int().min(0),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

/** POST /admin/services */
adminRouter.post(
  '/services',
  validate(serviceBody.extend({ slug: z.string().trim().regex(/^[a-z0-9-]+$/).min(2).max(60) })),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof serviceBody> & { slug: string };

    const clash = await prisma.service.findUnique({ where: { slug: body.slug }, select: { id: true } });
    if (clash) throw conflict('A service with that slug already exists.');

    const service = await prisma.service.create({ data: body });
    res.status(201).json({ data: service });
  })
);

/**
 * PATCH /admin/services/:id
 *
 * The slug is deliberately not editable. It is what the website's URLs and the
 * booking form use to refer to a service, so changing it silently breaks every
 * existing link and any order that recorded it. Renaming is what `name` is for.
 */
adminRouter.patch(
  '/services/:id',
  validate(serviceBody.partial()),
  asyncHandler(async (req, res) => {
    const existing = await prisma.service.findUnique({ where: { id: req.params.id! }, select: { id: true } });
    if (!existing) throw notFound('Service');

    const service = await prisma.service.update({
      where: { id: req.params.id! },
      data: req.body as Partial<z.infer<typeof serviceBody>>,
      include: { pricingRules: true },
    });
    res.json({ data: service });
  })
);

/**
 * PUT /admin/services/:id/rules — replace a service's pricing rules.
 *
 * Replace rather than patch: the rules are a short list read as a set, and
 * editing them individually means the dashboard has to track which rows were
 * removed. Sending the whole list makes "what you see is what is stored" true.
 */
adminRouter.put(
  '/services/:id/rules',
  validate(
    z.object({
      rules: z
        .array(
          z.object({
            type: z.enum(['PER_KM', 'PER_KG', 'WAITING_TIME', 'URGENCY_MULTIPLIER', 'FLAT_FEE']),
            label: z.string().trim().min(2).max(120),
            /** A string, so a decimal survives the trip without a float rounding it. */
            value: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
            isActive: z.boolean().optional(),
          })
        )
        .max(20),
    })
  ),
  asyncHandler(async (req, res) => {
    const serviceId = req.params.id!;
    const { rules } = req.body as {
      rules: { type: never; label: string; value: string; isActive?: boolean }[];
    };

    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw notFound('Service');

    // One transaction, so a failure halfway cannot leave a service with no
    // pricing rules at all.
    await prisma.$transaction([
      prisma.pricingRule.deleteMany({ where: { serviceId } }),
      prisma.pricingRule.createMany({ data: rules.map((r) => ({ ...r, serviceId })) }),
    ]);

    const updated = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { pricingRules: { orderBy: { type: 'asc' } } },
    });
    res.json({ data: updated });
  })
);

/* ---------------------------------------------------------------------------
 * Support requests
 *
 * Replaces the PHP admin's support.php. Not a ticket thread: the reply happens
 * on WhatsApp or in the mailbox, so this is a queue of what came in and whether
 * it has been dealt with.
 * ------------------------------------------------------------------------- */

/** GET /admin/support?status=OPEN — newest first, with unread counts. */
adminRouter.get(
  '/support',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    const requests = await prisma.supportRequest.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        order: { select: { reference: true } },
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    const grouped = await prisma.supportRequest.groupBy({ by: ['status'], _count: true });
    const counts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 } as Record<string, number>;
    for (const g of grouped) counts[g.status] = g._count;

    // "Nobody has looked at this yet" is worth surfacing separately from status:
    // an OPEN request someone has read is in a different state to a new one.
    const unread = await prisma.supportRequest.count({ where: { readAt: null } });

    res.json({ data: { requests, counts, unread } });
  })
);

/**
 * PATCH /admin/support/:id — move it along, or record what was done.
 *
 * Opening a request marks it read. There is no reply field because there is no
 * reply channel here; internalNote is for ops to record the outcome.
 */
adminRouter.patch(
  '/support/:id',
  validate(
    z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
      internalNote: z.string().trim().max(2000).optional(),
      markRead: z.boolean().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status?: never; internalNote?: string; markRead?: boolean };

    const existing = await prisma.supportRequest.findUnique({
      where: { id: req.params.id! },
      select: { id: true, readAt: true },
    });
    if (!existing) throw notFound('Support request');

    const request = await prisma.supportRequest.update({
      where: { id: req.params.id! },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.internalNote !== undefined ? { internalNote: body.internalNote } : {}),
        // Read is a one-way flag: once someone has seen it, it is seen.
        ...(body.markRead && !existing.readAt ? { readAt: new Date() } : {}),
      },
      include: {
        order: { select: { reference: true } },
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    res.json({ data: request });
  })
);

/* ---------------------------------------------------------------------------
 * Reviews
 *
 * A moderation queue, replacing the PHP admin's reviews.php. Reviews appear on
 * the public site, so nothing is published until someone has read it.
 * ------------------------------------------------------------------------- */

/** GET /admin/reviews?status=PENDING — newest first. */
adminRouter.get(
  '/reviews',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    const reviews = await prisma.review.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        order: { select: { reference: true, type: true, channel: true } },
        customer: { select: { firstName: true, lastName: true } },
        rider: { select: { firstName: true, lastName: true } },
      },
    });

    // Counts for the filter tabs, so the queue shows how much is waiting
    // without a second request.
    const grouped = await prisma.review.groupBy({ by: ['status'], _count: true });
    const counts = { PENDING: 0, PUBLISHED: 0, HIDDEN: 0 } as Record<string, number>;
    for (const g of grouped) counts[g.status] = g._count;

    res.json({ data: { reviews, counts } });
  })
);

/**
 * PATCH /admin/reviews/:id — publish, hide, or return to the queue.
 *
 * Only the status is editable. An admin correcting a customer's words would be
 * publishing something the customer did not write under their name, so the
 * rating and comment are read-only here by design.
 */
adminRouter.patch(
  '/reviews/:id',
  validate(z.object({ status: z.enum(['PENDING', 'PUBLISHED', 'HIDDEN']) })),
  asyncHandler(async (req, res) => {
    const { status } = req.body as { status: 'PENDING' | 'PUBLISHED' | 'HIDDEN' };

    const existing = await prisma.review.findUnique({ where: { id: req.params.id! }, select: { id: true } });
    if (!existing) throw notFound('Review');

    const review = await prisma.review.update({
      where: { id: req.params.id! },
      data: { status },
      include: {
        order: { select: { reference: true } },
        customer: { select: { firstName: true, lastName: true } },
        rider: { select: { firstName: true, lastName: true } },
      },
    });

    console.warn(`[admin] review ${review.id} set to ${status} by admin ${req.auth!.id}`);
    res.json({ data: review });
  })
);

/* ---------------------------------------------------------------------------
 * Customers
 *
 * Replaces the PHP admin's customers.php. Read-only: everything here is already
 * editable where it belongs — a wallet moves through refunds, an account is
 * disabled on the user's own record — and a customer list that can rewrite
 * people's details is a list that can quietly rewrite a dispute.
 * ------------------------------------------------------------------------- */

/**
 * Website bookings mint a User keyed on phone, synthesising an address on the
 * reserved `.invalid` TLD when the form collected none. Showing that to ops
 * would look like an inbox they could write to.
 */
const PLACEHOLDER_EMAIL = /@web\.sendyerrands\.invalid$/i;

/** GET /admin/customers?q= — newest first, searchable by name, phone or email. */
adminRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();

    /**
     * Names are stored split, so a search for "Adaeze Okafor" matches neither
     * column on its own. Two tokens are also tried as first + last, which is
     * what anyone typing a full name means.
     */
    const [first, ...rest] = (q ?? '').split(/\s+/).filter(Boolean);
    const last = rest.join(' ');

    const where = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            ...phoneVariants(q).map((p) => ({ phone: { contains: p } })),
            { email: { contains: q, mode: 'insensitive' as const } },
            ...(last
              ? [
                  {
                    AND: [
                      { firstName: { contains: first!, mode: 'insensitive' as const } },
                      { lastName: { contains: last, mode: 'insensitive' as const } },
                    ],
                  },
                ]
              : []),
          ],
        }
      : {};

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        walletBalanceKobo: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true, supportRequests: true } },
      },
    });

    const ids = users.map((u) => u.id);

    const [spend, activity] = await Promise.all([
      /**
       * Spend is what was collected, not what was ordered: an order placed and
       * never paid for is not money this customer has spent. Summed from
       * payments for that reason, and REFUNDED ones are excluded by the status
       * filter, so refunding an order takes it back out of the total.
       */
      ids.length
        ? prisma.payment.findMany({
            where: { status: 'SUCCESS', order: { customerId: { in: ids } } },
            select: { amountKobo: true, order: { select: { customerId: true } } },
          })
        : Promise.resolve([]),
      // Which channels they order through, and when they last did.
      ids.length
        ? prisma.order.groupBy({
            by: ['customerId', 'channel'],
            where: { customerId: { in: ids } },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
    ]);

    const spentByCustomer = new Map<string, number>();
    for (const p of spend) {
      const key = p.order.customerId;
      spentByCustomer.set(key, (spentByCustomer.get(key) ?? 0) + p.amountKobo);
    }

    const channelsByCustomer = new Map<string, Set<string>>();
    const lastOrderByCustomer = new Map<string, Date>();
    for (const row of activity) {
      const set = channelsByCustomer.get(row.customerId) ?? new Set<string>();
      set.add(row.channel);
      channelsByCustomer.set(row.customerId, set);

      const at = row._max.createdAt;
      const seen = lastOrderByCustomer.get(row.customerId);
      if (at && (!seen || at > seen)) lastOrderByCustomer.set(row.customerId, at);
    }

    const customers = users.map((u) => ({
      ...u,
      // Null rather than the placeholder: there is no address to write to.
      email: u.email && PLACEHOLDER_EMAIL.test(u.email) ? null : u.email,
      totalSpentKobo: spentByCustomer.get(u.id) ?? 0,
      lastOrderAt: lastOrderByCustomer.get(u.id) ?? null,
      /**
       * Empty for someone who has never ordered. ["WEB"] alone means the record
       * was created by a website booking and has never been signed into — there
       * is no usable password on it, so "send them a reset link" is not
       * something ops should be offered.
       */
      channels: [...(channelsByCustomer.get(u.id) ?? [])].sort(),
    }));

    res.json({ data: customers });
  })
);

/* ---------------------------------------------------------------------------
 * Payments
 *
 * Money in, kept separate from rider payouts, which are money out. Both are
 * "payments" in casual speech, and netting them into one figure is how a
 * business convinces itself it is profitable.
 *
 * Sendy takes most of its money offline — cash at the door, or a transfer into
 * the company account — so a row here is usually a record of something a human
 * confirmed rather than something a gateway reported.
 * ------------------------------------------------------------------------- */

/**
 * GET /admin/payments?status=SUCCESS&channel=WEB — ledger, totals, and who owes.
 *
 * The two filters have deliberately different reach. **channel narrows the whole
 * page** — "what has the website brought in" is a question about the totals and
 * the unpaid list too, not only the table. **status narrows the ledger alone**,
 * because the totals ARE the breakdown by status; filtering those by status
 * would leave every tile but one reading zero.
 *
 * Both are applied in the query. The ledger caps at 200 rows, so narrowing
 * afterwards would mean "web payments among the last 200" while looking like
 * "the last 200 web payments".
 */
adminRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const channel = req.query.channel as string | undefined;

    const byChannel = channel ? { order: { channel: channel as never } } : {};

    const [payments, grouped, unpaid] = await Promise.all([
      prisma.payment.findMany({
        where: { ...byChannel, ...(status ? { status: status as never } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          order: {
            select: {
              id: true,
              reference: true,
              channel: true,
              totalKobo: true,
              customer: { select: { firstName: true, lastName: true, phone: true } },
            },
          },
          recordedBy: { select: { name: true } },
        },
      }),
      // Totals span every payment ever, not just the page being listed — but
      // they do follow the channel filter, which is the whole point of it.
      prisma.payment.groupBy({
        by: ['status'],
        where: byChannel,
        _sum: { amountKobo: true },
        _count: true,
      }),
      /**
       * Delivered, with nothing recorded as received. This is the list ops acts
       * on, and it is why the page exists: in a cash business the risk is not a
       * failed charge, it is a delivery nobody ever collected for.
       *
       * Oldest first — the longest unpaid is the least likely to be recovered.
       */
      prisma.order.findMany({
        where: {
          status: 'DELIVERED',
          payments: { none: { status: 'SUCCESS' } },
          ...(channel ? { channel: channel as never } : {}),
        },
        orderBy: { deliveredAt: 'asc' },
        take: 100,
        select: {
          id: true,
          reference: true,
          channel: true,
          totalKobo: true,
          deliveredAt: true,
          customer: { select: { firstName: true, lastName: true, phone: true } },
          rider: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const totals: Record<string, number> = { SUCCESS: 0, PENDING: 0, FAILED: 0, REFUNDED: 0 };
    const counts: Record<string, number> = { SUCCESS: 0, PENDING: 0, FAILED: 0, REFUNDED: 0 };
    for (const g of grouped) {
      totals[g.status] = g._sum.amountKobo ?? 0;
      counts[g.status] = g._count;
    }

    res.json({
      data: {
        payments,
        totals,
        counts,
        unpaid,
        unpaidTotalKobo: unpaid.reduce((sum, o) => sum + o.totalKobo, 0),
      },
    });
  })
);

/**
 * POST /admin/orders/:id/quote — put a price on an order.
 *
 * The missing half of the payments flow. Prices are otherwise proposed by a
 * rider standing in front of the item, which works for an app errand and not at
 * all for one booked on the website: there is no rider yet, and nobody has seen
 * the goods. Until now the only thing pointing at this gap was the error
 * "Quote it first", which named a screen that did not exist.
 *
 * WHAT totalKobo MEANS HERE
 *
 * totalKobo is what the customer owes **Sendy** — the delivery and service fee.
 * The cost of the goods is recorded separately on the errand as budgetKobo and
 * never passes through Sendy: the customer settles that with the merchant or
 * hands it to the rider. Folding goods into totalKobo would make the Payments
 * page claim the business is owed money it was never going to collect, and
 * leave every part-paid order sitting in the unpaid list forever.
 *
 * Restricted to OPERATIONS and SUPERADMIN. Setting a price is deciding what to
 * charge someone.
 */
adminRouter.post(
  '/orders/:id/quote',
  validate(
    z.object({
      deliveryFeeKobo: z.number().int().min(0),
      serviceFeeKobo: z.number().int().min(0),
      /** What the goods are expected to cost. Recorded, never charged. */
      goodsEstimateKobo: z.number().int().min(0).optional(),
      note: z.string().trim().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id!;
    const body = req.body as {
      deliveryFeeKobo: number;
      serviceFeeKobo: number;
      goodsEstimateKobo?: number;
      note?: string;
    };

    const admin = await prisma.admin.findUnique({
      where: { id: req.auth!.id },
      select: { id: true, role: true },
    });
    if (admin?.role !== 'OPERATIONS' && admin?.role !== 'SUPERADMIN') {
      throw forbidden('Only operations staff can price an order.');
    }

    const totalKobo = body.deliveryFeeKobo + body.serviceFeeKobo;
    if (totalKobo <= 0) {
      throw badRequest('A quote has to come to more than zero.');
    }

    const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          reference: true,
          status: true,
          type: true,
          totalKobo: true,
          payments: { where: { status: 'SUCCESS' }, select: { amountKobo: true } },
          errandDetail: { select: { orderId: true } },
        },
      });
      if (!order) throw notFound('Order');

      /**
       * Locked once money has been taken, matching the PHP admin. Re-pricing a
       * paid order silently creates a mismatch between what was charged and
       * what the books say was owed, and there is no honest way to resolve it
       * later. Refund first, then re-price.
       */
      if (order.payments.length > 0) {
        const paid = order.payments.reduce((sum, p) => sum + p.amountKobo, 0);
        throw conflict(
          `${order.reference} already has ${naira(paid)} recorded against it. Refund that before changing the price.`
        );
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryFeeKobo: body.deliveryFeeKobo,
          serviceFeeKobo: body.serviceFeeKobo,
          totalKobo,
        },
        select: { id: true, reference: true, status: true, totalKobo: true },
      });

      // Only errands carry a goods budget, and only if one already exists —
      // creating an ErrandDetail for a food or package order would invent a
      // shape the rest of the code does not expect on those types.
      if (body.goodsEstimateKobo !== undefined && order.errandDetail) {
        await tx.errandDetail.update({
          where: { orderId },
          data: { budgetKobo: body.goodsEstimateKobo },
        });
      }

      await tx.orderEvent.create({
        data: {
          orderId,
          status: order.status,
          label: order.totalKobo > 0 ? 'Price updated' : 'Price agreed',
          note: [
            `${naira(totalKobo)} to Sendy`,
            body.goodsEstimateKobo ? `goods about ${naira(body.goodsEstimateKobo)}` : null,
            body.note,
          ]
            .filter(Boolean)
            .join(' — '),
          actorType: 'admin',
          actorId: admin.id,
        },
      });

      return updated;
    });

    console.warn(`[admin] ${result.reference} priced at ${totalKobo} kobo by admin ${admin.id}`);
    res.json({ data: result });
  })
);

/* ---- CSV export ---------------------------------------------------------
 *
 * Written for a spreadsheet, not for a parser. Three things are easy to get
 * wrong here and expensive to discover after someone has reconciled against
 * the file.
 * ------------------------------------------------------------------------- */

/**
 * A cell starting `=`, `+`, `-` or `@` is a formula to Excel and Sheets. Notes
 * and customer names in this export are typed by people, so a value like
 * `=cmd|...` would execute on open. Prefixing with an apostrophe makes it text.
 * Plain numbers are exempt, or every negative amount would gain a quote.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * The BOM is not decoration. Without it Excel on Windows reads the file as the
 * system codepage, so ₦ and the diacritics in Nigerian names render as
 * mojibake — the data is intact, the file looks corrupt, and nobody trusts the
 * export again. CRLF for the same audience.
 */
function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Refused rather than truncated past this. An export that silently stops at N
 * rows is worse than no export: the total at the bottom of someone's
 * spreadsheet is simply wrong, and nothing on the page says so.
 */
const EXPORT_MAX_ROWS = 10_000;

/**
 * GET /admin/payments/export?status=&channel= — the ledger as CSV.
 *
 * Exports everything matching the filter, not the 200 rows the page happens to
 * be showing. The filename carries the filter so two exports do not overwrite
 * each other in a Downloads folder.
 */
adminRouter.get(
  '/payments/export',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const channel = req.query.channel as string | undefined;

    const where = {
      ...(channel ? { order: { channel: channel as never } } : {}),
      ...(status ? { status: status as never } : {}),
    };

    const total = await prisma.payment.count({ where });
    if (total > EXPORT_MAX_ROWS) {
      throw badRequest(
        `That is ${total.toLocaleString('en-NG')} payments, over the ${EXPORT_MAX_ROWS.toLocaleString('en-NG')} export limit. Narrow it by status or channel.`
      );
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            reference: true,
            channel: true,
            totalKobo: true,
            customer: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
        recordedBy: { select: { name: true } },
      },
    });

    const csv = toCsv(
      [
        'paid_at',
        'created_at',
        'order_reference',
        'channel',
        'customer_name',
        'customer_phone',
        'method',
        'payment_reference',
        // Kobo is the exact figure and naira is the readable one. Both, because
        // a spreadsheet that sums the readable column must still reconcile.
        'amount_kobo',
        'amount_naira',
        'order_total_naira',
        'status',
        'recorded_by',
        'note',
      ],
      payments.map((p) => [
        p.paidAt?.toISOString() ?? '',
        p.createdAt.toISOString(),
        p.order?.reference ?? '',
        p.order?.channel ?? '',
        p.order?.customer ? `${p.order.customer.firstName} ${p.order.customer.lastName}`.trim() : '',
        p.order?.customer?.phone ?? '',
        p.provider,
        p.reference ?? '',
        p.amountKobo,
        (p.amountKobo / 100).toFixed(2),
        p.order ? (p.order.totalKobo / 100).toFixed(2) : '',
        p.status,
        // Empty means a gateway created it. That absence is meaningful, so it
        // is left blank rather than filled with "system".
        p.recordedBy?.name ?? '',
        p.note ?? '',
      ])
    );

    const parts = ['sendy-payments', channel?.toLowerCase(), status?.toLowerCase()].filter(Boolean);
    const filename = `${parts.join('-')}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  })
);

/**
 * POST /admin/orders/:id/payment — record money that arrived offline.
 *
 * Restricted to OPERATIONS and SUPERADMIN, like releasing a payout. Marking an
 * order paid is not a status change, it is an assertion that cash was handed
 * over; support staff can read the ledger and cannot write to it.
 *
 * Nothing here contacts a gateway. It exists because the money already moved.
 */
adminRouter.post(
  '/orders/:id/payment',
  validate(
    z.object({
      provider: z.enum(['CASH', 'BANK_TRANSFER']),
      // Omitted means "the rest of what this order is worth", which is what ops
      // means nearly every time.
      amountKobo: z.number().int().min(1).optional(),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id!;
    const body = req.body as {
      provider: 'CASH' | 'BANK_TRANSFER';
      amountKobo?: number;
      reference?: string;
      note?: string;
    };

    const admin = await prisma.admin.findUnique({
      where: { id: req.auth!.id },
      select: { id: true, role: true },
    });
    if (admin?.role !== 'OPERATIONS' && admin?.role !== 'SUPERADMIN') {
      throw forbidden('Only operations staff can record a payment.');
    }

    const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          reference: true,
          status: true,
          totalKobo: true,
          payments: { where: { status: 'SUCCESS' }, select: { amountKobo: true } },
        },
      });
      if (!order) throw notFound('Order');

      /**
       * A web errand is booked before anyone knows what it costs, so it sits at
       * a total of zero until it is quoted. Collecting against it would record
       * money with nothing to reconcile it to — and the generic guard below
       * would have said "already paid in full (₦0)", which is nonsense.
       */
      if (order.totalKobo <= 0) {
        throw badRequest(
          `${order.reference} has no price on it yet, so there is nothing to collect. Quote it first.`
        );
      }

      const alreadyPaidKobo = order.payments.reduce((sum, p) => sum + p.amountKobo, 0);
      const remainingKobo = order.totalKobo - alreadyPaidKobo;

      /**
       * Refuse rather than add a second payment to a settled order. The PHP
       * admin kept one row per order for this reason; allowing several, because
       * part-payments are real, means the guard has to live here instead.
       */
      if (remainingKobo <= 0) {
        throw conflict(`${order.reference} is already paid in full (${naira(alreadyPaidKobo)}).`);
      }

      const amountKobo = body.amountKobo ?? remainingKobo;
      if (amountKobo > remainingKobo) {
        throw badRequest(
          `That is more than ${order.reference} still owes — ${naira(remainingKobo)} outstanding.`
        );
      }

      const payment = await tx.payment.create({
        data: {
          orderId,
          provider: body.provider,
          // Manual records need a unique reference too. A transfer reference is
          // the useful one where there is one; otherwise generate a traceable
          // internal one rather than leaving it blank.
          reference: body.reference || `MAN-${randomBytes(5).toString('hex').toUpperCase()}`,
          amountKobo,
          status: 'SUCCESS',
          paidAt: new Date(),
          recordedByAdminId: admin.id,
          note: body.note ?? null,
        },
      });

      const fullyPaid = alreadyPaidKobo + amountKobo >= order.totalKobo;

      /**
       * Always leave a mark on the order's own timeline. A status change alone
       * would not: an order past PENDING_PAYMENT does not move when it is paid,
       * so without this the money would show in the ledger and nowhere on the
       * order the customer is calling about.
       */
      await tx.orderEvent.create({
        data: {
          orderId,
          status: order.status,
          label: fullyPaid ? 'Payment received' : 'Part payment received',
          note: [
            `${naira(amountKobo)} by ${body.provider === 'CASH' ? 'cash' : 'bank transfer'}`,
            body.note,
          ]
            .filter(Boolean)
            .join(' — '),
          actorType: 'admin',
          actorId: admin.id,
        },
      });

      /**
       * Only PENDING_PAYMENT is waiting on this. A web errand sits at
       * QUOTE_REQUESTED and is priced before anyone pays, so paying it must not
       * shove it down the app's paid-up-front lane.
       */
      if (fullyPaid && order.status === 'PENDING_PAYMENT') {
        await transitionOrder(orderId, 'PLACED', { type: 'admin', id: admin.id }, { tx });
      }

      return { payment, fullyPaid, outstandingKobo: remainingKobo - amountKobo };
    });

    console.warn(
      `[admin] payment ${result.payment.reference} of ${result.payment.amountKobo} kobo recorded on ${orderId} by admin ${admin.id}`
    );
    res.status(201).json({ data: result });
  })
);
