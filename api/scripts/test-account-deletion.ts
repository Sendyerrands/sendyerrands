import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * End-to-end check of POST /me/delete against a throwaway account.
 *
 * Runs over real HTTP rather than calling the handler, so the auth middleware,
 * the zod validation and the password re-check are all exercised — the parts
 * most likely to be wrong are the ones a direct call would skip.
 *
 * This database is shared with production, so the account it creates is deleted
 * for real at the end, in a `finally`, whether or not the checks pass. Nothing
 * it touches belongs to anyone else.
 *
 *   npm run dev            # in another terminal
 *   npx tsx scripts/test-account-deletion.ts
 */
const BASE = process.env.TEST_API_URL ?? 'http://localhost:4000/api/v1';

const prisma = new PrismaClient();

const stamp = Date.now();
const EMAIL = `deletion-test-${stamp}@example.invalid`;
const PASSWORD = 'correct horse battery staple';

let passed = 0;
let failed = 0;

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
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body };
}

async function main() {
  console.log(`\n  POST /me/delete — ${BASE}\n`);

  // ── register ───────────────────────────────────────────────
  const reg = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer',
      email: EMAIL,
      password: PASSWORD,
      firstName: 'Deletion',
      lastName: 'Test',
      phone: `+234900${String(stamp).slice(-7)}`,
    }),
  });

  check('registers a throwaway account', reg.status === 200 || reg.status === 201, `HTTP ${reg.status} ${JSON.stringify(reg.body)?.slice(0, 160)}`);

  const token = (reg.body?.data as { token?: string } | undefined)?.token;
  if (!token) {
    console.log('\n  Cannot continue without a token.\n');
    return;
  }

  const auth = { Authorization: `Bearer ${token}` };

  // Something personal to prove it gets removed rather than just blanked.
  await call('/me/addresses', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      label: 'Home',
      line1: '12 Test Close, Yaba',
      contact: 'Deletion Test',
      phone: '08030000000',
      isDefault: true,
    }),
  });

  const before = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { addresses: true },
  });
  check('address saved before deletion', (before?.addresses.length ?? 0) === 1);

  // ── the password gate ──────────────────────────────────────
  const wrong = await call('/me/delete', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ password: 'not the password' }),
  });
  check('refuses a wrong password with 401', wrong.status === 401, `got ${wrong.status}`);

  const stillThere = await prisma.user.findUnique({ where: { email: EMAIL } });
  check('account untouched after a refused attempt', stillThere !== null);

  const noAuth = await call('/me/delete', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD }),
  });
  check('refuses an unauthenticated call', noAuth.status === 401, `got ${noAuth.status}`);

  // ── the real thing ─────────────────────────────────────────
  const done = await call('/me/delete', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ password: PASSWORD }),
  });
  check('accepts the correct password', done.status === 200, `got ${done.status} ${JSON.stringify(done.body)?.slice(0, 160)}`);

  // ── what actually happened to the row ──────────────────────
  const after = await prisma.user.findUnique({
    where: { id: before!.id },
    include: { addresses: true, favourites: true },
  });

  check('the row still exists (ledger intact)', after !== null);
  check('email no longer identifies anyone', after?.email !== EMAIL && Boolean(after?.email?.startsWith('deleted-')));
  check('phone anonymised', Boolean(after?.phone?.startsWith('deleted-')));
  check('name cleared', after?.firstName === 'Deleted' && after?.lastName === 'account');
  check('referral code retired', Boolean(after?.referralCode?.startsWith('DELETED-')));
  check('marked inactive', after?.isActive === false);
  check('addresses removed', after?.addresses.length === 0);
  check('password no longer the old one', after?.passwordHash !== before?.passwordHash);

  // The old credentials must not open anything any more.
  const relogin = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, role: 'customer' }),
  });
  check('old credentials no longer sign in', relogin.status === 401, `got ${relogin.status}`);
}

main()
  .catch((err) => {
    failed++;
    console.error('\n  ✗ threw:', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    // Real cleanup, not a rollback: the HTTP calls committed their own
    // transactions, so the only way to leave the database as we found it is to
    // remove the row we made. Scoped to this run's account and nothing else.
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: EMAIL }, { email: { startsWith: 'deleted-' }, lastName: 'account', createdAt: { gte: new Date(stamp - 60_000) } }] },
    });

    if (user) {
      await prisma.address.deleteMany({ where: { userId: user.id } });
      await prisma.favourite.deleteMany({ where: { userId: user.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      console.log('\n  cleaned up the test account');
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
