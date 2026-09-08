import type { OrderStatus, Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * In-app notifications.
 *
 * There is no push yet — no APNs or FCM credentials, and adding them is a
 * native change plus a store review conversation. What people actually need
 * first is somewhere the bell leads: a durable record of what happened to their
 * order, readable when they next open the app.
 *
 * Written to the database rather than derived from order state on read, because
 * "what have we already told this person" is not recoverable from an order row.
 * When push does arrive it sends from these rows, and the read state here is
 * what stops it saying everything twice.
 */

/**
 * Customer-facing copy for the transitions worth interrupting someone for.
 *
 * Deliberately not every status. PENDING_PAYMENT is the customer's own action
 * a second ago; QUOTE_REQUESTED is them posting the errand. Notifying someone
 * about the thing they are currently doing trains them to ignore the bell,
 * which costs you the one notification that mattered.
 *
 * Nothing here mentions the enum. "AT_DOORSTEP" is not a sentence.
 */
const COPY: Partial<Record<OrderStatus, { title: string; body: (ref: string) => string }>> = {
  VENDOR_ACCEPTED: {
    title: 'Order confirmed',
    body: (ref) => `${ref} has been accepted and is being prepared.`,
  },
  RIDER_ASSIGNED: {
    title: 'Rider on the way',
    body: (ref) => `A rider has picked up ${ref} and is heading to collect it.`,
  },
  PRICE_PROPOSED: {
    title: 'Price confirmed',
    body: (ref) => `Your rider has sent the real price for ${ref}. Review and pay the seller.`,
  },
  MERCHANT_PAID: {
    title: 'Payment received',
    body: (ref) => `We have your payment for ${ref}. Your rider is collecting the item.`,
  },
  PICKED_UP: {
    title: 'Item collected',
    body: (ref) => `Your rider has ${ref} and is on the way to you.`,
  },
  IN_TRANSIT: {
    title: 'On the way',
    body: (ref) => `${ref} is out for delivery.`,
  },
  AT_DOORSTEP: {
    title: 'Your rider has arrived',
    body: (ref) => `Your rider is outside with ${ref}. Have your delivery code ready.`,
  },
  DELIVERED: {
    title: 'Delivered',
    body: (ref) => `${ref} has been delivered. Thanks for using Sendy Errands.`,
  },
  CANCELLED: {
    title: 'Order cancelled',
    body: (ref) => `${ref} was cancelled. Any payment taken is being returned.`,
  },
  REFUNDED: {
    title: 'Refund issued',
    body: (ref) => `Your refund for ${ref} is on its way back to you.`,
  },
};

export async function notify(
  tx: Tx,
  input: { userId: string; title: string; body: string; orderId?: string }
) {
  await tx.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    },
  });
}

/**
 * Called from transitionOrder, inside its transaction.
 *
 * Silent when a status has no copy — that is the filter, not an omission. A
 * failure here must never roll back the transition itself: the order genuinely
 * moved, and losing that because a notification could not be written would turn
 * a cosmetic problem into a lost delivery.
 */
export async function notifyOrderStatus(
  tx: Tx,
  order: { id: string; reference: string; customerId: string; status: OrderStatus }
) {
  const copy = COPY[order.status];
  if (!copy) return;

  try {
    await notify(tx, {
      userId: order.customerId,
      title: copy.title,
      body: copy.body(order.reference),
      orderId: order.id,
    });
  } catch (cause) {
    console.error(
      `[notifications] could not record ${order.status} for ${order.reference}:`,
      cause instanceof Error ? cause.message : cause
    );
  }
}

/**
 * The receipt for placing an order.
 *
 * Orders are created at a status rather than transitioned into one, so this
 * cannot ride along in transitionOrder like the rest.
 *
 * I would have left it out — telling someone about the thing they did two
 * seconds ago is how a notification list becomes noise. Jeremy asked for it
 * explicitly, and there is a fair case on the other side: the list doubles as
 * a history, and an order that never appears there looks like one that was
 * never received.
 */
export async function notifyOrderPlaced(
  tx: Tx,
  order: { id: string; reference: string; customerId: string }
) {
  try {
    await notify(tx, {
      userId: order.customerId,
      title: 'Order placed',
      body: `We have your order ${order.reference}. We will let you know as it moves.`,
      orderId: order.id,
    });
  } catch (cause) {
    // Never fail an order over a notification.
    console.error(
      `[notifications] could not record placement of ${order.reference}:`,
      cause instanceof Error ? cause.message : cause
    );
  }
}

/** Unread count for the bell badge. */
export function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
