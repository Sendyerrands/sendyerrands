import type { OrderStatus, OrderType, Prisma, PrismaClient } from '@prisma/client';

import { conflict } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { grossFromPayout } from '@/lib/money';
import { notifyOrderStatus } from '@/services/notifications';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * The only legal status transitions. Anything else is rejected — this is what
 * stops a rider marking "delivered" on an order that was never picked up, and
 * what keeps the customer's tracking stepper honest.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  /**
   * The errand lane. It runs alongside the paid-up-front lane rather than
   * replacing it, because only errands have a price nobody knows at the point
   * of ordering — a food order's total is on the menu.
   *
   * QUOTE_REQUESTED can go straight to CANCELLED, which is the common exit:
   * most abandoned errands are ones no rider picked up.
   */
  QUOTE_REQUESTED: ['RIDER_ASSIGNED', 'CANCELLED'],
  PRICE_PROPOSED: ['MERCHANT_PAID', 'PRICE_PROPOSED', 'CANCELLED'],
  MERCHANT_PAID: ['PICKED_UP', 'CANCELLED'],

  PENDING_PAYMENT: ['PLACED', 'CANCELLED'],
  PLACED: ['VENDOR_ACCEPTED', 'RIDER_ASSIGNED', 'CANCELLED'],
  VENDOR_ACCEPTED: ['RIDER_ASSIGNED', 'CANCELLED'],
  // An errand's rider prices the job before collecting anything, so
  // RIDER_ASSIGNED leads to PRICE_PROPOSED there and PICKED_UP everywhere else.
  RIDER_ASSIGNED: ['PRICE_PROPOSED', 'PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'AT_DOORSTEP', 'DELIVERED', 'CANCELLED'],
  IN_TRANSIT: ['AT_DOORSTEP', 'DELIVERED', 'CANCELLED'],
  AT_DOORSTEP: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

const LABELS: Record<OrderStatus, string> = {
  QUOTE_REQUESTED: 'Waiting for a rider',
  PRICE_PROPOSED: 'Price confirmed — your approval needed',
  MERCHANT_PAID: 'Paid the seller — rider collecting',
  AT_DOORSTEP: 'Rider is at your door',
  PENDING_PAYMENT: 'Awaiting payment',
  PLACED: 'Order placed',
  VENDOR_ACCEPTED: 'Vendor accepted',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up from vendor',
  IN_TRANSIT: 'On the way to you',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusLabel(status: OrderStatus): string {
  return LABELS[status];
}

/** Timestamp columns that mirror the status, for cheap reporting queries. */
function timestampFor(status: OrderStatus): Partial<Prisma.OrderUpdateInput> {
  const now = new Date();
  switch (status) {
    case 'PLACED':
      return { placedAt: now };
    case 'VENDOR_ACCEPTED':
      return { acceptedAt: now };
    case 'RIDER_ASSIGNED':
      return { assignedAt: now };
    case 'PICKED_UP':
      return { pickedUpAt: now };
    case 'DELIVERED':
      return { deliveredAt: now };
    default:
      return {};
  }
}

/**
 * Moves an order to a new status, writing the audit event in the same
 * transaction. On DELIVERED it also books the rider's earning.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: { type: 'customer' | 'rider' | 'vendor' | 'admin' | 'system'; id?: string },
  opts?: { note?: string; extra?: Prisma.OrderUpdateInput; tx?: Tx }
) {
  const run = async (tx: Tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw conflict('That order no longer exists.');

    if (order.status === to) return order; // idempotent — safe to retry

    if (!canTransition(order.status, to)) {
      throw conflict(`An order that is "${LABELS[order.status]}" cannot become "${LABELS[to]}".`);
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: to, ...timestampFor(to), ...opts?.extra },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        status: to,
        label: LABELS[to],
        note: opts?.note,
        actorType: actor.type,
        actorId: actor.id,
      },
    });

    /*
     * The customer-facing half of the same event. OrderEvent is the audit
     * trail; this is what the person waiting at home is told, in their words
     * and only for the transitions worth interrupting them for.
     *
     * Here rather than at each call site because every status change in the
     * app comes through this function — hooking the callers instead would mean
     * the one path someone forgets is the one that goes quiet.
     */
    await notifyOrderStatus(tx, updated);

    // Book the rider's cut exactly once, when the job actually completes.
    // Derive gross from the PAYOUT, not from deliveryFeeKobo: under a
    // free-delivery promo the customer is charged 0 while the rider is still
    // owed the full amount, and Sendy Errands eats the difference.
    if (to === 'DELIVERED' && updated.riderId) {
      const { grossKobo, commissionKobo } = grossFromPayout(updated.riderPayoutKobo);
      await tx.riderEarning.upsert({
        where: { orderId },
        create: {
          orderId,
          riderId: updated.riderId,
          grossKobo,
          commissionKobo,
          netKobo: updated.riderPayoutKobo,
        },
        update: {},
      });
      await tx.rider.update({
        where: { id: updated.riderId },
        data: { completedJobs: { increment: 1 } },
      });
    }

    return updated;
  };

  return opts?.tx ? run(opts.tx) : prisma.$transaction(run);
}

/**
 * Shape the mobile app's tracking stepper renders from.
 *
 * Two things this has to get right:
 *  - Packages and errands have no vendor, so "Vendor accepted" is dropped
 *    entirely rather than shown as a step that will never complete.
 *  - A step BEFORE the current one counts as done even with no event row.
 *    Orders legitimately skip states (a vendor auto-accepts, an admin assigns
 *    a rider directly), and a stray "pending" node between two ticks reads as
 *    a stalled order to the customer.
 */
export function buildStepper(
  events: { status: OrderStatus; label: string; createdAt: Date }[],
  current: OrderStatus,
  type?: OrderType
) {
  const hasVendor = type !== 'PACKAGE' && type !== 'ERRAND';
  const isErrand = type === 'ERRAND';

  /**
   * An errand never passes through PLACED — it is posted unpaid at
   * QUOTE_REQUESTED and priced by a rider before any money moves. Running it
   * through the shared flow put currentIndex at -1, so every step rendered
   * pending on an order that was visibly progressing.
   */
  const flow: OrderStatus[] = isErrand
    ? [
        'QUOTE_REQUESTED',
        'RIDER_ASSIGNED',
        'PRICE_PROPOSED',
        'MERCHANT_PAID',
        'PICKED_UP',
        'AT_DOORSTEP',
        'DELIVERED',
      ]
    : [
        'PLACED',
        ...(hasVendor ? (['VENDOR_ACCEPTED'] as OrderStatus[]) : []),
        'RIDER_ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'AT_DOORSTEP',
        'DELIVERED',
      ];

  /**
   * Step copy, which is not the same as status copy: a stepper reads as a list
   * of things that have happened, so "Price confirmed" rather than the status
   * line's "Price confirmed — your approval needed".
   */
  const ERRAND_STEPS: Partial<Record<OrderStatus, string>> = {
    QUOTE_REQUESTED: 'Errand posted',
    RIDER_ASSIGNED: 'Rider assigned',
    PRICE_PROPOSED: 'Price confirmed',
    MERCHANT_PAID: 'Seller paid',
    PICKED_UP: 'Items collected',
    AT_DOORSTEP: 'At your door',
    DELIVERED: 'Delivered',
  };

  // Pickup copy depends on where the rider actually collects from.
  const label = (status: OrderStatus) => {
    if (isErrand) return ERRAND_STEPS[status] ?? LABELS[status];
    return status === 'PICKED_UP' && !hasVendor ? 'Picked up from sender' : LABELS[status];
  };

  const seen = new Map(events.map((e) => [e.status, e.createdAt]));

  // Terminal states aren't on the happy path — show every step as done//final.
  if (current === 'CANCELLED' || current === 'REFUNDED') {
    return [
      ...flow
        .filter((s) => seen.has(s))
        .map((status) => ({ status, label: label(status), at: seen.get(status) ?? null, state: 'done' as const })),
      { status: current, label: LABELS[current], at: seen.get(current) ?? null, state: 'current' as const },
    ];
  }

  const currentIndex = flow.indexOf(current);

  return flow.map((status, i) => ({
    status,
    label: label(status),
    at: seen.get(status) ?? null,
    state: i < currentIndex ? ('done' as const) : i === currentIndex ? ('current' as const) : ('pending' as const),
  }));
}
