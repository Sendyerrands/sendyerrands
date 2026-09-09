import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * End-to-end check of rider price negotiation.
 *
 * Covers the money, because that is what this feature changes: the agreed price
 * has to land on the order, the rider's payout has to be recomputed from it,
 * and the customer's total has to move by the same amount. A bug here
 * overpays or underpays a real person.
 *
 * Creates a throwaway customer, rider and order, and removes all three in the
 * `finally` — the database is shared with production.
 *
 *   npm run dev
 *   npx tsx scripts/test-delivery-bids.ts
 */
const BASE = process.env.TEST_API_URL ?? 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

const stamp = Date.now();
const CUSTOMER = `bid-cust-${stamp}@example.invalid`;
const RIDER = `bid-rider-${stamp}@example.invalid`;
const PASSWORD = 'correct horse battery staple';

const OFFER = 100_000; // ₦1,000 — what the customer offers
const COUNTER = 250_000; // ₦2,500 — what the rider wants

let passed = 0;
let failed = 0;
let customerId: string | null = null;
let riderId: string | null = null;
let orderId: string | null = null;

function check(label: string, ok: boolean, detail = '') {
  if (ok) (passed++, console.log(`  ✓ ${label}`));
  else (failed++, console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`));
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const body = (await res.json().catch(() => null)) as { data?: any; error?: any } | null;
  return { status: res.status, body };
}

async function main() {
  console.log(`\n  Rider price negotiation — ${BASE}\n`);

  // ── two accounts ───────────────────────────────────────────
  const cust = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer', email: CUSTOMER, password: PASSWORD,
      firstName: 'Bid', lastName: 'Customer', phone: `+234902${String(stamp).slice(-7)}`,
    }),
  });
  const custToken = cust.body?.data?.token;
  customerId = cust.body?.data?.user?.id ?? null;

  const rider = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      role: 'rider', email: RIDER, password: PASSWORD,
      firstName: 'Bid', lastName: 'Rider', phone: `+234903${String(stamp).slice(-7)}`,
    }),
  });
  const riderToken = rider.body?.data?.token;
  riderId = rider.body?.data?.rider?.id ?? rider.body?.data?.user?.id ?? null;

  check('creates a customer and a rider', Boolean(custToken && riderToken));
  if (!custToken || !riderToken) return;

  // Riders must be approved to see or take jobs.
  if (riderId) {
    await prisma.rider.update({ where: { id: riderId }, data: { status: 'APPROVED', isOnline: true } });
  }

  const asCustomer = { Authorization: `Bearer ${custToken}` };
  const asRider = { Authorization: `Bearer ${riderToken}` };

  // ── the floor ──────────────────────────────────────────────
  const tooLow = await call('/orders/package', {
    method: 'POST', headers: asCustomer,
    body: JSON.stringify({
      pickupName: 'Ada Sender', pickupAddress: '1 Test Road, Yaba',
      dropoffName: 'Bola Receiver', dropoffAddress: '2 Other Road, Ikeja',
      dropoffPhone: '08030000000', size: 'SMALL', deliveryFeeKobo: 100,
    }),
  });
  /*
   * Asserts the reason, not just the status.
   *
   * This check passed on its first run against a payload whose *names* were
   * too short — a 400 for an entirely different reason, reported as the floor
   * working. A test that cannot tell why it passed is not testing anything.
   */
  check(
    'refuses an offer below the floor, for that reason',
    tooLow.status === 400 && /lowest you can offer/i.test(JSON.stringify(tooLow.body)),
    `got ${tooLow.status} ${JSON.stringify(tooLow.body).slice(0, 140)}`
  );

  // ── post at the customer's price ───────────────────────────
  const placed = await call('/orders/package', {
    method: 'POST', headers: asCustomer,
    body: JSON.stringify({
      pickupName: 'Ada Sender', pickupAddress: '1 Test Road, Yaba',
      dropoffName: 'Bola Receiver', dropoffAddress: '2 Other Road, Ikeja',
      dropoffPhone: '08030000000', size: 'SMALL', deliveryFeeKobo: OFFER,
    }),
  });
  orderId = placed.body?.data?.id ?? null;
  check('accepts the customer’s own price', placed.status === 201, `got ${placed.status}`);
  check('stores it as the delivery fee', placed.body?.data?.deliveryFeeKobo === OFFER);
  if (!orderId) return;

  // Onto the board (a package is only visible once paid).
  await prisma.order.update({ where: { id: orderId }, data: { status: 'PLACED' } });

  // ── the rider counters ─────────────────────────────────────
  const below = await call(`/rider/jobs/${orderId}/bid`, {
    method: 'POST', headers: asRider,
    body: JSON.stringify({ priceKobo: OFFER - 1 }),
  });
  check('refuses a counter below the offer', below.status === 400, `got ${below.status}`);

  const silly = await call(`/rider/jobs/${orderId}/bid`, {
    method: 'POST', headers: asRider,
    body: JSON.stringify({ priceKobo: OFFER * 10 }),
  });
  check('refuses a counter above the ceiling', silly.status === 400, `got ${silly.status}`);

  const bid = await call(`/rider/jobs/${orderId}/bid`, {
    method: 'POST', headers: asRider,
    body: JSON.stringify({ priceKobo: COUNTER, note: 'It is across the bridge.' }),
  });
  check('accepts a genuine counter', bid.status === 201, `got ${bid.status}`);

  const again = await call(`/rider/jobs/${orderId}/bid`, {
    method: 'POST', headers: asRider,
    body: JSON.stringify({ priceKobo: COUNTER - 20_000 }),
  });
  check('revising replaces rather than stacks', again.status === 201);
  const bidCount = await prisma.deliveryBid.count({ where: { orderId } });
  check('one bid row per rider', bidCount === 1, `got ${bidCount}`);

  // ── the customer sees it ───────────────────────────────────
  const list = await call(`/orders/${orderId}/bids`, { headers: asCustomer });
  check('customer can read the offers', list.status === 200);
  check('the offer price is shown', list.body?.data?.offeredKobo === OFFER);
  check('the rider is identified, not just a price', Boolean(list.body?.data?.bids?.[0]?.rider?.firstName));

  const bidId = list.body?.data?.bids?.[0]?.id;
  if (!bidId) return;

  // Nobody else's order.
  const stranger = await call(`/orders/${orderId}/bids`, { headers: asRider });
  check('a rider cannot read the customer’s bid list', stranger.status === 401 || stranger.status === 403 || stranger.status === 404);

  // ── accepting it moves the money ───────────────────────────
  const before = await prisma.order.findUnique({ where: { id: orderId } });
  const accepted = await call(`/orders/${orderId}/bids/${bidId}/accept`, {
    method: 'POST', headers: asCustomer,
  });
  check('customer can accept an offer', accepted.status === 200, `got ${accepted.status}`);

  const after = await prisma.order.findUnique({ where: { id: orderId } });
  const agreed = COUNTER - 20_000;

  check('agreed price becomes the delivery fee', after?.deliveryFeeKobo === agreed, `got ${after?.deliveryFeeKobo}`);
  check('rider is assigned', after?.riderId === riderId);
  check('status moved to RIDER_ASSIGNED', after?.status === 'RIDER_ASSIGNED', after?.status);

  // 15% commission on the agreed number, not the original offer.
  const expectedPayout = agreed - Math.round((agreed * 1500) / 10_000);
  check('payout recomputed from the agreed price', after?.riderPayoutKobo === expectedPayout,
    `got ${after?.riderPayoutKobo}, expected ${expectedPayout}`);

  const expectedTotal = (before?.totalKobo ?? 0) - OFFER + agreed;
  check('customer total moved by the difference', after?.totalKobo === expectedTotal,
    `got ${after?.totalKobo}, expected ${expectedTotal}`);

  const reaccept = await call(`/orders/${orderId}/bids/${bidId}/accept`, {
    method: 'POST', headers: asCustomer,
  });
  check('cannot accept twice', reaccept.status === 409, `got ${reaccept.status}`);

  const late = await call(`/rider/jobs/${orderId}/bid`, {
    method: 'POST', headers: asRider,
    body: JSON.stringify({ priceKobo: OFFER + 5000 }),
  });
  check('cannot bid on an assigned job', late.status === 409, `got ${late.status}`);
}

main()
  .catch((err) => {
    failed++;
    console.error('\n  ✗ threw:', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    if (orderId) {
      await prisma.deliveryBid.deleteMany({ where: { orderId } });
      await prisma.notification.deleteMany({ where: { orderId } });
      await prisma.orderEvent.deleteMany({ where: { orderId } });
      await prisma.riderEarning.deleteMany({ where: { orderId } });
      await prisma.packageDetail.deleteMany({ where: { orderId } });
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    for (const email of [CUSTOMER]) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.notification.deleteMany({ where: { userId: u.id } });
        await prisma.address.deleteMany({ where: { userId: u.id } });
        await prisma.walletTransaction.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
      }
    }
    const r = await prisma.rider.findUnique({ where: { email: RIDER } });
    if (r) {
      await prisma.deliveryBid.deleteMany({ where: { riderId: r.id } });
      await prisma.riderEarning.deleteMany({ where: { riderId: r.id } });
      await prisma.rider.delete({ where: { id: r.id } }).catch(() => {});
    }

    console.log('\n  cleaned up');
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
