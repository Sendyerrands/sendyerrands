/**
 * Empties the database of operational data, for a clean launch.
 *
 *   npx tsx scripts/wipe-data.ts --yes
 *
 * DESTRUCTIVE AND UNRECOVERABLE. Run scripts/backup-json.ts first; this script
 * refuses to run without the --yes flag precisely because nothing here can be
 * undone from inside the application.
 *
 * FOUR TABLES ARE KEPT, and they are not an oversight:
 *
 *   _prisma_migrations  Dropping it makes the next deploy try to re-apply every
 *                       migration against a schema that already has them.
 *   admins              Deleting every admin locks ops out of the dashboard
 *                       with no way back in except a script like this one.
 *   services            The bookable catalogue. Configuration, not test data —
 *                       with it gone there is nothing to book.
 *   pricing_rules       Same: what an order costs, not what anyone ordered.
 *
 * TRUNCATE without CASCADE, on purpose. CASCADE would quietly take anything
 * that references these tables, including the four above if a foreign key ever
 * pointed at them. Listing every table by hand means a missing one is a loud
 * error instead of a silent deletion.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Everything that holds operational data. Children are irrelevant — one
 *  TRUNCATE of the whole set resolves the order itself. */
const WIPE = [
  '_RequestInvites',
  'addresses',
  'bids',
  'delivery_bids',
  'errand_details',
  'favourites',
  'marketplace_requests',
  'notifications',
  'order_events',
  'order_items',
  'orders',
  'otp_codes',
  'package_details',
  'payments',
  'payouts',
  'products',
  'provider_applications',
  'provider_earnings',
  'provider_payouts',
  'reviews',
  'rider_documents',
  'rider_earnings',
  'riders',
  'service_details',
  'service_packages',
  'service_providers',
  'support_requests',
  'users',
  'vendor_applications',
  'vendors',
  'wallet_transactions',
];

const KEEP = ['_prisma_migrations', 'admins', 'services', 'pricing_rules'];

async function counts(tables: string[]) {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "${t}"`);
    out[t] = Number(r[0].n);
  }
  return out;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('\n  Refusing to run without --yes. Back up first: npx tsx scripts/backup-json.ts\n');
    process.exit(1);
  }

  const before = await counts(WIPE);
  const keepBefore = await counts(KEEP);
  const total = Object.values(before).reduce((a, b) => a + b, 0);
  console.log(`\n  ${total} rows across ${WIPE.length} tables will be deleted.\n`);

  // One statement: every table empties together or none does. A half-wiped
  // database with orders gone and payments still pointing at them is worse
  // than either outcome.
  const list = WIPE.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY`);

  const after = await counts(WIPE);
  const keepAfter = await counts(KEEP);

  for (const t of WIPE) {
    if (before[t] || after[t]) {
      console.log(`    ${t.padEnd(24)} ${String(before[t]).padStart(5)} -> ${after[t]}`);
    }
  }
  const left = Object.values(after).reduce((a, b) => a + b, 0);
  console.log(`\n  deleted ${total - left} rows; ${left} remain in wiped tables`);

  console.log('\n  kept:');
  for (const t of KEEP) {
    const ok = keepBefore[t] === keepAfter[t];
    console.log(`    ${t.padEnd(24)} ${keepAfter[t]} ${ok ? '(unchanged)' : 'CHANGED — investigate'}`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
