/**
 * Brings the service catalogue and its pricing rules across from the PHP site's
 * MySQL into Postgres.
 *
 * The PHP booking form reads this catalogue on every page load, so it is the
 * last thing tying that form to MySQL. The data below is transcribed from the
 * production dump (sendtign_sendy.sql), not from the repo's seed file — the two
 * are not guaranteed to agree, and production is the one that matters.
 *
 * Idempotent: services are upserted on slug, and a service's pricing rules are
 * replaced wholesale. Running it twice changes nothing the second time, so it
 * is safe to re-run after editing the table below.
 *
 *   npx tsx scripts/seed-service-catalogue.ts           # dry run, writes nothing
 *   npx tsx scripts/seed-service-catalogue.ts --apply   # writes
 *
 * Dry run is the default deliberately: local dev points at the same Supabase
 * instance as production, so there is no such thing as a harmless practice run.
 */
import { PrismaClient, PricingRuleType } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Naira in the dump, kobo in this schema. */
const kobo = (naira: number) => Math.round(naira * 100);

type Rule = { type: PricingRuleType; label: string; value: string };

/** Every service carries the same two rules in production. */
const STANDARD_RULES: Rule[] = [
  { type: 'PER_KM', label: 'Distance fee per km', value: '150.00' },
  { type: 'URGENCY_MULTIPLIER', label: 'Same-day rush multiplier', value: '1.30' },
];

const SERVICES = [
  { slug: 'market-shopping', name: 'Market Shopping', shortDescription: 'Need foodstuff or groceries? Sendy can shop for you.', icon: 'market', naira: 1500, sortOrder: 1 },
  { slug: 'food-pickup', name: 'Food Pickup', shortDescription: 'Order your food. We will handle the pickup.', icon: 'food', naira: 1000, sortOrder: 2 },
  { slug: 'package-pickup', name: 'Package Pickup', shortDescription: 'Can not make it to the pickup point? We will collect it for you.', icon: 'package', naira: 1200, sortOrder: 3 },
  { slug: 'delivery', name: 'Delivery', shortDescription: 'Send packages to someone without leaving home.', icon: 'delivery', naira: 1200, sortOrder: 4 },
  { slug: 'grocery-shopping', name: 'Grocery Shopping', shortDescription: 'Send us your list and we will handle the shopping.', icon: 'grocery', naira: 1500, sortOrder: 5 },
  { slug: 'personal-errands', name: 'Personal Errands', shortDescription: 'Have something else you need done? Tell us.', icon: 'errand', naira: 1500, sortOrder: 6 },
  { slug: 'custom-errand', name: 'Custom Errand', shortDescription: 'Describe an errand that does not fit the categories above.', icon: 'custom', naira: 1500, sortOrder: 7 },
];

/** Supabase pauses when idle and takes a moment to wake. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw last;
}

async function main() {
  console.log(APPLY ? 'APPLYING to the database\n' : 'DRY RUN — nothing will be written (pass --apply to write)\n');

  const before = await withRetry(() => prisma.service.count());
  console.log(`services currently in the database: ${before}\n`);

  for (const s of SERVICES) {
    const existing = await withRetry(() => prisma.service.findUnique({ where: { slug: s.slug }, select: { id: true } }));
    const verb = existing ? 'update' : 'create';
    console.log(`  ${verb.padEnd(6)} ${s.slug.padEnd(18)} ${s.name.padEnd(18)} ₦${s.naira.toLocaleString()} → ${kobo(s.naira)} kobo, ${STANDARD_RULES.length} rules`);

    if (!APPLY) continue;

    const service = await withRetry(() =>
      prisma.service.upsert({
        where: { slug: s.slug },
        create: {
          slug: s.slug,
          name: s.name,
          shortDescription: s.shortDescription,
          icon: s.icon,
          baseFeeKobo: kobo(s.naira),
          sortOrder: s.sortOrder,
          isActive: true,
        },
        update: {
          name: s.name,
          shortDescription: s.shortDescription,
          icon: s.icon,
          baseFeeKobo: kobo(s.naira),
          sortOrder: s.sortOrder,
        },
        select: { id: true },
      })
    );

    // Replaced rather than upserted one by one: the rules are a small set owned
    // entirely by this file, so "what the file says" is the whole truth.
    await withRetry(() => prisma.pricingRule.deleteMany({ where: { serviceId: service.id } }));
    await withRetry(() =>
      prisma.pricingRule.createMany({
        data: STANDARD_RULES.map((r) => ({ serviceId: service.id, type: r.type, label: r.label, value: r.value })),
      })
    );
  }

  if (APPLY) {
    console.log(`\nservices:      ${await withRetry(() => prisma.service.count())}`);
    console.log(`pricing rules: ${await withRetry(() => prisma.pricingRule.count())}`);
  } else {
    console.log(`\nwould write ${SERVICES.length} services and ${SERVICES.length * STANDARD_RULES.length} pricing rules.`);
  }
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
