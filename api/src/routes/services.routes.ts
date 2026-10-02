import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { deliveryCode, orderReference } from '@/lib/reference';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { transitionOrder } from '@/services/orders';

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

    // Copied, not referenced: a later price change must not rewrite what this
    // customer was charged.
    const arrivalFeeKobo =
      body.arrivalMode === 'BIKE' ? provider.bikeFeeKobo : provider.carFeeKobo;

    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        type: 'SERVICE',
        channel: 'APP',
        status: 'QUOTE_REQUESTED',
        deliveryCode: deliveryCode(),
        customer: { connect: { id: customerId } },
        // What the customer owes Sendy — the arrival, and only the arrival.
        serviceFeeKobo: arrivalFeeKobo,
        totalKobo: arrivalFeeKobo,
        serviceDetail: {
          create: {
            providerId: provider.id,
            task: body.task,
            details: body.details ?? null,
            address: body.address,
            landmark: body.landmark ?? null,
            arrivalMode: body.arrivalMode,
            arrivalFeeKobo,
            scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
            budgetKobo: body.budgetKobo ?? null,
          },
        },
      },
      include: { serviceDetail: { include: { provider: true } } },
    });

    res.status(201).json({ data: order });
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
      throw conflict('Pay the Sendy arrival fee first.');
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

    await prisma.serviceDetail.update({
      where: { orderId: detail.orderId },
      data: { quotedKobo },
    });

    const updated = await transitionOrder(detail.orderId, 'PRICE_PROPOSED', {
      type: 'vendor',
      id: req.auth!.id,
    });

    res.json({ data: { order: updated, quotedKobo } });
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

    await prisma.serviceDetail.update({
      where: { orderId: detail.orderId },
      data: { completedAt: new Date() },
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
