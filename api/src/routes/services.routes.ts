import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { deliveryCode, orderReference } from '@/lib/reference';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { transitionOrder } from '@/services/orders';
import { riderPayout } from '@/lib/money';
import { notifyRider } from '@/services/notifications';
import { listBanks, resolveAccount } from '@/services/paystack';
import { computeServiceCharges, describeServiceCharges } from '@/services/service-pricing';

/**
 * Services — someone comes to you and does a job.
 *
 * The fifth pillar, and deliberately the errand flow wearing different clothes.
 * A service booking is the same shape as a market run: the customer describes
 * what they want, the person doing it is the only one who can price it, and
 * that pricing happens after they can see the job. So it reuses the same
 * statuses rather than inventing a parallel set —
 *
 *   QUOTE_REQUESTED  booked, provider has not priced it
 *   PRICE_PROPOSED   provider has named a price; customer decides
 *   MERCHANT_PAID    customer says they have paid the provider
 *   IN_TRANSIT       provider is on the way
 *   DELIVERED        job done
 *
 * What differs is the money. On an errand Sendy charges a dispatch fee and the
 * rider buys goods; here Sendy charges only for getting the provider to the
 * door, and the fee is decided by *how* they travel. The work itself is paid to
 * the provider directly and Sendy never touches it — same as the item cost on
 * an errand, and for the same reason.
 */
export const servicesRouter = Router();

/* ── browse ──────────────────────────────────────────────────────────── */

/**
 * GET /services/providers — the browse grid.
 *
 * Public: someone should be able to see whether there is a barber near them
 * before being asked to make an account, exactly as the marketplace works.
 */
servicesRouter.get(
  '/providers',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const category =
      typeof req.query.category === 'string' && req.query.category !== 'All'
        ? req.query.category
        : undefined;
    const state =
      typeof req.query.state === 'string' && req.query.state !== 'All' ? req.query.state : undefined;

    const providers = await prisma.serviceProvider.findMany({
      where: {
        isAvailable: true,
        ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
        ...(state ? { state } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
                { tags: { has: q } },
              ],
            }
          : {}),
      },
      // Verified first, then best rated. A customer letting a stranger into
      // their house is choosing on trust before price.
      orderBy: [{ isVerified: 'desc' }, { rating: 'desc' }, { ratingCount: 'desc' }],
      take: 50,
    });

    res.json({ data: providers });
  })
);

/**
 * GET /services/categories — the filter chips.
 *
 * Derived from providers who are actually available, so the filter can never
 * offer a category that returns an empty grid.
 */
servicesRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.serviceProvider.findMany({
      where: { isAvailable: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    res.json({ data: rows.map((r) => r.category) });
  })
);

/** GET /services/providers/:slug — one provider, for the detail screen. */
servicesRouter.get(
  '/providers/:slug',
  asyncHandler(async (req, res) => {
    const provider = await prisma.serviceProvider.findUnique({
      where: { slug: req.params.slug! },
      include: {
        /* Cheapest first, so the list reads as a ladder. Inactive tiers are
           left out entirely rather than shown greyed: a price a provider has
           retired is not a price. */
        packages: {
          where: { isActive: true },
          orderBy: { priceKobo: 'asc' },
          select: { id: true, tier: true, name: true, description: true, priceKobo: true },
        },
      },
    });
    if (!provider) throw notFound('Provider');
    res.json({ data: provider });
  })
);

/* ── booking ─────────────────────────────────────────────────────────── */

const bookSchema = z.object({
  providerSlug: z.string().min(1).max(120),
  task: z.string().trim().min(3).max(200),
  details: z.string().trim().max(1000).optional(),
  address: z.string().trim().min(3).max(240),
  landmark: z.string().trim().max(160).optional(),
  arrivalMode: z.enum(['BIKE', 'CAR']),
  /** ISO. Absent means as soon as possible. */
  scheduledFor: z.string().datetime().optional(),
  /** What the customer expects to pay the provider. Never charged. */
  budgetKobo: z.number().int().min(0).optional(),
  /**
   * A tier the provider publishes, if the customer picked one.
   *
   * Picking one is what makes a service bookable at a known price: the
   * provider has already said what that tier costs, so there is nothing left
   * to quote. Without it the booking goes out unpriced and waits for a quote,
   * which is the ordinary path and stays exactly as it was.
   */
  packageId: z.string().min(1).max(40).optional(),
});

/**
 * POST /services/bookings — book a provider.
 *
 * Sendy's charge is the arrival fee and nothing else, so totalKobo is the
 * arrival fee alone. The price of the work is not known yet and, when it is, it
 * still does not belong here — the customer pays the provider directly.
 */
servicesRouter.post(
  '/bookings',
  requireAuth('customer'),
  validate(bookSchema),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const body = req.body as z.infer<typeof bookSchema>;

    const provider = await prisma.serviceProvider.findUnique({
      where: { slug: body.providerSlug },
    });
    if (!provider) throw notFound('Provider');
    if (!provider.isAvailable) throw conflict('That provider is not taking bookings right now.');

    /**
     * Refused rather than silently upgraded to a car.
     *
     * Some providers cannot ride — a cleaner with a vacuum, a plumber with
     * pipe. Quietly charging the car fee instead would take more money than
     * the customer agreed to; quietly sending them by bike would book
     * something that cannot happen.
     */
    if (body.arrivalMode === 'BIKE' && !provider.canTravelByBike) {
      throw badRequest(
        `${provider.name} travels by car — their equipment does not go on a bike. Choose car arrival.`
      );
    }

    /*
      A chosen tier is a price the provider has already published, so there is
      nothing left to quote: the booking is priced on the spot and goes out at
      PRICE_PROPOSED. Without one it goes out unpriced, as before.

      Looked up against THIS provider, not by id alone — otherwise a customer
      could book Kay Cuts at a cheaper provider's VIP price by passing someone
      else's package id.
    */
    const pkg = body.packageId
      ? await prisma.servicePackage.findFirst({
          where: { id: body.packageId, providerId: provider.id, isActive: true },
          select: { id: true, priceKobo: true, tier: true },
        })
      : null;
    if (body.packageId && !pkg) {
      throw badRequest('That package is no longer offered. Pick another, or ask for a quote.');
    }

    /*
      The three charges, from the one place that defines them.

      Note what is NOT charged any more: the flat bike/car arrival fee.
      Transport is now 5% of the quote, so arrivalFeeKobo is written as 0.
      arrivalMode is still asked and still stored — the customer needs to know
      whether someone arrives on a bike with a bag or in a car with equipment,
      and some providers cannot ride at all.
    */
    const charges = computeServiceCharges(pkg?.priceKobo ?? 0);

    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        type: 'SERVICE',
        channel: 'APP',
        status: pkg ? 'PRICE_PROPOSED' : 'QUOTE_REQUESTED',
        deliveryCode: deliveryCode(),
        customer: { connect: { id: customerId } },
        // Zero until there is a price. An unpriced booking showing ₦500 of
        // service fee would be charging for a job nobody has agreed to yet.
        serviceFeeKobo: charges.serviceFeeKobo,
        totalKobo: charges.totalKobo,
        serviceDetail: {
          create: {
            providerId: provider.id,
            task: body.task,
            details: body.details ?? null,
            address: body.address,
            landmark: body.landmark ?? null,
            arrivalMode: body.arrivalMode,
            arrivalFeeKobo: 0,
            packageId: pkg?.id ?? null,
            quotedKobo: pkg ? pkg.priceKobo : null,
            serviceFeeKobo: charges.serviceFeeKobo,
            serviceChargeKobo: charges.serviceChargeKobo,
            transportKobo: charges.transportKobo,
            scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
            budgetKobo: body.budgetKobo ?? null,
          },
        },
      },
      include: { serviceDetail: { include: { provider: true, package: true } } },
    });

    res.status(201).json({
      data: order,
      charges,
      breakdown: describeServiceCharges(charges),
    });
  })
);

/* ── the customer's side of the negotiation ──────────────────────────── */

/**
 * POST /services/bookings/:id/accept — the customer has paid the provider.
 *
 * A claim, not a verified fact: the money goes customer to provider and Sendy
 * never sees it. What this records is a timestamp and, optionally, a receipt —
 * which is most of what a dispute actually needs.
 *
 * The arrival fee has to be settled first, for the same reason the errand flow
 * insists on it: once the provider is told they have been paid they set off,
 * and letting that happen unpaid means doing the work for free.
 */
servicesRouter.post(
  '/bookings/:id/accept',
  requireAuth('customer'),
  validate(z.object({ proofUrl: z.string().url().optional() })),
  asyncHandler(async (req, res) => {
    const { proofUrl } = req.body as { proofUrl?: string };

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, customerId: req.auth!.id, type: 'SERVICE' },
      include: { serviceDetail: true },
    });
    if (!order) throw notFound('Booking');
    if (order.status !== 'PRICE_PROPOSED') {
      throw conflict(
        order.status === 'QUOTE_REQUESTED'
          ? 'That provider has not given you a price yet.'
          : 'This booking is past that stage.'
      );
    }
    if (order.serviceDetail?.quotedKobo == null) {
      throw badRequest('There is no price to accept yet.');
    }

    const settled = await prisma.payment.aggregate({
      where: { orderId: order.id, status: 'SUCCESS' },
      _sum: { amountKobo: true },
    });
    if ((settled._sum.amountKobo ?? 0) < order.totalKobo) {
      throw conflict('Pay for the booking first.');
    }

    await prisma.serviceDetail.update({
      where: { orderId: order.id },
      data: { paidProviderAt: new Date(), paymentProofUrl: proofUrl ?? null },
    });

    const updated = await transitionOrder(order.id, 'MERCHANT_PAID', {
      type: 'customer',
      id: req.auth!.id,
    });
    res.json({ data: updated });
  })
);

/* ── the provider's side ─────────────────────────────────────────────── */

/**
 * GET /services/jobs — what this provider has been booked for.
 *
 * Newest first, and open work before finished work: a provider opens this to
 * find what needs doing, not to read history.
 */
servicesRouter.get(
  '/jobs',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const details = await prisma.serviceDetail.findMany({
      where: { providerId: req.auth!.id },
      include: {
        order: {
          select: {
            id: true,
            reference: true,
            status: true,
            totalKobo: true,
            createdAt: true,
            deliveryCode: true,
            customer: { select: { firstName: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ data: details });
  })
);

const quoteSchema = z.object({
  quotedKobo: z.number().int().min(1, 'Enter what the job costs.'),
});

/**
 * POST /services/jobs/:id/quote — the provider names a price.
 *
 * The whole point of the pillar: nobody can price a haircut, a leak or a deep
 * clean from a form. The provider sees the task, the address and the photos,
 * and says what it costs.
 *
 * Re-quoting from PRICE_PROPOSED is allowed while the customer has not paid —
 * the job is often not what the description said, and the alternative is
 * cancelling and starting again.
 */
servicesRouter.post(
  '/jobs/:id/quote',
  requireAuth('provider'),
  validate(quoteSchema),
  asyncHandler(async (req, res) => {
    const { quotedKobo } = req.body as z.infer<typeof quoteSchema>;

    const detail = await prisma.serviceDetail.findFirst({
      where: { orderId: req.params.id!, providerId: req.auth!.id },
      include: { order: { select: { id: true, status: true } } },
    });
    if (!detail) throw notFound('Job');
    if (!['QUOTE_REQUESTED', 'PRICE_PROPOSED'].includes(detail.order.status)) {
      throw conflict('This job is past the pricing stage.');
    }

    /*
      The quote is the base for everything Sendy charges, so the breakdown is
      computed and stored the moment it arrives rather than at read time. A
      rate change next month must not silently rewrite what this customer was
      quoted today.

      The order's own total is the customer-facing number: quote plus the three
      charges. The provider is paid the quote itself - the charges sit on top
      rather than being deducted, so the provider receives the figure they
      actually named.
    */
    const charges = computeServiceCharges(quotedKobo);

    await prisma.$transaction([
      prisma.serviceDetail.update({
        where: { orderId: detail.orderId },
        data: {
          quotedKobo,
          serviceFeeKobo: charges.serviceFeeKobo,
          serviceChargeKobo: charges.serviceChargeKobo,
          transportKobo: charges.transportKobo,
        },
      }),
      prisma.order.update({
        where: { id: detail.orderId },
        data: { totalKobo: charges.totalKobo, serviceFeeKobo: charges.serviceFeeKobo },
      }),
    ]);

    const updated = await transitionOrder(detail.orderId, 'PRICE_PROPOSED', {
      type: 'vendor',
      id: req.auth!.id,
    });

    res.json({
      data: {
        order: updated,
        quotedKobo,
        /* The customer is shown what each charge is, not just a total they
           have to take on trust. */
        charges,
        breakdown: describeServiceCharges(charges),
      },
    });
  })
);

/**
 * POST /services/jobs/:id/en-route — the provider has set off.
 *
 * Gated on MERCHANT_PAID, the same ordering the errand flow uses: a provider
 * does not travel until the customer has confirmed payment, because the journey
 * is the part Sendy has already charged for.
 */
servicesRouter.post(
  '/jobs/:id/en-route',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const detail = await prisma.serviceDetail.findFirst({
      where: { orderId: req.params.id!, providerId: req.auth!.id },
      include: { order: { select: { status: true } } },
    });
    if (!detail) throw notFound('Job');
    if (detail.order.status !== 'MERCHANT_PAID') {
      throw conflict(
        detail.order.status === 'PRICE_PROPOSED'
          ? 'The customer has not confirmed payment yet.'
          : 'This job is not at that stage.'
      );
    }

    await prisma.serviceDetail.update({
      where: { orderId: detail.orderId },
      data: { enRouteAt: new Date() },
    });
    const updated = await transitionOrder(detail.orderId, 'IN_TRANSIT', {
      type: 'vendor',
      id: req.auth!.id,
    });
    res.json({ data: updated });
  })
);

/**
 * POST /services/jobs/:id/complete — the job is done.
 *
 * Takes the customer's delivery code, exactly as a rider's handover does. It is
 * the only thing standing between "I turned up" and "I did the work", and the
 * customer is the only one who has it.
 */
servicesRouter.post(
  '/jobs/:id/complete',
  requireAuth('provider'),
  validate(z.object({ deliveryCode: z.string().trim().min(1, 'Ask the customer for their code.') })),
  asyncHandler(async (req, res) => {
    const { deliveryCode: code } = req.body as { deliveryCode: string };

    const detail = await prisma.serviceDetail.findFirst({
      where: { orderId: req.params.id!, providerId: req.auth!.id },
      include: { order: { select: { status: true, deliveryCode: true } } },
    });
    if (!detail) throw notFound('Job');
    if (!['MERCHANT_PAID', 'IN_TRANSIT'].includes(detail.order.status)) {
      throw conflict('This job is not at that stage.');
    }
    if (!detail.order.deliveryCode || detail.order.deliveryCode !== code.trim()) {
      throw badRequest('That code does not match. Ask the customer to read it from their booking.');
    }

    /*
      Completing the job is what makes the provider owed money.

      Written here rather than at payout time because the payout reads from
      earnings: with no row there is nothing to pay out, and the provider's
      balance would sit at zero however much work they did. The same shape the
      rider flow uses, for the same reason.

      The amounts come from what was STORED at quote time, not from recomputing
      the rates now - this is the number the customer agreed to, and a rate
      change between quote and completion must not move it.

      `create` rather than `upsert`, with orderId unique: completing twice is a
      double payment, and the database refusing it is better than this code
      remembering to check.
    */
    const feesKobo =
      detail.serviceFeeKobo + detail.serviceChargeKobo + detail.transportKobo;
    const grossKobo = detail.quotedKobo ?? 0;

    await prisma.$transaction(async (tx) => {
      await tx.serviceDetail.update({
        where: { orderId: detail.orderId },
        data: { completedAt: new Date() },
      });

      // A job completed with no quote earns nothing rather than a negative
      // number. It should not be reachable - completing requires MERCHANT_PAID,
      // which requires a quote - but a belt here is cheaper than a support
      // ticket about a provider who owes Sendy money.
      if (grossKobo > 0) {
        await tx.providerEarning.create({
          data: {
            providerId: detail.providerId,
            orderId: detail.orderId,
            grossKobo,
            feesKobo,
            // The provider is paid their quote; the charges were added on top
            // of it, not taken out of it.
            netKobo: grossKobo,
          },
        });
      }
    });

    const updated = await transitionOrder(detail.orderId, 'DELIVERED', {
      type: 'vendor',
      id: req.auth!.id,
    });
    res.json({ data: updated });
  })
);

/**
 * POST /services/bookings/:id/decline — not at that price.
 *
 * An ordinary cancel, named for what the customer is doing. Allowed only while
 * walking away is still free: once the provider has been paid there is nothing
 * to cancel, because that money has already left.
 */
servicesRouter.post(
  '/bookings/:id/decline',
  requireAuth('customer'),
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, customerId: req.auth!.id, type: 'SERVICE' },
      select: { id: true, status: true },
    });
    if (!order) throw notFound('Booking');
    if (!['QUOTE_REQUESTED', 'PRICE_PROPOSED'].includes(order.status)) {
      throw conflict(
        order.status === 'MERCHANT_PAID'
          ? 'You have already paid this provider, and that cannot be reversed from here. Contact support.'
          : 'This booking can no longer be declined.'
      );
    }

    const updated = await transitionOrder(
      order.id,
      'CANCELLED',
      { type: 'customer', id: req.auth!.id },
      { note: reason, extra: { cancelReason: reason ?? 'Price declined by customer' } }
    );
    res.json({ data: updated });
  })
);


/* =========================================================================
   Getting paid.
   =========================================================================

   Deliberately the same endpoints, in the same order, with the same rules as
   the rider's: /me, /earnings, /banks, /payout-account/resolve,
   /payout-account, /payouts. A provider portal that works differently from the
   rider portal is two things to maintain and two things to explain, and there
   is nothing about a barber's bank account that differs from a rider's.

   None of this existed. Services shipped with the customer paying the provider
   bank-to-bank, so there was nothing to pay out and no account to pay it to.
   Sendy now collects, which makes Sendy a debtor - and a debtor needs somewhere
   to send the money.
   ========================================================================= */

/** GET /services/me — the provider's own listing, as they see it. */
servicesRouter.get(
  '/me',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const provider = await prisma.serviceProvider.findUnique({
      where: { id: req.auth!.id },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        bio: true,
        tags: true,
        area: true,
        state: true,
        phone: true,
        email: true,
        avatarUrl: true,
        rating: true,
        ratingCount: true,
        isVerified: true,
        isAvailable: true,
        canTravelByBike: true,
        /* The payout destination, minus anything that would let a stolen
           session move money: the recipient code is Paystack's handle and is
           never sent to a client. */
        bankCode: true,
        bankName: true,
        bankAccountNo: true,
        bankAccountName: true,
        packages: {
          where: { isActive: true },
          orderBy: { priceKobo: 'asc' },
          select: { id: true, tier: true, name: true, description: true, priceKobo: true },
        },
      },
    });
    if (!provider) throw notFound('Provider');
    res.json({ data: provider });
  })
);

/** PATCH /services/me/availability — the provider's own on/off switch. */
servicesRouter.patch(
  '/me/availability',
  requireAuth('provider'),
  validate(z.object({ isAvailable: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { isAvailable } = req.body as { isAvailable: boolean };
    const provider = await prisma.serviceProvider.update({
      where: { id: req.auth!.id },
      data: { isAvailable },
      select: { isAvailable: true },
    });
    res.json({ data: provider });
  })
);

/**
 * GET /services/earnings — what they have made, and what is still owed.
 *
 * `payable` is the number that matters and the one most easily got wrong: it
 * is what is neither already paid out nor voided. An earning attached to a
 * payout that later failed has its payoutId cleared and returns here, which is
 * why the filter is on isPaidOut rather than on payoutId being null.
 */
servicesRouter.get(
  '/earnings',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const providerId = req.auth!.id;

    const [agg, payable, recent] = await Promise.all([
      prisma.providerEarning.aggregate({
        where: { providerId, voidedAt: null },
        _sum: { netKobo: true, feesKobo: true, grossKobo: true },
        _count: { _all: true },
      }),
      prisma.providerEarning.aggregate({
        where: { providerId, voidedAt: null, isPaidOut: false },
        _sum: { netKobo: true },
      }),
      prisma.providerEarning.findMany({
        where: { providerId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          grossKobo: true,
          feesKobo: true,
          netKobo: true,
          isPaidOut: true,
          paidOutAt: true,
          voidedAt: true,
          createdAt: true,
          order: { select: { reference: true } },
        },
      }),
    ]);

    res.json({
      data: {
        jobsCompleted: agg._count._all,
        grossKobo: agg._sum.grossKobo ?? 0,
        /* What Sendy took across those jobs. Shown rather than hidden: a
           provider who cannot see the deduction assumes the worst about it. */
        feesKobo: agg._sum.feesKobo ?? 0,
        earnedKobo: agg._sum.netKobo ?? 0,
        payableKobo: payable._sum.netKobo ?? 0,
        recent,
      },
    });
  })
);

/** GET /services/banks — the list, for the payout form. */
servicesRouter.get(
  '/banks',
  requireAuth('provider'),
  asyncHandler(async (_req, res) => {
    res.json({ data: await listBanks() });
  })
);

const providerAccountSchema = z.object({
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'A Nigerian account number is 10 digits.'),
});

/**
 * POST /services/payout-account/resolve — who owns this account?
 *
 * Read-only. The provider sees the name the bank returns and confirms it
 * before anything is stored: the difference between a typo caught in three
 * seconds and a transfer into a stranger's account, which cannot be reversed.
 */
servicesRouter.post(
  '/payout-account/resolve',
  requireAuth('provider'),
  validate(providerAccountSchema),
  asyncHandler(async (req, res) => {
    const { bankCode, accountNumber } = req.body as z.infer<typeof providerAccountSchema>;
    res.json({ data: await resolveAccount(accountNumber, bankCode) });
  })
);

/** PUT /services/payout-account — stores the destination. */
servicesRouter.put(
  '/payout-account',
  requireAuth('provider'),
  validate(providerAccountSchema),
  asyncHandler(async (req, res) => {
    const { bankCode, accountNumber } = req.body as z.infer<typeof providerAccountSchema>;

    const bank = (await listBanks()).find((b) => b.code === bankCode);
    if (!bank) throw badRequest('Pick a bank from the list.');

    // Resolved again rather than trusting a name the client sends alongside
    // the number: the stored name is what a human reads before releasing
    // money, so it comes from the bank, not from the form.
    const resolved = await resolveAccount(accountNumber, bankCode);

    const provider = await prisma.serviceProvider.update({
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

    res.json({ data: provider });
  })
);

/** GET /services/payouts — history, newest first. */
servicesRouter.get(
  '/payouts',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const payouts = await prisma.providerPayout.findMany({
      where: { providerId: req.auth!.id },
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


/* =========================================================================
   Getting the provider to the job on a Sendy rider.
   =========================================================================

   A provider either makes their own way or takes one of ours. This is the
   second: they pick from the pool of registered riders rather than being
   assigned one, because they are the person who knows what they are carrying
   and whether a bike can take it.

   The ride is attached to the CUSTOMER'S existing service order rather than
   modelled as an order of its own. A ServiceProvider is not a User and cannot
   own an order, so giving them one would mean making Order.customerId nullable
   - the first non-additive migration on a live table, to express something the
   existing shape already holds: an order can carry both a provider and a
   rider, and this is one job, not two.

   The rider is paid out of the transport charge the customer already paid, via
   the earnings machinery that already exists. Nothing new collects money.
   ========================================================================= */

/**
 * GET /services/jobs/:id/riders — who could take this provider to the job.
 *
 * Filtered on what the job actually needs, not on everything available. A
 * provider whose kit cannot go on a bike is shown cars and vans only: offering
 * a motorbike they would have to refuse is the dead control this codebase
 * keeps being bitten by, and the refusal would come after the customer is
 * already waiting.
 */
servicesRouter.get(
  '/jobs/:id/riders',
  requireAuth('provider'),
  asyncHandler(async (req, res) => {
    const detail = await prisma.serviceDetail.findFirst({
      where: { orderId: req.params.id!, providerId: req.auth!.id },
      select: {
        orderId: true,
        transportKobo: true,
        provider: { select: { canTravelByBike: true } },
        order: { select: { status: true, riderId: true } },
      },
    });
    if (!detail) throw notFound('Job');

    /* Heavy kit cannot go on two wheels. FOOT and BICYCLE are excluded for
       everyone here — this is a trip to a customer with equipment, not a
       document drop. */
    const heavy = !detail.provider.canTravelByBike;
    const usable: ('MOTORBIKE' | 'TRICYCLE' | 'CAR' | 'VAN')[] = heavy
      ? ['CAR', 'VAN']
      : ['MOTORBIKE', 'TRICYCLE', 'CAR', 'VAN'];

    const riders = await prisma.rider.findMany({
      where: { status: 'APPROVED', isOnline: true, vehicleType: { in: usable } },
      orderBy: [{ rating: 'desc' }, { completedJobs: 'desc' }],
      take: 20,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        vehicleType: true,
        rating: true,
        completedJobs: true,
      },
    });

    res.json({
      data: {
        riders,
        /* What the rider would earn on this job, shown up front: the provider
           is choosing on the customer's behalf and should see that picking a
           rider costs the customer nothing extra - it comes out of transport
           they have already paid. */
        riderEarnsKobo: riderPayout(detail.transportKobo),
        alreadyAssigned: Boolean(detail.order.riderId),
        requiresCar: heavy,
      },
    });
  })
);

/**
 * POST /services/jobs/:id/rider — the provider picks one.
 *
 * Idempotent-ish by refusal: a job that already has a rider is not silently
 * reassigned. Two riders dispatched for one job is two people turning up and
 * one of them unpaid.
 */
servicesRouter.post(
  '/jobs/:id/rider',
  requireAuth('provider'),
  validate(z.object({ riderId: z.string().min(1).max(40) })),
  asyncHandler(async (req, res) => {
    const { riderId } = req.body as { riderId: string };

    const detail = await prisma.serviceDetail.findFirst({
      where: { orderId: req.params.id!, providerId: req.auth!.id },
      select: {
        orderId: true,
        transportKobo: true,
        address: true,
        provider: { select: { name: true, canTravelByBike: true } },
        order: { select: { reference: true, status: true, riderId: true } },
      },
    });
    if (!detail) throw notFound('Job');
    if (detail.order.riderId) throw conflict('This job already has a rider on the way.');

    /* Only once the customer has paid. Before that the job may still be
       declined, and dispatching a rider to a booking nobody has committed to
       is a trip somebody has to pay for. */
    if (!['MERCHANT_PAID', 'IN_TRANSIT'].includes(detail.order.status)) {
      throw conflict('You can book a rider once the customer has paid.');
    }

    const rider = await prisma.rider.findFirst({
      where: { id: riderId, status: 'APPROVED', isOnline: true },
      select: { id: true, firstName: true, vehicleType: true },
    });
    if (!rider) throw badRequest('That rider is no longer available. Pick another.');

    // The same vehicle rule the list applied, enforced rather than trusted:
    // the list is a suggestion, this is the decision.
    if (!detail.provider.canTravelByBike && !['CAR', 'VAN'].includes(rider.vehicleType ?? '')) {
      throw badRequest(`${rider.firstName} is on a bike, and your kit needs a car.`);
    }

    /* One transaction: a rider assigned with no notification is a job nobody
       is told about, and a notification with no assignment is a lie. */
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: detail.orderId },
        data: {
          riderId: rider.id,
          /*
            What the rider is owed, from the transport the customer already
            paid. Set HERE because the existing earnings machinery books a
            rider's cut from riderPayoutKobo when the order is delivered -
            leaving it at zero would dispatch someone who is never paid, which
            is exactly how a rider ends up doing a job for nothing.
          */
          riderPayoutKobo: riderPayout(detail.transportKobo),
        },
        select: { id: true, reference: true, riderId: true, riderPayoutKobo: true },
      });

      await notifyRider(tx, {
        riderId: rider.id,
        title: 'A provider needs a lift',
        body: `${detail.provider.name} needs taking to ${detail.address}.`,
        orderId: detail.orderId,
      });

      return order;
    });

    res.json({ data: updated });
  })
);
