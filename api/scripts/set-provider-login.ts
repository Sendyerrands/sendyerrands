/**
 * Gives a service provider a way to sign in.
 *
 *   npx tsx scripts/set-provider-login.ts <slug> <email> [password]
 *
 * Providers are created by ops and claim the account through password reset,
 * exactly like vendors — so a seeded provider has no email and no password and
 * cannot sign in at all. That is correct for production and useless for
 * testing, which is what this is for.
 *
 * Prints the credentials it sets. Nothing else is touched: the provider's
 * listing, fees and availability are left exactly as they were.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const slug = process.argv[2]?.trim();
const email = process.argv[3]?.trim().toLowerCase();
const password = process.argv[4]?.trim() || 'sendy-demo-2026';

if (!slug || !email) {
  console.error('\n  Usage: npx tsx scripts/set-provider-login.ts <slug> <email> [password]\n');
  process.exit(1);
}

async function main() {
  const provider = await prisma.serviceProvider.findUnique({
    where: { slug },
    select: { id: true, name: true, email: true },
  });

  if (!provider) {
    console.error(`\n  No provider with slug "${slug}".`);
    const all = await prisma.serviceProvider.findMany({ select: { slug: true, name: true } });
    console.error('  Available:\n' + all.map((p) => `    ${p.slug.padEnd(28)} ${p.name}`).join('\n') + '\n');
    process.exit(1);
  }

  // Refuse to move an email that already belongs to someone else — the column
  // is unique, and the failure would otherwise be a Prisma stack trace.
  const clash = await prisma.serviceProvider.findFirst({
    where: { email, NOT: { id: provider.id } },
    select: { slug: true },
  });
  if (clash) {
    console.error(`\n  ${email} is already on provider "${clash.slug}".\n`);
    process.exit(1);
  }

  await prisma.serviceProvider.update({
    where: { id: provider.id },
    data: { email, passwordHash: await bcrypt.hash(password, 12) },
  });

  console.log(`\n  ${provider.name}`);
  console.log(`    email    : ${email}`);
  console.log(`    password : ${password}`);
  console.log(`    role     : provider\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
