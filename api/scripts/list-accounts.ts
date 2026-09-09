import 'dotenv/config';

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/**
 * What accounts actually exist, and which of them still take the demo password.
 *
 * Passwords are bcrypt hashes and cannot be read back, so "resend the details"
 * can only ever mean: here is who exists, and here is which of them a known
 * password still opens. Anything else has to be reset.
 *
 *   npx tsx scripts/list-accounts.ts
 */
const prisma = new PrismaClient();

const DEMO = 'sendy-demo-2026';

const tick = (ok: boolean) => (ok ? '✓ demo password works' : '✗ different password');

async function main() {
  const [admins, users, riders, vendors] = await Promise.all([
    prisma.admin.findMany({ select: { email: true, name: true, role: true, isActive: true, passwordHash: true } }),
    prisma.user.findMany({
      where: { NOT: { email: { startsWith: 'deleted-' } } },
      select: { email: true, firstName: true, lastName: true, phone: true, walletBalanceKobo: true, passwordHash: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.rider.findMany({
      select: { email: true, firstName: true, lastName: true, phone: true, status: true, vehicleType: true, isOnline: true, passwordHash: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.vendor.findMany({
      select: { email: true, name: true, slug: true, isOpen: true, passwordHash: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  console.log('\n══ ADMIN ══');
  for (const a of admins) {
    console.log(`  ${a.email}  —  ${a.name} (${a.role})${a.isActive ? '' : '  [INACTIVE]'}`);
    console.log(`     ${tick(await bcrypt.compare(DEMO, a.passwordHash))}`);
  }

  console.log('\n══ CUSTOMERS ══');
  for (const u of users) {
    const bal = u.walletBalanceKobo ? `  wallet ₦${(u.walletBalanceKobo / 100).toLocaleString('en-NG')}` : '';
    console.log(`  ${u.email}  —  ${u.firstName} ${u.lastName}  ${u.phone}${bal}`);
    console.log(`     ${tick(await bcrypt.compare(DEMO, u.passwordHash))}`);
  }

  console.log('\n══ RIDERS ══');
  for (const r of riders) {
    console.log(`  ${r.email}  —  ${r.firstName} ${r.lastName}  ${r.phone}`);
    console.log(`     ${r.status}${r.isOnline ? ' · online' : ''}${r.vehicleType ? ` · ${r.vehicleType}` : ''}  ·  ${tick(await bcrypt.compare(DEMO, r.passwordHash))}`);
  }

  console.log('\n══ VENDORS ══');
  for (const v of vendors) {
    const login = v.email
      ? `${v.email}  ·  ${v.passwordHash ? tick(await bcrypt.compare(DEMO, v.passwordHash)) : 'no password set'}`
      : 'no login — ops-created, claim via password reset';
    console.log(`  ${v.name} (${v.slug})${v.isOpen ? '' : '  [closed]'}`);
    console.log(`     ${login}`);
  }

  console.log(`\n  Demo password: ${DEMO}\n`);
}

main()
  .catch((e) => console.error('\n  ✗', e instanceof Error ? e.message : e, '\n'))
  .finally(() => prisma.$disconnect());
