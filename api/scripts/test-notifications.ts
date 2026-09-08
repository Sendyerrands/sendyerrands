import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * End-to-end check of the notification centre.
 *
 * Places a real package order as a throwaway customer, then drives it through
 * the statuses a rider would, checking that each one produces the customer copy
 * and that the badge count and read state behave.
 *
 * The database is shared with production, so everything this creates is removed
 * in the `finally`, pass or fail.
 *
 *   npm run dev
 *   npx tsx scripts/test-notifications.ts
 */
const BASE = process.env.TEST_API_URL ?? 'http://localhost:4000/api/v1';

const prisma = new PrismaClient();

const stamp = Date.now();
const EMAIL = `notif-test-${stamp}@example.invalid`;
const PASSWORD = 'correct horse battery staple';

let passed = 0;
let failed = 0;
let userId: string | null = null;
let orderId: string | null = null;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path: string, init: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const body = (await res.json().catch(() => null)) as { data?: unknown; error?: unknown } | null;
  return { status: res.status, body };
}

async function main() {
  console.log(`\n  Notifications — ${BASE}\n`);

  const reg = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer',
      email: EMAIL,
      password: PASSWORD,
      firstName: 'Notif',
      lastName: 'Test',
      phone: `+234901${String(stamp).slice(-7)}`,
    }),
  });

  const token = (reg.body?.data as { token?: string; user?: { id: string } })?.token;
  userId = (reg.body?.data as { user?: { id: string } })?.user?.id ?? null;
  if (!token) {
    check('registers a throwaway account', false, `HTTP ${reg.status}`);
    return;
  }
  check('registers a throwaway account', true);

  const auth = { Authorization: `Bearer ${token}` };

  // A brand-new account should have an empty bell, not a badge.
  const empty = await call('/me/notifications', { headers: auth });
  const emptyData = empty.body?.data as { items: unknown[]; unread: number };
  check('new account starts with no notifications', emptyData?.items.length === 0);
  check('new account starts with no unread badge', emptyData?.unread === 0);

  // ── place an order ─────────────────────────────────────────
  const placed = await call('/orders/package', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      pickupName: 'Notif Test',
      pickupAddress: '1 Test Road, Yaba',
      dropoffName: 'Someone Else',
      dropoffAddress: '2 Other Road, Ikeja',
      dropoffPhone: '08030000000',
      size: 'SMALL',
    }),
  });

  const order = placed.body?.data as { id: string; reference: string } | undefined;
  orderId = order?.id ?? null;
  check('places a package order', Boolean(order), `HTTP ${placed.status}`);
  if (!order) return;

  const afterPlace = await call('/me/notifications', { headers: auth });
  const placeData = afterPlace.body?.data as {
    items: { title: string; body: string; orderId: string | null }[];
    unread: number;
  };

  check('placing an order notifies', placeData?.items.length === 1);
  check('the notification says the order was placed', placeData?.items[0]?.title === 'Order placed');
  check('it quotes the reference', Boolean(placeData?.items[0]?.body.includes(order.reference)));
  check('it links back to the order', placeData?.items[0]?.orderId === order.id);
  check('badge shows one unread', placeData?.unread === 1);

  // ── drive it through the rider statuses ────────────────────
  // Straight through the service rather than the rider API, which would need a
  // second account and a verified rider. The notification hook is in
  // transitionOrder, so this exercises the same path either way.
  const { transitionOrder } = await import('../src/services/orders');

  // A package starts at PENDING_PAYMENT and reaches PLACED only once paid, so
  // the path has to go through it — jumping straight to RIDER_ASSIGNED is what
  // the transition guard exists to refuse.
  const path = ['PLACED', 'RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'AT_DOORSTEP'] as const;
  for (const status of path) {
    await transitionOrder(order.id, status, { type: 'system' });
  }

  const afterMoves = await call('/me/notifications', { headers: auth });
  const moveData = afterMoves.body?.data as {
    items: { title: string }[];
    unread: number;
  };

  /*
   * Five statuses, but PLACED has no customer copy — it is the moment payment
   * clears, which the payment screen already reports. So: one for placing the
   * order plus four movement updates.
   */
  check('each notifiable status produced one', moveData?.items.length === 5, `got ${moveData?.items.length}`);
  check('newest first', moveData?.items[0]?.title === 'Your rider has arrived');
  check('badge counts them all', moveData?.unread === 5, `got ${moveData?.unread}`);

  // Nothing should mention a raw enum.
  const leaked = moveData?.items.filter((n) => /_[A-Z]/.test(n.title)) ?? [];
  check('no status enum leaked into the copy', leaked.length === 0, leaked.map((l) => l.title).join(', '));

  // ── read state ─────────────────────────────────────────────
  const readOne = await call('/me/notifications/read', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ id: (moveData.items[0] as unknown as { id: string }).id }),
  });
  check('marking one read drops the badge by one', (readOne.body?.data as { unread: number })?.unread === 4);

  const readAll = await call('/me/notifications/read', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({}),
  });
  check('marking all read clears the badge', (readAll.body?.data as { unread: number })?.unread === 0);

  const readAgain = await call('/me/notifications/read', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({}),
  });
  check('marking read again is harmless', readAgain.status === 200);

  // ── isolation ──────────────────────────────────────────────
  const otherUnauth = await call('/me/notifications', {});
  check('requires authentication', otherUnauth.status === 401);
}

main()
  .catch((err) => {
    failed++;
    console.error('\n  ✗ threw:', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    if (orderId) {
      await prisma.notification.deleteMany({ where: { orderId } });
      await prisma.orderEvent.deleteMany({ where: { orderId } });
      await prisma.riderEarning.deleteMany({ where: { orderId } });
      await prisma.packageDetail.deleteMany({ where: { orderId } });
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.address.deleteMany({ where: { userId } });
      await prisma.walletTransaction.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    console.log('\n  cleaned up');
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
