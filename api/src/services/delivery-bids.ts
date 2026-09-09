import type { Prisma, PrismaClient } from '@prisma/client';

import { env } from '@/config/env';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { formatNaira, riderPayout } from '@/lib/money';
import { prisma } from '@/lib/prisma';
import { notify } from '@/services/notifications';
import { transitionOrder } from '@/services/orders';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Rider price negotiation.
 *
 * The customer names a delivery fee when they post. From there:
 *
 *   accept   — the rider is happy with it and takes the job. No row here, no
 *              customer decision, same speed as before. Most jobs end here and
 *              the design assumes it.
 *   counter  — the rider wants the job at a higher price. That creates a bid
 *              the customer can accept or ignore.
 *
 * Only errands and packages. Food and marketplace orders carry a delivery fee
 * that belongs to the vendor record and is quoted to the customer at checkout —
 * letting a rider reprice those would change a total someone has already paid.
 */

/** Order types where the fee is between the customer and the rider. */
export const BIDDABLE_TYPES = ['ERRAND', 'PACKAGE'] as const;

/** Statuses at which an order is still looking for a rider. */
const OPEN_STATUSES = ['QUOTE_REQUESTED', 'PLACED'] as const;

export function assertOfferAcceptable(offerKobo: number) {
  if (!Number.isInteger(offerKobo) || offerKobo <= 0) {
    throw badRequest('Enter what you will pay for delivery.');
  }
  if (offerKobo < env.MIN_DELIVERY_FEE_KOBO) {
    throw badRequest(
      `The lowest you can offer is ${formatNaira(env.MIN_DELIVERY_FEE_KOBO)}. Below that no rider will take it.`
    );
  }
}

/**
 * A rider asking for more than was offered.
 *
 * Upsert rather than create: a rider who reconsiders should revise their number,
 * not stack a second one the customer has to read past.
 */
export async function counterBid(input: {
  orderId: string;
  riderId: string;
  priceKobo: number;
  note?: string;
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, type: true, status: true, riderId: true, deliveryFeeKobo: true, reference: true, customerId: true },
  });

  if (!order) throw notFound('Order');

  if (!BIDDABLE_TYPES.includes(order.type as (typeof BIDDABLE_TYPES)[number])) {
    throw conflict('This kind of order has a fixed delivery fee.');
  }
  if (order.riderId) throw conflict('Another rider has already taken that job.');
  if (!OPEN_STATUSES.includes(order.status as (typeof OPEN_STATUSES)[number])) {
    throw conflict('That job is no longer looking for a rider.');
  }

  if (!Number.isInteger(input.priceKobo) || input.priceKobo <= order.deliveryFeeKobo) {
    throw badRequest(
      `Ask for more than the ${formatNaira(order.deliveryFeeKobo)} offered — if that price works, just accept the job.`
    );
  }

  const ceiling = order.deliveryFeeKobo * env.MAX_COUNTER_MULTIPLE;
  if (input.priceKobo > ceiling) {
    throw badRequest(`The most you can ask for on this job is ${formatNaira(ceiling)}.`);
  }

  const bid = await prisma.$transaction(async (tx) => {
    const saved = await tx.deliveryBid.upsert({
      where: { orderId_riderId: { orderId: order.id, riderId: input.riderId } },
      create: {
        orderId: order.id,
        riderId: input.riderId,
        priceKobo: input.priceKobo,
        note: input.note,
      },
      // A revised offer goes back to PENDING: a rider who was declined and then
      // lowered their price deserves to be looked at again.
      update: { priceKobo: input.priceKobo, note: input.note, status: 'PENDING' },
    });

    await notify(tx, {
      userId: order.customerId,
      title: 'A rider made an offer',
      body: `A rider will take ${order.reference} for ${formatNaira(input.priceKobo)}. Review it in the app.`,
      orderId: order.id,
    });

    return saved;
  });

  return bid;
}

/**
 * The customer taking one of them.
 *
 * Everything happens in one transaction, and the rider claim is a conditional
 * update on `riderId: null` for the same reason the plain accept path is: two
 * customers cannot race here, but a customer accepting a bid can race a rider
 * accepting the job outright, and the loser must be told rather than silently
 * overwritten.
 */
export async function acceptBid(input: { orderId: string; customerId: string; bidId: string }) {
  return prisma.$transaction(async (tx) => {
    const bid = await tx.deliveryBid.findUnique({
      where: { id: input.bidId },
      include: { order: true },
    });

    if (!bid || bid.orderId !== input.orderId) throw notFound('Offer');
    if (bid.order.customerId !== input.customerId) throw notFound('Order');
    if (bid.status !== 'PENDING') throw conflict('That offer is no longer available.');
    if (bid.order.riderId) throw conflict('This job already has a rider.');

    /*
     * The agreed price becomes the order's delivery fee, and the rider's payout
     * is recomputed from it. Commission is taken on what was actually agreed,
     * not on the original offer — otherwise a rider who negotiated up would be
     * paid on a number nobody is charging.
     */
    const claimed = await tx.order.updateMany({
      where: { id: bid.orderId, riderId: null },
      data: {
        riderId: bid.riderId,
        deliveryFeeKobo: bid.priceKobo,
        riderPayoutKobo: riderPayout(bid.priceKobo),
        totalKobo:
          bid.order.totalKobo - bid.order.deliveryFeeKobo + bid.priceKobo,
      },
    });

    if (claimed.count === 0) throw conflict('This job already has a rider.');

    await tx.deliveryBid.update({
      where: { id: bid.id },
      data: { status: 'ACCEPTED' },
    });

    // Everyone else is told, rather than left refreshing a job that is gone.
    await tx.deliveryBid.updateMany({
      where: { orderId: bid.orderId, id: { not: bid.id }, status: 'PENDING' },
      data: { status: 'DECLINED' },
    });

    await transitionOrder(bid.orderId, 'RIDER_ASSIGNED', { type: 'customer', id: input.customerId }, { tx });

    return tx.order.findUnique({ where: { id: bid.orderId } });
  });
}

/** The customer's list, cheapest first. */
export function listBids(orderId: string) {
  return prisma.deliveryBid.findMany({
    where: { orderId, status: { in: ['PENDING', 'ACCEPTED'] } },
    orderBy: { priceKobo: 'asc' },
    include: {
      rider: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          rating: true,
          completedJobs: true,
          vehicleType: true,
        },
      },
    },
  });
}
