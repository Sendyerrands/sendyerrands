/**
 * Creates the account Google Play's reviewers sign in with.
 *
 *   npx tsx scripts/create-reviewer-account.ts
 *
 * Play's "Sign in details" declaration needs working credentials or the review
 * is rejected, and their rules rule out the obvious workarounds: they will not
 * create an account themselves, and they will not use a personal card to make a
 * purchase. So this account has to arrive complete.
 *
 * Which is why it is not just an email and a password:
 *
 *   - a saved address, because a booking cannot be placed without somewhere to
 *     deliver to, and a reviewer should not have to invent a Lagos street;
 *   - a funded wallet, so the whole paid flow can be walked without a card.
 *     This is the part Play's own rules make necessary rather than convenient.
 *
 * Idempotent: re-running resets the password and tops the wallet back up rather
 * than failing on the unique email.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const EMAIL = 'play.review@sendyerrands.com';
const PASSWORD = 'SendyReview2026';
const PHONE = '+2348000000001';
const WALLET_KOBO = 50_000_00; // ₦50,000 — enough for several bookings

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, walletBalanceKobo: WALLET_KOBO, isActive: true },
    create: {
      email: EMAIL,
      passwordHash,
      phone: PHONE,
      firstName: 'Play',
      lastName: 'Reviewer',
      walletBalanceKobo: WALLET_KOBO,
      // Unique per schema, and never shown to this account's user.
      referralCode: 'REVIEW' + randomBytes(3).toString('hex').toUpperCase(),
    },
    select: { id: true, email: true, walletBalanceKobo: true },
  });

  // Somewhere to deliver to. Without one the booking screens have nothing to
  // prefill and a reviewer is asked to invent an address they cannot know.
  const existing = await prisma.address.findFirst({ where: { userId: user.id } });
  if (!existing) {
    await prisma.address.create({
      data: {
        userId: user.id,
        label: 'Home',
        // Both required: who the rider asks for, and the number they call.
        contact: 'Play Reviewer',
        phone: PHONE,
        line1: '12 Admiralty Way, Lekki Phase 1',
        landmark: 'Opposite the filling station',
        city: 'Lagos',
        isDefault: true,
      },
    });
  }

  const addresses = await prisma.address.count({ where: { userId: user.id } });

  console.log('\n  Play Console -> App access -> Sign in details\n');
  console.log(`    Username / email : ${EMAIL}`);
  console.log(`    Password         : ${PASSWORD}`);
  console.log(`    Wallet balance   : N${(user.walletBalanceKobo / 100).toLocaleString()}`);
  console.log(`    Saved addresses  : ${addresses}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
