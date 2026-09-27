import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { badRequest, conflict, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { paymentReference } from '@/lib/reference';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { transitionOrder } from '@/services/orders';
import { initializeTransaction, verifyTransaction, verifyWebhookSignature } from '@/services/paystack';
import { settleTransfer } from '@/services/payouts';

export const paymentsRouter = Router();

/**
 * Top-up bounds, in kobo.
 *
 * Deliberately small. Through testing, ₦10 stands in for ₦10,000: the flow
 * exercised is identical and the amount at risk is not.
 *
 * The maximum is a safety rail rather than a product limit. It is the
 * difference between a fat-fingered demo and a real ₦100,000 charge on the day
 * the live keys go in. Raise it when the wallet is something customers use.
 */
const TOPUP_MIN_KOBO = 1_000; // ₦10
const TOPUP_MAX_KOBO = 100_000; // ₦1,000

/**
 * POST /payments/checkout
 *
 * WALLET  → debits immediately and places the order.
 * PAYSTACK→ returns an authorization_url for the app to open. The order is only
 *           placed once the payment is confirmed by /verify or the webhook.
 */
paymentsRouter.post(
  '/checkout',
  requireAuth('customer'),
  validate(
    z.object({
      orderId: z.string().min(1),
      method: z.enum(['WALLET', 'PAYSTACK']),
      // The app's own deep link, so Paystack returns the customer to the order
      // instead of stranding them on the dashboard's callback page.
      callbackUrl: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const { orderId, method, callbackUrl } = req.body as {
      orderId: string;
      method: 'WALLET' | 'PAYSTACK';
      callbackUrl?: string;
    };

    const order = await prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw notFound('Order');
    /**
     * Errands pay at a different moment, so they gate on a different status.
     *
     * Every other pillar knows its total when the order is created and sits at
     * PENDING_PAYMENT until it is settled. An errand does not have a total
     * until a rider has stood in front of the item, so it reaches
     * PRICE_PROPOSED unpaid and the dispatch fee is collected when the customer
     * accepts the real price. The item itself never passes through here — it
     * goes from the customer's bank to the merchant's.
     */
    const payable =
      order.status === 'PENDING_PAYMENT' ||
      (order.type === 'ERRAND' && order.status === 'PRICE_PROPOSED');

    if (!payable) throw conflict('This order has already been paid for.');

    if (method === 'WALLET') {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: customerId } });
        if (!user) throw notFound('Account');
        if (user.walletBalanceKobo < order.totalKobo) {
          throw badRequest('Your wallet balance is too low. Top up or pay by card.');
        }

        const balanceKobo = user.walletBalanceKobo - order.totalKobo;

        await tx.user.update({ where: { id: customerId }, data: { walletBalanceKobo: balanceKobo } });

        await tx.walletTransaction.create({
          data: {
            userId: customerId,
            type: 'ORDER_DEBIT',
            amountKobo: -order.totalKobo,
            balanceKobo,
            description: `Order ${order.reference}`,
            reference: order.reference,
          },
        });

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'WALLET',
            reference: paymentReference('WLT'),
            amountKobo: order.totalKobo,
            status: 'SUCCESS',
            paidAt: new Date(),
          },
        });

        // An errand keeps its place in its own lane: paying the dispatch fee
        // does not mean the seller has been paid, which is what MERCHANT_PAID
        // records. Moving it to PLACED here would skip that entirely.
        if (order.type !== 'ERRAND') {
          await transitionOrder(order.id, 'PLACED', { type: 'customer', id: customerId }, { tx });
        }

        return { payment, balanceKobo };
      });

      return res.json({
        data: {
          method: 'WALLET',
          status: 'SUCCESS',
          walletBalanceKobo: result.balanceKobo,
          payment: result.payment,
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { id: customerId }, select: { email: true, phone: true } });
    const reference = paymentReference('PSK');

    const init = await initializeTransaction({
      // Paystack requires an email; fall back to a routable placeholder.
      email: user?.email ?? `${user?.phone?.replace('+', '')}@sendy.app`,
      amountKobo: order.totalKobo,
      reference,
      metadata: {
        orderId: order.id,
        orderReference: order.reference,
        customerId,
        /**
         * Which front end this came from. Not called `channel`: Paystack uses
         * that word for card/bank/USSD on every transaction it returns, and two
         * fields of the same name meaning different things is a reconciliation
         * bug waiting to be written. custom_fields is what Paystack renders as
         * labelled rows on the transaction page.
         */
        source: order.channel,
        custom_fields: [
          { display_name: 'Order', variable_name: 'order_reference', value: order.reference },
          {
            display_name: 'Booked from',
            variable_name: 'source',
            value: order.channel === 'WEB' ? 'Website' : 'Mobile app',
          },
        ],
      },
      callbackUrl,
    });

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'PAYSTACK',
        reference,
        amountKobo: order.totalKobo,
        status: 'PENDING',
        authorizationUrl: init.authorization_url,
      },
    });

    res.json({
      data: {
        method: 'PAYSTACK',
        status: 'PENDING',
        authorizationUrl: init.authorization_url,
        reference: payment.reference,
      },
    });
  })
);

/**
 * POST /payments/verify — called when the app returns from the Paystack sheet.
 * Confirms with Paystack directly rather than trusting the client.
 */
paymentsRouter.post(
  '/verify',
  requireAuth('customer'),
  validate(z.object({ reference: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { reference } = req.body as { reference: string };

    const payment = await prisma.payment.findUnique({
      where: { reference },
      include: { order: true },
    });
    if (!payment) throw notFound('Payment');
    if (payment.order.customerId !== req.auth!.id) throw notFound('Payment');

    if (payment.status === 'SUCCESS') {
      return res.json({ data: { status: 'SUCCESS', orderId: payment.orderId } });
    }

    const result = await verifyTransaction(reference);
    await settlePayment(reference, result.status === 'success', result);

    res.json({
      data: {
        status: result.status === 'success' ? 'SUCCESS' : 'FAILED',
        orderId: payment.orderId,
      },
    });
  })
);

/** POST /payments/wallet/topup — funds the wallet via Paystack. */
paymentsRouter.post(
  '/wallet/topup',
  requireAuth('customer'),
  validate(
    z.object({
      amountKobo: z
        .number()
        .int()
        .min(TOPUP_MIN_KOBO, 'The smallest top-up is ₦10.')
        .max(TOPUP_MAX_KOBO, 'The largest top-up is ₦1,000 while the wallet is in testing.'),
      // The app's own deep link, so Paystack closes the sheet on its way back.
      callbackUrl: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const { amountKobo, callbackUrl } = req.body as { amountKobo: number; callbackUrl?: string };

    const user = await prisma.user.findUnique({
      where: { id: customerId },
      select: { email: true, phone: true },
    });

    const reference = paymentReference('TOP');
    const init = await initializeTransaction({
      email: user?.email ?? `${user?.phone?.replace('+', '')}@sendy.app`,
      amountKobo,
      reference,
      // Read back on verify to prove this reference is a top-up, and whose.
      metadata: { kind: 'wallet_topup', customerId },
      callbackUrl,
    });

    res.json({ data: { authorizationUrl: init.authorization_url, reference } });
  })
);

/**
 * POST /payments/wallet/verify — settles a top-up from the app's side.
 *
 * The webhook cannot be the only way a top-up credits. Paystack calls it from
 * the public internet, so it never reaches a laptop on localhost, and it is
 * delayed whenever the API is asleep. Relying on it alone means a customer pays
 * and watches an unchanged balance.
 *
 * So the app calls this when the payment sheet closes, however it closed. The
 * amount credited comes from Paystack's own record of the transaction, never
 * from the client, and `creditWallet` is idempotent on the reference — whether
 * this runs before, after, or at the same time as the webhook, the money lands
 * exactly once.
 */
paymentsRouter.post(
  '/wallet/verify',
  requireAuth('customer'),
  validate(z.object({ reference: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.id;
    const { reference } = req.body as { reference: string };

    const balanceOf = async () =>
      (
        await prisma.user.findUnique({
          where: { id: customerId },
          select: { walletBalanceKobo: true },
        })
      )?.walletBalanceKobo ?? 0;

    // Already credited, by the webhook or an earlier call. Answer without
    // troubling Paystack — this endpoint gets hit on every sheet dismissal.
    const settled = await prisma.walletTransaction.findFirst({
      where: { reference, userId: customerId },
    });
    if (settled) {
      return res.json({
        data: { status: 'SUCCESS', creditedKobo: settled.amountKobo, balanceKobo: await balanceOf() },
      });
    }

    const result = await verifyTransaction(reference);

    /**
     * The reference must be a top-up that this customer started.
     *
     * Without this, anyone could quote a reference they saw elsewhere and, in
     * the window before the webhook lands, have someone else's payment credited
     * to their own wallet. `notFound` rather than `forbidden` so the endpoint
     * cannot be used to test whether a reference exists.
     */
    if (result.metadata?.kind !== 'wallet_topup' || result.metadata?.customerId !== customerId) {
      throw notFound('Payment');
    }

    if (result.status !== 'success') {
      return res.json({
        data: {
          status: result.status === 'abandoned' ? 'ABANDONED' : 'FAILED',
          creditedKobo: 0,
          balanceKobo: await balanceOf(),
        },
      });
    }

    await creditWallet(reference, { amount: result.amount, metadata: result.metadata });

    res.json({
      data: { status: 'SUCCESS', creditedKobo: result.amount, balanceKobo: await balanceOf() },
    });
  })
);

/**
 * POST /payments/webhook — Paystack's server-to-server callback.
 *
 * Mounted with a RAW body parser in app.ts: the HMAC is computed over the exact
 * bytes Paystack sent, so any re-serialisation breaks the signature.
 * Always 200 on a valid signature — a non-2xx makes Paystack retry for days.
 */
export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-paystack-signature'];
  const raw = req.body as Buffer;

  if (!verifyWebhookSignature(raw, typeof signature === 'string' ? signature : undefined)) {
    return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature.' } });
  }

  const event = JSON.parse(raw.toString('utf8')) as {
    event: string;
    data: { reference: string; status: string; amount: number; metadata?: Record<string, unknown> };
  };

  if (event.event === 'charge.success') {
    const kind = event.data.metadata?.kind;
    if (kind === 'wallet_topup') {
      await creditWallet(event.data.reference, event.data);
    } else {
      await settlePayment(event.data.reference, true, event.data);
    }
  }

  /**
   * Rider payouts settling.
   *
   * `transfer.reversed` can arrive days later, when a bank bounces a transfer
   * that first looked fine. `settleTransfer` puts the earnings back on failure
   * and reversal alike, so a bounce turns back into payable work instead of
   * money the rider is owed and the system thinks it already sent.
   */
  if (event.event.startsWith('transfer.')) {
    await settleTransfer(event.data.reference, event.data.status, event.data);
  }

  res.json({ received: true });
});

// ── helpers ─────────────────────────────────────────────────────────

/** Marks a payment settled and places the order. Idempotent. */
async function settlePayment(reference: string, success: boolean, payload: unknown) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { reference }, include: { order: true } });
    if (!payment) return;
    if (payment.status === 'SUCCESS') return; // already handled — webhook retry

    await tx.payment.update({
      where: { reference },
      data: {
        status: success ? 'SUCCESS' : 'FAILED',
        paidAt: success ? new Date() : null,
        providerPayload: payload as never,
      },
    });

    /**
     * Put it on the order's own timeline either way.
     *
     * Only PENDING_PAYMENT moves on payment — a web errand sits at
     * QUOTE_REQUESTED and is priced before anyone pays, so it must not be shoved
     * down the app's paid-up-front lane. Without this event, money for such an
     * order would appear in the ledger and nowhere on the order a customer is
     * calling about.
     */
    if (success) {
      await tx.orderEvent.create({
        data: {
          orderId: payment.orderId,
          status: payment.order.status,
          label: 'Payment received',
          note: `₦${(payment.amountKobo / 100).toLocaleString('en-NG')} by card`,
          actorType: 'system',
        },
      });
    }

    if (success && payment.order.status === 'PENDING_PAYMENT') {
      await transitionOrder(payment.orderId, 'PLACED', { type: 'system' }, { tx });
    }
  });
}

/** Credits a wallet top-up. Idempotent on the payment reference. */
async function creditWallet(reference: string, payload: { amount: number; metadata?: Record<string, unknown> }) {
  const customerId = payload.metadata?.customerId;
  if (typeof customerId !== 'string') return;

  await prisma.$transaction(async (tx) => {
    const already = await tx.walletTransaction.findFirst({ where: { reference } });
    if (already) return;

    const user = await tx.user.findUnique({ where: { id: customerId } });
    if (!user) return;

    const balanceKobo = user.walletBalanceKobo + payload.amount;

    await tx.user.update({ where: { id: customerId }, data: { walletBalanceKobo: balanceKobo } });
    await tx.walletTransaction.create({
      data: {
        userId: customerId,
        type: 'TOPUP',
        amountKobo: payload.amount,
        balanceKobo,
        description: 'Wallet top-up',
        reference,
      },
    });
  });
}
