import { Router } from 'express';
import { z } from 'zod';

import { env } from '@/config/env';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { computeTotals, riderPayout } from '@/lib/money';
import { prisma } from '@/lib/prisma';
import { deliveryCode, orderReference } from '@/lib/reference';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { notifyOrderPlaced } from '@/services/notifications';
import { buildStepper, transitionOrder } from '@/services/orders';

export const ordersRouter = Router();

ordersRouter.use(requireAuth('customer'));

const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
  note: z.string().max(200).optional(),
});

const createOrderSchema = z.object({
  vendorId: z.string().min(1),
  addressId: z.string().min(1),
  items: z.array(cartItemSchema).min(1, 'Your cart is empty.'),
  scheduledFor: z.coerce.date().optional(),
  /*
   * discountKobo used to be accepted here, from the request body, and passed
   * straight into computeTotals. Item prices are looked up server-side from the
   * product rows, so those could not be forged — but the discount was simply
   * believed, and computeTotals subtracts it from the gross. A crafted request
   * carrying a large enough discount produced totalKobo: 0 on a real order,
   * which a real rider would then be dispatched to fulfil, against a live
   * Paystack account.
   *
   * No client ever sent it: the app reads discountKobo back off an order and
   * has never written it. Nothing legitimate is lost by removing it.
   *
   * When promotions exist, the discount gets computed here from a promo code
   * and the customer's own order history — server-side, from data the customer
   * cannot edit. A number the client chooses is not a discount, it is a price.
   */
});

const errandSchema = z.object({
  addressId: z.string().min(1),
  task: z.string().min(3).max(300),
  details: z.string().max(1000).optional(),
  pickupName: z.string().min(2).max(160),
  pickupAddress: z.string().min(4).max(240),
  budgetKobo: z.number().int().min(0).optional(),
  photoUrls: z.array(z.string().url()).max(3).default([]),
});

const packageSchema = z.object({
  pickupName: z.string().min(2).max(120),
  pickupAddress: z.string().min(4).max(240),
  pickupPhone: z.string().min(10).max(20).optional(),
  dropoffName: z.string().min(2).max(120),
  dropoffAddress: z.string().min(4).max(240),
  dropoffPhone: z.string().min(10).max(20),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE']).default('SMALL'),
  contents: z.string().max(80).optional(),
  isFragile: z.boolean().default(false),
  notes: z.string().max(500).optional(),
  addressId: z.string().optional(),
  scheduledFor: z.coerce.date().optional(),
  /**
   * Where the parcel starts and ends, for interstate pricing. Optional so the
   * existing same-city flow keeps working untouched — omitted, both ends are
   * assumed to be in one state and the local fee applies.
   */
  originState: z.string().max(40).optional(),
  destinationState: z.string().max(40).optional(),
});

/**
 * Parcel pricing. Kept server-side so the app can never invent a cheaper fee.
 *
 * Keyed to the schema's own enum rather than `Record<string, number>`: that
 * made every lookup `number | undefined`, so the call sites needed a `??`
 * fallback that would silently charge the default fee if a size key were ever
 * misspelled. Tying it to the enum makes the lookup total — a new size becomes
 * a compile error here instead of an underpriced delivery.
 */
type ParcelSize = z.infer<typeof packageSchema>['size'];

const PARCEL_FEE_KOBO: Record<ParcelSize, number> = {
  SMALL: 130_000,
  MEDIUM: 190_000,
  LARGE: 280_000,
  EXTRA_LARGE: 420_000,
};

/**
 * Added on top of the local fee when a parcel crosses a state line.
 *
 * The fee used to be size alone, which was fine while everything moved inside
 * Lagos. It stops being fine the moment the app offers Lagos → Kano: that is a
 * different vehicle, a different number of days and a different cost, and
 * charging ₦1,300 for it would be a promise the business cannot keep.
 *
 * Kept as a flat surcharge per size rather than a per-kilometre rate because
 * nothing here knows distances — there is no maps provider — and a made-up
 * distance is worse than an honest band. Every interstate route costs the same
 * today; when real lane data exists this is where it goes.
 */
const INTERSTATE_SURCHARGE_KOBO: Record<ParcelSize, number> = {
  SMALL: 270_000,
  MEDIUM: 410_000,
  LARGE: 620_000,
  EXTRA_LARGE: 930_000,
};

/**
 * The states are compared here rather than trusted from a client-sent flag.
 * A boolean like `isInterstate` on the request would let anyone post an
 * interstate parcel at the local price.
 */
/**
 * Appends the state unless the address already names it, so a customer who
 * typed "…, Ikeja, Lagos" does not get "Lagos, Lagos" back on the job card.
 * Truncated to the column's 240 characters.
 */
function withState(address: string, state?: string): string {
  const trimmed = address.trim();
  if (!state) return trimmed;
  if (trimmed.toLowerCase().includes(state.trim().toLowerCase())) return trimmed;
  return `${trimmed}, ${state.trim()}`.slice(0, 240);
}

export function parcelFeeKobo(
  size: ParcelSize,
  originState?: string,
  destinationState?: string
): number {
  const base = PARCEL_FEE_KOBO[size];
  if (!originState || !destinationState) return base;

  const crosses =
    originState.trim().toLowerCase() !== destinationState.trim().toLowerCase();
  return crosses ? base + INTERSTATE_SURCHARGE_KOBO[size] : base;
}

/**
 * POST /orders — food or marketplace order from a cart.
 *
 * Prices come from the database, never from the client: the request sends
 * product IDs and quantities only.
 */
ordersRouter.post(
  '/',
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const body = req.body as z.infer<typeof createOrderSchema>;

    const [vendor, address] = await Promise.all([
      prisma.vendor.findUnique({ where: { id: body.vendorId } }),
      prisma.address.findFirst({ where: { id: body.addressId, userId: customerId } }),
    ]);

    if (!vendor) throw notFound('Vendor');
    if (!address) throw notFound('Address');
    if (!vendor.isOpen && !body.scheduledFor) {
      throw conflict(`${vendor.name} is closed right now. Schedule it for later instead.`);
    }

    const products = await prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) }, vendorId: vendor.id },
    });

    if (products.length !== body.items.length) {
      throw badRequest('One or more items are no longer available from this vendor.');
    }

    const priceById = new Map(products.map((p) => [p.id, p]));
    const subtotalKobo = body.items.reduce((sum, item) => {
      const product = priceById.get(item.productId)!;
      return sum + product.priceKobo * item.quantity;
    }, 0);

    const totals = computeTotals({
      subtotalKobo,
      deliveryFeeKobo: vendor.deliveryFeeKobo,
      // Zero until a server-side promotions engine exists. See the schema above.
      discountKobo: 0,
      freeOverKobo: vendor.freeOverKobo,
    });

    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        type: products.some((p) => p.isMarketplace) ? 'MARKETPLACE' : 'FOOD',
        status: 'PENDING_PAYMENT',
        customerId,
        vendorId: vendor.id,
        addressId: address.id,
        scheduledFor: body.scheduledFor,
        deliveryCode: deliveryCode(),
        ...totals,
        items: {
          create: body.items.map((item) => {
            const product = priceById.get(item.productId)!;
            return {
              productId: product.id,
              name: product.name,
              note: item.note,
              unitPriceKobo: product.priceKobo,
              quantity: item.quantity,
            };
          }),
        },
      },
      include: { items: true, vendor: true },
    });

    // A record of the order existing, so the notification list doubles as a
    // history. Awaited but never fatal — see notifyOrderPlaced.
    await notifyOrderPlaced(prisma, order);

    res.status(201).json({ data: order });
  })
);

/** POST /orders/errand — the custom-task pillar. */
ordersRouter.post(
  '/errand',
  validate(errandSchema),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const body = req.body as z.infer<typeof errandSchema>;

    const address = await prisma.address.findFirst({ where: { id: body.addressId, userId: customerId } });
    if (!address) throw notFound('Address');

    /**
     * Nothing is charged here, and the estimate is not part of the total.
     *
     * An errand's price is not knowable at the point of ordering — that is the
     * entire difference between this pillar and a food order, whose total is on
     * the menu. Charging the customer's guess up front meant collecting a
     * number nobody had checked, then reconciling against a receipt afterwards
     * and refunding the difference. Every one of those refunds was a support
     * conversation caused by a figure we invented.
     *
     * So the order costs the dispatch fee and only the dispatch fee. The item
     * is paid by the customer straight to the merchant once a rider has stood
     * in front of it and reported the real price. Sendy never holds that money,
     * which is what lets this scale without working capital.
     */
    const totals = computeTotals({
      subtotalKobo: 0,
      deliveryFeeKobo: env.DEFAULT_DELIVERY_FEE_KOBO,
    });

    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        type: 'ERRAND',
        // Unpaid and already visible to riders. The dispatch fee is collected
        // at the same moment the customer accepts the real price, so there is
        // one decision point rather than two, and nothing to refund if no rider
        // ever picks the job up.
        status: 'QUOTE_REQUESTED',
        customerId,
        addressId: address.id,
        deliveryCode: deliveryCode(),
        ...totals,
        errandDetail: {
          create: {
            task: body.task,
            details: body.details,
            pickupName: body.pickupName,
            pickupAddress: body.pickupAddress,
            budgetKobo: body.budgetKobo,
            photoUrls: body.photoUrls,
          },
        },
      },
      include: { errandDetail: true },
    });

    // A record of the order existing, so the notification list doubles as a
    // history. Awaited but never fatal — see notifyOrderPlaced.
    await notifyOrderPlaced(prisma, order);

    res.status(201).json({ data: order });
  })
);

/** POST /orders/package — point-A-to-point-B delivery. */
ordersRouter.post(
  '/package',
  validate(packageSchema),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const body = req.body as z.infer<typeof packageSchema>;

    const deliveryFeeKobo = parcelFeeKobo(body.size, body.originState, body.destinationState);

    // A parcel has no goods value — the delivery fee is the whole charge, and
    // there is no service fee to add on top of it.
    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        type: 'PACKAGE',
        status: 'PENDING_PAYMENT',
        customerId,
        addressId: body.addressId,
        scheduledFor: body.scheduledFor,
        deliveryCode: deliveryCode(),
        subtotalKobo: 0,
        deliveryFeeKobo,
        serviceFeeKobo: 0,
        discountKobo: 0,
        totalKobo: deliveryFeeKobo,
        riderPayoutKobo: riderPayout(deliveryFeeKobo),
        packageDetail: {
          create: {
            pickupName: body.pickupName,
            // The state is folded into the stored address rather than kept in
            // its own column. A rider reading a job needs one complete address,
            // and "12 Awolowo Road, Ikoyi" is ambiguous across states in a way
            // that matters once parcels leave Lagos.
            pickupAddress: withState(body.pickupAddress, body.originState),
            pickupPhone: body.pickupPhone,
            dropoffName: body.dropoffName,
            dropoffAddress: withState(body.dropoffAddress, body.destinationState),
            dropoffPhone: body.dropoffPhone,
            size: body.size,
            contents: body.contents,
            isFragile: body.isFragile,
            notes: body.notes,
          },
        },
      },
      include: { packageDetail: true },
    });

    // A record of the order existing, so the notification list doubles as a
    // history. Awaited but never fatal — see notifyOrderPlaced.
    await notifyOrderPlaced(prisma, order);

    res.status(201).json({ data: order });
  })
);

/** GET /orders?status=active|history */
ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const filter = String(req.query.status ?? 'all');

    /**
     * Only the finished states are listed; active is everything else.
     *
     * This was an explicit ACTIVE list with history as its complement, which
     * made adding a status to the enum a silent disappearance: the four errand
     * states were in neither list, so a live errand answered "no active orders"
     * on the Orders tab while its own tracking screen showed it progressing.
     *
     * Inverting it means a new status is visible by default. Wrong tab is a
     * far cheaper mistake than an order the customer cannot find at all.
     */
    const DONE = ['DELIVERED', 'CANCELLED', 'REFUNDED'] as const;

    const orders = await prisma.order.findMany({
      where: {
        customerId,
        ...(filter === 'active'
          ? { status: { notIn: [...DONE] } }
          : filter === 'history'
            ? { status: { in: [...DONE] } }
            : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { name: true, slug: true, coverUrl: true } },
        items: { select: { id: true, name: true, quantity: true } },
        packageDetail: { select: { dropoffAddress: true, size: true } },
        errandDetail: { select: { task: true, pickupName: true } },
      },
      take: 50,
    });

    res.json({ data: orders });
  })
);

/** GET /orders/:id — full detail plus the tracking stepper. */
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, customerId: req.auth!.id },
      include: {
        vendor: true,
        address: true,
        items: true,
        errandDetail: true,
        packageDetail: true,
        events: { orderBy: { createdAt: 'asc' } },
        rider: {
          select: { id: true, firstName: true, lastName: true, plateNumber: true, rating: true, phone: true },
        },
        payments: { select: { id: true, provider: true, status: true, amountKobo: true, paidAt: true } },
      },
    });

    if (!order) throw notFound('Order');

    res.json({
      data: {
        ...order,
        stepper: buildStepper(order.events, order.status, order.type),
      },
    });
  })
);

/** POST /orders/:id/cancel — allowed until a rider has picked up. */
ordersRouter.post(
  '/:id/cancel',
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, customerId: req.auth!.id },
      select: { id: true, status: true },
    });

    if (!order) throw notFound('Order');
    /**
     * Cancelling is refused per reason, because the reasons are not alike.
     *
     * MERCHANT_PAID is the one that matters most and was missing entirely. By
     * then the customer has transferred the item cost straight to the seller's
     * bank — Sendy never held it, cannot reverse it and cannot refund it.
     * Letting the order be cancelled there would close it while their money sat
     * with a stranger, and the app would look like it had handled something it
     * has no power over.
     *
     * AT_DOORSTEP was missing too, so a rider could be standing at the door
     * with the shopping while the order was cancelled underneath them.
     */
    if (order.status === 'MERCHANT_PAID') {
      throw conflict(
        'You have already paid the seller for this one, and that transfer cannot be reversed from here. Contact support.'
      );
    }
    if (['PICKED_UP', 'IN_TRANSIT', 'AT_DOORSTEP'].includes(order.status)) {
      throw conflict('Your rider is already on the way. Contact support to cancel this one.');
    }
    if (order.status === 'DELIVERED') {
      throw conflict('This order was already delivered.');
    }
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw conflict('This order is already cancelled.');
    }

    const updated = await transitionOrder(
      order.id,
      'CANCELLED',
      { type: 'customer', id: req.auth!.id },
      { note: req.body.reason, extra: { cancelReason: req.body.reason } }
    );

    res.json({ data: updated });
  })
);

/**
 * POST /orders/:id/merchant-paid — the customer has transferred to the seller.
 *
 * Sendy never sees this money. It goes from the customer's bank straight to the
 * merchant's, which is what removes the float, the licensing question and the
 * whole class of "our balance is empty so the errand is stuck".
 *
 * The cost of that is that this endpoint records a CLAIM, not a fact: there is
 * no transaction to verify against. What it does give a dispute is a timestamp,
 * the resolved account name the customer was shown, and optionally their
 * transfer receipt — which is most of what anyone arguing about this later
 * actually needs.
 *
 * The dispatch fee is a separate, ordinary payment to Sendy and is collected
 * through /payments/checkout like any other order.
 */
const merchantPaidSchema = z.object({
  proofUrl: z.string().url().optional(),
});

ordersRouter.post(
  '/:id/merchant-paid',
  validate(merchantPaidSchema),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const { proofUrl } = req.body as z.infer<typeof merchantPaidSchema>;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, customerId, type: 'ERRAND' },
      include: { errandDetail: true },
    });
    if (!order) throw notFound('Errand');
    if (order.status !== 'PRICE_PROPOSED') {
      throw conflict(
        order.status === 'QUOTE_REQUESTED'
          ? 'No rider has priced this errand yet.'
          : 'This errand is past the payment stage.'
      );
    }
    // Refusing here rather than accepting a claim about an account that was
    // never shown to anyone: without a resolved merchant there is nothing the
    // customer could have paid, and nothing a dispute could point at.
    if (!order.errandDetail?.merchantAccountNo) {
      throw badRequest('The rider has not provided the seller’s account yet.');
    }

    /**
     * The dispatch fee has to be settled first.
     *
     * This is the only enforcement point there is. Sendy never touches the item
     * money, so the fee is the entire commercial relationship — and once the
     * rider is told the seller has been paid, they collect the goods and the
     * job is effectively done. Letting that happen unpaid means doing the work
     * for free and chasing it afterwards.
     */
    const paid = await prisma.payment.findFirst({
      where: { orderId: order.id, status: 'SUCCESS' },
      select: { id: true },
    });
    if (!paid) throw conflict('Pay the Sendy Errands dispatch fee first.');

    await prisma.errandDetail.update({
      where: { orderId: order.id },
      data: { merchantPaidAt: new Date(), paymentProofUrl: proofUrl },
    });

    const updated = await transitionOrder(order.id, 'MERCHANT_PAID', {
      type: 'customer',
      id: customerId,
    });

    res.json({ data: updated });
  })
);
