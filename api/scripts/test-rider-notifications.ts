import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * Riders get told when it matters.
 *
 * Two riders counter the same job; the customer accepts one. The winner must be
 * told they won, the loser must be told they lost, and the customer must see
 * neither of those. Then a cancellation mid-job must reach the assigned rider.
 *
 * Shared production database — everything created here is removed at the end.
 *
 *   npm run dev
 *   npx tsx scripts/test-rider-notifications.ts
 */
const BASE = process.env.TEST_API_URL ?? 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

const stamp = Date.now();
const CUST = `rn-cust-${stamp}@example.invalid`;
const RIDER_A = `rn-ridera-${stamp}@example.invalid`;
const RIDER_B = `rn-riderb-${stamp}@example.invalid`;
const PASSWORD = 'correct horse battery staple';

let passed = 0;
let failed = 0;
let orderId: string | null = null;

const check = (label: string, ok: boolean, detail = '') => {
  if (ok) (passed++, console.log(`  ✓ ${label}`));
  else (failed++, console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`));
};

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const body = (await res.json().catch(() => null)) as { data?: any } | null;
  return { status: res.status, body };
}

async function register(role: 'customer' | 'rider', email: string, suffix: string) {
  const r = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      role, email, password: PASSWORD, firstName: 'Notif', lastName: role === 'rider' ? `Rider${suffix}` : 'Customer',
      phone: `+23490${suffix}${String(stamp).slice(-7)}`,
    }),
  });
  const token = r.body?.data?.token as string | undefined;
  const id = (r.body?.data?.rider?.id ?? r.body?.data?.user?.id) as string | undefined;
  return { token, id };
}

async function main() {
  console.log(`\n  Rider notifications — ${BASE}\n`);

  const cust = await register('customer', CUST, '1');
  const a = await register('rider', RIDER_A, '2');
  const b = await register('rider', RIDER_B, '3');
  check('three accounts created', Boolean(cust.token && a.token && b.token));
  if (!cust.token || !a.token || !b.token || !a.id || !b.id) return;

  await prisma.rider.updateMany({
    where: { id: { in: [a.id, b.id] } },
    data: { status: 'APPROVED', isOnline: true },
  });

  const asCust = { Authorization: `Bearer ${cust.token}` };
  const asA = { Authorization: `Bearer ${a.token}` };
  const asB = { Authorization: `Bearer ${b.token}` };

  // A fresh rider has an empty bell.
  const empty = await call('/rider/notifications', { headers: asA });
  check('rider starts with nothing', empty.status === 200 && empty.body?.data?.unread === 0);

  // ── the job ────────────────────────────────────────────────
  const placed = await call('/orders/package', {
    method: 'POST', headers: asCust,
    body: JSON.stringify({
      pickupName: 'Ada Sender', pickupAddress: '1 Test Road, Yaba',
      dropoffName: 'Bola Receiver', dropoffAddress: '2 Other Road, Ikeja',
      dropoffPhone: '08030000000', size: 'SMALL', deliveryFeeKobo: 100_000,
    }),
  });
  orderId = placed.body?.data?.id ?? null;
  const ref = placed.body?.data?.reference as string;
  check('order placed', Boolean(orderId));
  if (!orderId) return;
  await prisma.order.update({ where: { id: orderId }, data: { status: 'PLACED' } });

  // ── two counters ───────────────────────────────────────────
  await call(`/rider/jobs/${orderId}/bid`, { method: 'POST', headers: asA, body: JSON.stringify({ priceKobo: 200_000 }) });
  await call(`/rider/jobs/${orderId}/bid`, { method: 'POST', headers: asB, body: JSON.stringify({ priceKobo: 180_000 }) });

  const custList = await call(`/orders/${orderId}/bids`, { headers: asCust });
  const bidA = (custList.body?.data?.bids as { id: string; riderId: string }[]).find((x) => x.riderId === a.id);
  check('customer sees both offers', custList.body?.data?.bids?.length === 2);
  if (!bidA) return;

  // Customer picks A — the dearer one, on purpose, so price is not the tiebreak.
  const accepted = await call(`/orders/${orderId}/bids/${bidA.id}/accept`, { method: 'POST', headers: asCust });
  check('customer accepts rider A', accepted.status === 200, `got ${accepted.status}`);

  // ── who was told what ──────────────────────────────────────
  const aFeed = await call('/rider/notifications', { headers: asA });
  const aItems = aFeed.body?.data?.items as { title: string; body: string; orderId: string }[];
  check('winner has one unread', aFeed.body?.data?.unread === 1, `got ${aFeed.body?.data?.unread}`);
  check('winner is told they won', aItems?.[0]?.title === 'Your offer was accepted', aItems?.[0]?.title);
  check('winner sees the agreed price', /₦2,000/.test(aItems?.[0]?.body ?? ''), aItems?.[0]?.body);
  check('winner’s notification links to the job', aItems?.[0]?.orderId === orderId);

  const bFeed = await call('/rider/notifications', { headers: asB });
  const bItems = bFeed.body?.data?.items as { title: string }[];
  check('loser has one unread', bFeed.body?.data?.unread === 1, `got ${bFeed.body?.data?.unread}`);
  check('loser is told it went elsewhere', bItems?.[0]?.title === 'Job went to another rider', bItems?.[0]?.title);

  // Rider feeds are private to the rider.
  const custRiderFeed = await call('/rider/notifications', { headers: asCust });
  check('customer cannot read a rider feed', custRiderFeed.status === 401 || custRiderFeed.status === 403);

  const custFeed = await call('/me/notifications', { headers: asCust });
  const custTitles = (custFeed.body?.data?.items as { title: string }[]).map((n) => n.title);
  check('customer did not receive the rider-only messages',
    !custTitles.includes('Your offer was accepted') && !custTitles.includes('Job went to another rider'));

  // ── read state ─────────────────────────────────────────────
  const readAll = await call('/rider/notifications/read', { method: 'POST', headers: asA, body: JSON.stringify({}) });
  check('rider can clear their badge', readAll.body?.data?.unread === 0);

  // ── cancellation reaches the assigned rider ────────────────
  const { transitionOrder } = await import('../src/services/orders');
  await transitionOrder(orderId, 'CANCELLED', { type: 'customer', id: cust.id });

  const aAfter = await call('/rider/notifications', { headers: asA });
  const aTitles = (aAfter.body?.data?.items as { title: string }[]).map((n) => n.title);
  check('assigned rider is told about the cancellation', aTitles.includes('Job cancelled'), aTitles.join(' | '));
  check('cancellation shows as unread', aAfter.body?.data?.unread === 1, `got ${aAfter.body?.data?.unread}`);

  const bAfter = await call('/rider/notifications', { headers: asB });
  const bTitles = (bAfter.body?.data?.items as { title: string }[]).map((n) => n.title);
  check('unassigned rider is not told about the cancellation', !bTitles.includes('Job cancelled'));
}

main()
  .catch((err) => {
    failed++;
    console.error('\n  ✗ threw:', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    if (orderId) {
      await prisma.notification.deleteMany({ where: { orderId } });
      await prisma.deliveryBid.deleteMany({ where: { orderId } });
      await prisma.orderEvent.deleteMany({ where: { orderId } });
      await prisma.riderEarning.deleteMany({ where: { orderId } });
      await prisma.packageDetail.deleteMany({ where: { orderId } });
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    const u = await prisma.user.findUnique({ where: { email: CUST } });
    if (u) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.address.deleteMany({ where: { userId: u.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }
    for (const email of [RIDER_A, RIDER_B]) {
      const r = await prisma.rider.findUnique({ where: { email } });
      if (r) {
        await prisma.notification.deleteMany({ where: { riderId: r.id } });
        await prisma.deliveryBid.deleteMany({ where: { riderId: r.id } });
        await prisma.rider.delete({ where: { id: r.id } }).catch(() => {});
      }
    }
    console.log('\n  cleaned up');
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
