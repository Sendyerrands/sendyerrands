import 'dotenv/config';

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/**
 * Read-only diagnostic for admin sign-in.
 *
 * Answers the three questions in order, because they fail differently and the
 * login endpoint deliberately reports all of them as the same message:
 * does the account exist, is it active, and does the password verify.
 *
 *   npx tsx scripts/check-admin.ts <email> [password]
 */
const prisma = new PrismaClient();

const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3];

async function main() {
  const admins = await prisma.admin.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      passwordHash: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n  admins table: ${admins.length} row(s)\n`);

  for (const a of admins) {
    const prefix = a.passwordHash.slice(0, 7);
    console.log(
      `  ${a.isActive ? '●' : '○'} ${a.email}  ${a.name}  ${a.role}` +
        `${a.isActive ? '' : '  [INACTIVE]'}`
    );
    console.log(`     hash ${prefix}…  len ${a.passwordHash.length}  created ${a.createdAt.toISOString()}`);
  }

  if (!email) {
    console.log('\n  Pass an email to test a specific account.\n');
    return;
  }

  const admin = admins.find((a) => a.email === email);
  console.log(`\n  ── ${email} ──`);

  if (!admin) {
    console.log('  ✗ no admin row with that email');
    console.log('    (login returns "Those credentials are not correct" for this)\n');
    return;
  }
  if (!admin.isActive) {
    console.log('  ✗ row exists but isActive = false — login refuses it\n');
    return;
  }
  if (!password) {
    console.log('  ● row exists and is active. Pass a password to verify it.\n');
    return;
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  console.log(ok ? '  ✓ password verifies' : '  ✗ password does NOT match the stored hash');
  console.log();
}

main()
  .catch((err) => {
    console.error('\n  ✗', err instanceof Error ? err.message : err, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
