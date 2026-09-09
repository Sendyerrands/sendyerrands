import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';
import { requireApprovedRider, requireAuth } from '@/middleware/auth';
import { isOwnCloudinaryUrl } from '@/services/cloudinary';
import { counterBid } from '@/services/delivery-bids';
import { transitionOrder } from '@/services/orders';
import { listBanks, resolveAccount } from '@/services/paystack';
import { PAYOUT_HOLD_HOURS, PAYOUT_MIN_KOBO, payableFor } from '@/services/payouts';

export const riderRouter = Router();

riderRouter.use(requireAuth('rider'));

/** GET /rider/me */
riderRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const rider = await prisma.rider.findUnique({
      where: { id: req.auth!.id },
      include: { documents: true },
    });
    if (!rider) throw notFound('Rider');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const today = await prisma.riderEarning.aggregate({
      where: { riderId: rider.id, createdAt: { gte: todayStart } },
      _sum: { netKobo: true },
      _count: true,
    });

    res.json({
      data: {
        ...rider,
        today: {
          earningsKobo: today._sum.netKobo ?? 0,
          trips: today._count,
        },
      },
    });
  })
);

/** PATCH /rider/availability — the online/offline toggle. */
riderRouter.patch(
  '/availability',
  validate(z.object({ isOnline: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { isOnline } = req.body as { isOnline: boolean };

    const rider = await prisma.rider.findUnique({
      where: { id: req.auth!.id },
      select: { status: true },
    });
    if (!rider) throw notFound('Rider');
    if (isOnline && rider.status !== 'APPROVED') {
      throw forbidden('You can go online once your documents are approved.');
    }

    const updated = await prisma.rider.update({
      where: { id: req.auth!.id },
      data: { isOnline },
      select: { id: true, isOnline: true, zone: true },
    });

    res.json({ data: updated });
  })
);

/**
 * GET /rider/jobs — unassigned orders that are ready for a rider.
 * Browsable while documents are in review; accepting is what needs approval.
 */
riderRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const sort = String(req.query.sort ?? 'nearest');

    const jobs = await prisma.order.findMany({
      where: {
        riderId: null,
        // QUOTE_REQUESTED is unpaid on purpose: an errand reaches the board
        // before anyone knows what the item costs, because finding that out is
        // the job. See the note in orders.routes.ts.
        status: { in: ['PLACED', 'VENDOR_ACCEPTED', 'QUOTE_REQUESTED'] },
      },
      include: {
        vendor: { select: { name: true, area: true } },
        address: { select: { line1: true, city: true, landmark: true } },
        errandDetail: { select: { task: true, pickupName: true, pickupAddress: true } },
        packageDetail: { select: { pickupName: true, pickupAddress: true, dropoffName: true, dropoffAddress: true, size: true } },
      },
      orderBy: sort === 'payout' ? { riderPayoutKobo: 'desc' } : { createdAt: 'asc' },
      take: 50,
    });

    res.json({ data: jobs });
  })
);

/**
 * GET /rider/orders?status=active|completed — the jobs THIS rider took.
 *
 * Distinct from /rider/jobs, which is the open board of unclaimed work, and
 * from /rider/active, which returns a single in-progress order. Neither gave a
 * rider any way to see what they had accepted: a job vanished from the board on
 * accept and disappeared entirely once delivered, so there was no list of
 * received orders and no history to check a payout against.
 */
riderRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const filter = String(req.query.status ?? 'all');

    const ACTIVE = ['RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] as const;
    const DONE = ['DELIVERED', 'CANCELLED', 'REFUNDED'] as const;

    const orders = await prisma.order.findMany({
      where: {
        riderId: req.auth!.id,
        ...(filter === 'active'
          ? { status: { in: [...ACTIVE] } }
          : filter === 'completed'
            ? { status: { in: [...DONE] } }
            : {}),
      },
      include: {
        vendor: { select: { name: true, area: true } },
        address: { select: { line1: true, city: true, landmark: true } },
        errandDetail: { select: { task: true, pickupName: true, pickupAddress: true } },
        packageDetail: { select: { pickupName: true, pickupAddress: true, dropoffName: true, dropoffAddress: true, size: true } },
      },
      // Active work first and oldest-first within it, so the job a customer has
      // been waiting longest for is the one at the top.
      orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
      take: 50,
    });

    res.json({ data: orders });
  })
);

/** GET /rider/jobs/:id */
riderRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id!,
        OR: [{ riderId: null }, { riderId: req.auth!.id }],
      },
      include: {
        vendor: true,
        address: true,
        items: true,
        errandDetail: true,
        packageDetail: true,
        customer: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    if (!order) throw notFound('Job');
    res.json({ data: order });
  })
);

/**
 * POST /rider/jobs/:id/accept
 *
 * The claim is a conditional update on riderId = null. If two riders tap at the
 * same moment, exactly one row is affected and the other gets a clean 409 —
 * no double-assignment, no row locking needed.
 */
riderRouter.post(
  '/jobs/:id/accept',
  requireApprovedRider,
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;
    const orderId = req.params.id!;

    const claimed = await prisma.order.updateMany({
      // QUOTE_REQUESTED belongs here: an errand is claimable while unpaid,
      // because pricing it is the job. Leaving it out meant every errand
      // matched zero rows and reported a rival rider who did not exist.
      where: {
        id: orderId,
        riderId: null,
        status: { in: ['PLACED', 'VENDOR_ACCEPTED', 'QUOTE_REQUESTED'] },
      },
      data: { riderId },
    });

    if (claimed.count === 0) {
      /**
       * Say which it was.
       *
       * A zero-row claim has two causes and they need different responses:
       * someone else got there first, or the job is not in a claimable state.
       * Reporting both as "another rider took that job" sent riders pulling to
       * refresh a list that would never change, and hid the status bug that
       * made every errand unclaimable.
       */
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { riderId: true, status: true },
      });

      if (!order) throw notFound('Job');
      if (order.riderId && order.riderId !== riderId) {
        throw conflict('Another rider just took that job. Pull down to refresh.');
      }
      if (order.riderId === riderId) {
        throw conflict('You already have this job. Check your deliveries.');
      }
      throw conflict(`This job is no longer available (${order.status.toLowerCase().replace(/_/g, ' ')}).`);
    }

    const order = await transitionOrder(orderId, 'RIDER_ASSIGNED', { type: 'rider', id: riderId });
    res.json({ data: order });
  })
);

/** GET /rider/jobs/active — whatever this rider is currently carrying. */
riderRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: {
        riderId: req.auth!.id,
        // The errand states belong here too, or a rider who accepts one is sent
        // to an active-delivery screen that reports no active delivery.
        status: {
          in: [
            'RIDER_ASSIGNED',
            'PRICE_PROPOSED',
            'MERCHANT_PAID',
            'PICKED_UP',
            'IN_TRANSIT',
            'AT_DOORSTEP',
          ],
        },
      },
      include: {
        vendor: true,
        address: true,
        items: true,
        errandDetail: true,
        packageDetail: true,
        customer: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });

    res.json({ data: order });
  })
);

/**
 * POST /rider/jobs/:id/status — the slide-to-confirm control.
 * DELIVERED additionally requires the 4-digit code the customer reads out.
 */
riderRouter.post(
  '/jobs/:id/status',
  requireApprovedRider,
  validate(
    z.object({
      status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']),
      deliveryCode: z.string().length(4).optional(),
      proofUrl: z.string().url().optional(),
      spentKobo: z.number().int().min(0).optional(),
      receiptUrl: z.string().url().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;
    const orderId = req.params.id!;
    const body = req.body as {
      status: 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED';
      deliveryCode?: string;
      proofUrl?: string;
      spentKobo?: number;
      receiptUrl?: string;
    };

    const order = await prisma.order.findFirst({
      where: { id: orderId, riderId },
      select: { id: true, status: true, deliveryCode: true, type: true },
    });

    if (!order) throw notFound('Job');

    if (body.status === 'DELIVERED') {
      if (!body.deliveryCode) throw conflict('Ask the customer for their 4-digit code.');
      if (body.deliveryCode !== order.deliveryCode) {
        throw conflict('That code does not match. Check with the customer.');
      }
    }

    if (body.proofUrl && !isOwnCloudinaryUrl(body.proofUrl)) {
      throw badRequest('Take the delivery photo in the app.');
    }

    // Errand receipts reconcile the held budget against what was actually spent.
    if (order.type === 'ERRAND' && body.spentKobo !== undefined) {
      await prisma.errandDetail.update({
        where: { orderId },
        data: { spentKobo: body.spentKobo, receiptUrl: body.receiptUrl },
      });
    }

    const updated = await transitionOrder(
      orderId,
      body.status,
      { type: 'rider', id: riderId },
      { extra: body.proofUrl ? { proofUrl: body.proofUrl } : undefined }
    );

    res.json({ data: updated });
  })
);

/** GET /rider/earnings?range=today|week|month */
riderRouter.get(
  '/earnings',
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;
    const range = String(req.query.range ?? 'week');

    const since = new Date();
    if (range === 'today') since.setHours(0, 0, 0, 0);
    else if (range === 'month') since.setDate(since.getDate() - 30);
    else since.setDate(since.getDate() - 7);

    const [earnings, unpaid, rider] = await Promise.all([
      prisma.riderEarning.findMany({
        where: { riderId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { reference: true, type: true, deliveredAt: true } } },
      }),
      // voidedAt: null — a refunded delivery is not money the rider is owed,
      // and showing it as available promises something that will never arrive.
      prisma.riderEarning.aggregate({
        where: { riderId, isPaidOut: false, voidedAt: null },
        _sum: { netKobo: true },
      }),
      prisma.rider.findUnique({
        where: { id: riderId },
        select: { rating: true, completedJobs: true },
      }),
    ]);

    // Group into a day-by-day series for the bar chart.
    const byDay = new Map<string, number>();
    for (const e of earnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + e.netKobo);
    }

    const payable = await payableFor(riderId);

    res.json({
      data: {
        range,
        availableKobo: unpaid._sum.netKobo ?? 0,
        // Split out so the screen can say "₦X ready, ₦Y clearing" instead of
        // one number that does not match what a payout would actually send.
        payableKobo: payable.payableKobo,
        heldKobo: payable.heldKobo,
        holdHours: PAYOUT_HOLD_HOURS,
        minimumKobo: PAYOUT_MIN_KOBO,
        totalKobo: earnings.reduce((sum, e) => sum + e.netKobo, 0),
        trips: earnings.length,
        rating: rider?.rating ?? 5,
        completedJobs: rider?.completedJobs ?? 0,
        series: [...byDay.entries()]
          .map(([day, valueKobo]) => ({ day, valueKobo }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        earnings,
      },
    });
  })
);

// ── payout account ──────────────────────────────────────────────────

/** GET /rider/banks — the list to pick from. Cached for a day upstream. */
riderRouter.get(
  '/banks',
  asyncHandler(async (_req, res) => {
    res.json({ data: await listBanks() });
  })
);

const accountSchema = z.object({
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'A Nigerian account number is 10 digits.'),
});

/**
 * POST /rider/payout-account/resolve — who owns this account?
 *
 * Read-only on purpose. The rider sees the name the bank returns and confirms
 * it before anything is stored: the difference between a typo caught in three
 * seconds and a transfer into a stranger's account, which we cannot reverse.
 */
riderRouter.post(
  '/payout-account/resolve',
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const { bankCode, accountNumber } = req.body as z.infer<typeof accountSchema>;
    res.json({ data: await resolveAccount(accountNumber, bankCode) });
  })
);

/** PUT /rider/payout-account — stores the destination. */
riderRouter.put(
  '/payout-account',
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const { bankCode, accountNumber } = req.body as z.infer<typeof accountSchema>;

    const bank = (await listBanks()).find((b) => b.code === bankCode);
    if (!bank) throw badRequest('Pick a bank from the list.');

    // Resolved again rather than trusting whatever name the client sends
    // alongside the number. The stored name is what a human reads before
    // releasing money, so it has to come from the bank, not from the form.
    const resolved = await resolveAccount(accountNumber, bankCode);

    const rider = await prisma.rider.update({
      where: { id: req.auth!.id },
      data: {
        bankCode,
        bankAccountNo: accountNumber,
        bankName: bank.name,
        bankAccountName: resolved.accountName,
        // Changing the destination invalidates the recipient Paystack holds;
        // reusing it would send the next payout to the old account.
        paystackRecipientCode: null,
      },
      select: { bankCode: true, bankAccountNo: true, bankName: true, bankAccountName: true },
    });

    res.json({ data: rider });
  })
);

/** GET /rider/payouts — history, newest first. */
riderRouter.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const payouts = await prisma.payout.findMany({
      where: { riderId: req.auth!.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        amountKobo: true,
        status: true,
        reference: true,
        bankName: true,
        bankAccountNo: true,
        failureReason: true,
        createdAt: true,
        settledAt: true,
      },
    });
    res.json({ data: payouts });
  })
);

/** POST /rider/documents — verification upload. */
riderRouter.post(
  '/documents',
  validate(
    z.object({
      type: z.enum(['NIN', 'LICENCE', 'PHOTO', 'VEHICLE_PAPERS', 'GUARANTOR_FORM']),
      fileUrl: z.string().url(),
    })
  ),
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;
    const body = req.body as { type: 'NIN' | 'LICENCE' | 'PHOTO' | 'VEHICLE_PAPERS' | 'GUARANTOR_FORM'; fileUrl: string };

    // Must be an asset in our own Cloudinary account, not an arbitrary URL.
    if (!isOwnCloudinaryUrl(body.fileUrl)) {
      throw badRequest('Upload the document through the app before submitting it.');
    }

    const doc = await prisma.riderDocument.upsert({
      where: { riderId_type: { riderId, type: body.type } },
      create: { riderId, type: body.type, fileUrl: body.fileUrl, status: 'IN_REVIEW' },
      update: { fileUrl: body.fileUrl, status: 'IN_REVIEW', reviewNote: null, reviewedAt: null },
    });

    // Once every required document is in, move the rider into the admin queue.
    const REQUIRED = ['NIN', 'LICENCE', 'PHOTO', 'VEHICLE_PAPERS', 'GUARANTOR_FORM'];
    const submitted = await prisma.riderDocument.count({ where: { riderId } });
    if (submitted >= REQUIRED.length) {
      await prisma.rider.updateMany({
        where: { id: riderId, status: 'PENDING' },
        data: { status: 'IN_REVIEW' },
      });
    }

    res.status(201).json({ data: doc });
  })
);

/**
 * The errand loop, rider side.
 *
 * Three pings, each one a thing only the rider can know: what the item actually
 * costs, that they have it, and that they are at the door.
 */
const quoteSchema = z.object({
  actualItemKobo: z.number().int().min(1, 'Enter what the item costs.'),
  bankCode: z.string().min(3).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Nigerian account numbers are 10 digits.'),
});

/**
 * POST /rider/jobs/:id/quote
 *
 * The rider is standing at the stall. They report the real price and the
 * merchant's account, and the account is resolved against Paystack before the
 * customer ever sees it.
 *
 * Resolving is the whole safety property of the direct-to-merchant model. Sendy
 * never touches this money, so there is nothing to reverse and nothing to
 * refund — the only protection available is showing the customer whose account
 * they are about to pay. A rider entering their own number has to watch their
 * own name appear on the customer's screen.
 *
 * Re-quoting is allowed while the customer has not yet paid: prices move, and
 * the alternative is cancelling the job and starting again.
 */
riderRouter.post(
  '/jobs/:id/quote',
  requireApprovedRider,
  validate(quoteSchema),
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;
    const body = req.body as z.infer<typeof quoteSchema>;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, riderId, type: 'ERRAND' },
      include: { errandDetail: true },
    });
    if (!order) throw notFound('Errand');
    if (!order.errandDetail) throw badRequest('That order has no errand details.');
    if (!['RIDER_ASSIGNED', 'PRICE_PROPOSED'].includes(order.status)) {
      throw conflict('This errand is past the pricing stage.');
    }

    // Throws with a useful message if the account does not exist, and passes
    // Paystack's own wording through on a rate limit.
    const resolved = await resolveAccount(body.accountNumber, body.bankCode);
    const banks = await listBanks();
    const bankName = banks.find((b) => b.code === body.bankCode)?.name ?? null;

    await prisma.errandDetail.update({
      where: { orderId: order.id },
      data: {
        actualItemKobo: body.actualItemKobo,
        merchantBankCode: body.bankCode,
        merchantAccountNo: resolved.accountNumber,
        // Paystack's answer, never what the rider typed.
        merchantAccountName: resolved.accountName,
        merchantBankName: bankName,
      },
    });

    const updated = await transitionOrder(order.id, 'PRICE_PROPOSED', {
      type: 'rider',
      id: riderId,
    });

    res.json({
      data: {
        order: updated,
        merchant: {
          accountName: resolved.accountName,
          accountNumber: resolved.accountNumber,
          bankName,
        },
      },
    });
  })
);

/**
 * POST /rider/jobs/:id/asset-secured — the rider has the item.
 *
 * Gated on MERCHANT_PAID rather than allowed from PRICE_PROPOSED: a rider
 * cannot mark an item collected before the customer says they have paid for it,
 * which is the one ordering constraint the model depends on.
 */
riderRouter.post(
  '/jobs/:id/asset-secured',
  requireApprovedRider,
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, riderId, type: 'ERRAND' },
    });
    if (!order) throw notFound('Errand');

    /**
     * Already done is success, not a conflict.
     *
     * A rider whose screen has not caught up presses again — which is exactly
     * what a stale cache produces — and got told the errand was "not at the
     * collection stage" for a stage it had already passed. That reads as the
     * app losing their work at the moment they are holding someone's shopping.
     * Repeating the request returns the same answer instead.
     */
    if (['PICKED_UP', 'IN_TRANSIT', 'AT_DOORSTEP', 'DELIVERED'].includes(order.status)) {
      const current = await prisma.order.findUnique({ where: { id: order.id } });
      return res.json({ data: current });
    }

    if (order.status !== 'MERCHANT_PAID') {
      throw conflict(
        order.status === 'PRICE_PROPOSED'
          ? 'The customer has not confirmed payment to the seller yet.'
          : 'This errand is not at the collection stage.'
      );
    }

    await prisma.errandDetail.update({
      where: { orderId: order.id },
      data: { assetSecuredAt: new Date() },
    });

    const updated = await transitionOrder(order.id, 'PICKED_UP', { type: 'rider', id: riderId });
    res.json({ data: updated });
  })
);

/** POST /rider/jobs/:id/doorstep — the rider has arrived. */
riderRouter.post(
  '/jobs/:id/doorstep',
  requireApprovedRider,
  asyncHandler(async (req, res) => {
    const riderId = req.auth!.id;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, riderId },
    });
    if (!order) throw notFound('Job');

    // Same reasoning as asset-secured: a second press is the same intent.
    if (['AT_DOORSTEP', 'DELIVERED'].includes(order.status)) {
      const current = await prisma.order.findUnique({ where: { id: order.id } });
      return res.json({ data: current });
    }

    if (!['PICKED_UP', 'IN_TRANSIT'].includes(order.status)) {
      throw conflict('Collect the item before announcing arrival.');
    }

    if (order.type === 'ERRAND') {
      await prisma.errandDetail.updateMany({
        where: { orderId: order.id },
        data: { atDoorstepAt: new Date() },
      });
    }

    const updated = await transitionOrder(order.id, 'AT_DOORSTEP', { type: 'rider', id: riderId });
    res.json({ data: updated });
  })
);

/**
 * POST /rider/jobs/:id/bid — ask for more than the customer offered.
 *
 * The alternative to this is the plain accept, which is unchanged and remains
 * the fast path: a rider happy with the offer takes the job in one tap and no
 * customer decision is involved. This exists for the rider who wants the job
 * but not at that price, and it is why the board still shows a number.
 */
riderRouter.post(
  '/jobs/:id/bid',
  validate(z.object({ priceKobo: z.number().int().positive(), note: z.string().max(140).optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as { priceKobo: number; note?: string };

    const bid = await counterBid({
      orderId: req.params.id!,
      riderId: req.auth!.id,
      priceKobo: body.priceKobo,
      note: body.note,
    });

    res.status(201).json({ data: bid });
  })
);

/** DELETE /rider/jobs/:id/bid — withdraw it. Idempotent. */
riderRouter.delete(
  '/jobs/:id/bid',
  asyncHandler(async (req, res) => {
    await prisma.deliveryBid.updateMany({
      where: { orderId: req.params.id!, riderId: req.auth!.id, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });

    res.json({ data: { withdrawn: true } });
  })
);
