/**
 * End-to-end probe of the website's errand price loop, against production.
 *
 * Creates ONE real web booking, walks it to PRICE_PROPOSED the way a rider's
 * quote would, then exercises the two endpoints the website calls — and deletes
 * everything it made, whether or not the probe passed.
 *
 * Paystack is never touched. The rider's own quote endpoint resolves the
 * merchant account against live Paystack; this writes the resolved fields
 * directly instead, so the probe cannot spend money or hit a live rate limit.
 *
 * Run: npx tsx scripts/probe-web-price-flow.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASE = process.env.PROBE_API_BASE ?? 'https://sendyerrands.onrender.com/api/v1';
const TAG = 'PROBE-WEB-PRICE';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body } as { status: number; body: any };
}

async function main() {
  let orderId: string | null = null;
  let customerId: string | null = null;

  try {
    /* ---- 1. Book it, through the real public endpoint ------------------- */
    const booking = await api('/web/orders', {
      method: 'POST',
      body: JSON.stringify({
        name: `${TAG} Test Customer`,
        phone: '08000000111',
        service: 'Market Shopping',
        pickupAddress: `${TAG} Mile 12 Market, Lagos`,
        dropoffAddress: `${TAG} 1 Test Close, Ikeja`,
        details: 'Automated probe of the web price flow. Safe to ignore.',
        idempotencyKey: `${TAG}-${Date.now()}`,
      }),
    });
    check('booking created', booking.status === 201, `HTTP ${booking.status} ${JSON.stringify(booking.body)?.slice(0, 200)}`);
    if (booking.status !== 201) return;

    orderId = booking.body.data.trackingId ?? booking.body.data.id ?? null;
    if (!orderId) {
      // The field name is whatever bookingResponse() calls it; find it rather
      // than guess, so a rename here fails loudly instead of silently.
      console.log('  booking response:', JSON.stringify(booking.body.data));
      check('tracking id present in booking response', false);
      return;
    }

    const created = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, status: true, totalKobo: true },
    });
    customerId = created?.customerId ?? null;
    check('order is QUOTE_REQUESTED', created?.status === 'QUOTE_REQUESTED', created?.status);

    /* ---- 2. Price it, as a rider's quote would -------------------------- */
    // A dispatch fee to settle, so the ordering guard has something to guard.
    await prisma.order.update({ where: { id: orderId }, data: { totalKobo: 150000, serviceFeeKobo: 150000 } });
    await prisma.errandDetail.update({
      where: { orderId },
      data: {
        actualItemKobo: 4_800_000, // ₦48,000 of shopping
        merchantAccountNo: '0123456789',
        merchantAccountName: 'PROBE MERCHANT STORES',
        merchantBankName: 'Probe Bank',
        merchantBankCode: '000',
      },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PRICE_PROPOSED' } });

    /* ---- 3. The website reads it --------------------------------------- */
    const t1 = await api(`/web/orders/${orderId}`);
    check('tracking returns the item cost', t1.body?.data?.itemCostKobo === 4_800_000, String(t1.body?.data?.itemCostKobo));
    check('tracking returns the merchant', t1.body?.data?.merchant?.accountNumber === '0123456789');
    check('merchant name is shown', t1.body?.data?.merchant?.accountName === 'PROBE MERCHANT STORES');
    check('item cost is NOT folded into totalKobo', t1.body?.data?.totalKobo === 150000, String(t1.body?.data?.totalKobo));
    check('canAcceptPrice false while the fee is unpaid', t1.body?.data?.canAcceptPrice === false);
    check('canDecline true at PRICE_PROPOSED', t1.body?.data?.canDecline === true);

    /* ---- 4. The fee ordering is actually enforced ----------------------- */
    const early = await api(`/web/orders/${orderId}/merchant-paid`, { method: 'POST', body: '{}' });
    check('merchant-paid refused before the fee is settled', early.status === 409, `HTTP ${early.status} ${early.body?.error?.message ?? ''}`);

    /* ---- 5. Settle the dispatch fee ------------------------------------- */
    await prisma.payment.create({
      data: {
        orderId,
        provider: 'CASH',
        reference: `${TAG}-${Date.now()}`,
        amountKobo: 150000,
        status: 'SUCCESS',
        note: 'Automated probe — deleted immediately after.',
      },
    });

    const t2 = await api(`/web/orders/${orderId}`);
    check('canAcceptPrice true once the fee is settled', t2.body?.data?.canAcceptPrice === true);

    /* ---- 6. Accept ------------------------------------------------------ */
    const accept = await api(`/web/orders/${orderId}/merchant-paid`, {
      method: 'POST',
      body: JSON.stringify({ proofUrl: 'https://example.com/probe-receipt.png' }),
    });
    check('merchant-paid accepted', accept.status === 200, `HTTP ${accept.status} ${accept.body?.error?.message ?? ''}`);
    check('order moved to MERCHANT_PAID', accept.body?.data?.status === 'MERCHANT_PAID', accept.body?.data?.status);

    const t3 = await api(`/web/orders/${orderId}`);
    check('receipt url is stored and published', t3.body?.data?.paymentProofUrl === 'https://example.com/probe-receipt.png');
    check('merchantPaidAt is set', !!t3.body?.data?.merchantPaidAt);
    check('canDecline false after the seller is paid', t3.body?.data?.canDecline === false);

    /* ---- 7. Decline is refused once the money has gone ------------------ */
    const late = await api(`/web/orders/${orderId}/decline`, { method: 'POST', body: '{}' });
    check('decline refused after MERCHANT_PAID', late.status === 409, `HTTP ${late.status}`);
    check(
      'and it says why, in the customer\'s terms',
      typeof late.body?.error?.message === 'string' && late.body.error.message.includes('cannot be reversed'),
      late.body?.error?.message
    );
  } finally {
    /* ---- Clean up, always ---------------------------------------------- */
    if (orderId) {
      await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.orderEvent.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.errandDetail.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.order.delete({ where: { id: orderId } }).catch((e) => console.log('  order delete failed:', e.message));
      const gone = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
      check('probe order removed', gone === null);
    }
    if (customerId) {
      /**
       * A web booking's "customer" is a User row, not a Customer one — there is
       * no Customer model. Getting that wrong is what left a placeholder behind
       * the first time this ran.
       *
       * Deleted only when it is unmistakably this probe's own placeholder: no
       * remaining orders, the probe's name, and the synthetic email the web
       * booking mints for someone with no account. Anything else is a real
       * person and is left alone.
       */
      const c = await prisma.user.findUnique({
        where: { id: customerId },
        select: { email: true, firstName: true, orders: { select: { id: true } } },
      });
      const isProbePlaceholder =
        !!c &&
        c.orders.length === 0 &&
        (c.firstName ?? '').includes(TAG) &&
        (c.email ?? '').includes('@web.sendyerrands.invalid');

      if (isProbePlaceholder) {
        await prisma.address.deleteMany({ where: { userId: customerId } }).catch(() => {});
        await prisma.notification.deleteMany({ where: { userId: customerId } }).catch(() => {});
        await prisma.user.delete({ where: { id: customerId } }).catch((e) => console.log('  user delete failed:', e.message));
        const gone = await prisma.user.findUnique({ where: { id: customerId }, select: { id: true } });
        check('probe placeholder customer removed', gone === null);
      } else {
        console.log(`  left user ${customerId} alone — not this probe's placeholder`);
      }
    }
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
