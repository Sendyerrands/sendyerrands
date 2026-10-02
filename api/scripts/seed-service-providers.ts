/**
 * Mock service providers, so the Services pillar has something to browse.
 *
 *   npx tsx scripts/seed-service-providers.ts
 *
 * Idempotent on `slug` — running it twice updates rather than duplicates, so it
 * is safe against a database that already has these.
 *
 * Fees are per provider and in kobo. The bike/car split is the only thing Sendy
 * charges for on a service booking, so the two numbers have to be far enough
 * apart that choosing between them is a real decision: a bike is roughly what a
 * dispatch costs, a car is roughly a short Bolt ride, which is what the
 * customer is actually comparing against.
 *
 * canTravelByBike is false wherever the kit will not fit on one. A cleaner with
 * a vacuum and a plumber with pipe cannot ride, and offering them at the bike
 * price would be selling something that cannot happen.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Seed = {
  slug: string;
  name: string;
  category: string;
  bio: string;
  tags: string[];
  area: string;
  bikeFeeKobo: number;
  carFeeKobo: number;
  canTravelByBike: boolean;
  typicalMinMinutes: number;
  typicalMaxMinutes: number;
  rating: number;
  ratingCount: number;
  isVerified: boolean;
};

const PROVIDERS: Seed[] = [
  {
    slug: 'kay-cuts-mobile-barber',
    name: 'Kay Cuts',
    category: 'Barber',
    bio: 'Mobile barber working Lekki and Victoria Island. Clippers, hot towel, beard shaping — your chair, your bathroom mirror, your rules.',
    tags: ['Fades', 'Beard trim', 'Kids cuts'],
    area: 'Lekki Phase 1',
    bikeFeeKobo: 100_000,
    carFeeKobo: 250_000,
    canTravelByBike: true,
    typicalMinMinutes: 30,
    typicalMaxMinutes: 50,
    rating: 4.9,
    ratingCount: 184,
    isVerified: true,
  },
  {
    slug: 'bisi-braids-stylist',
    name: 'Bisi Braids',
    category: 'Hair stylist',
    bio: 'Braids, cornrows and twists at home. Bring your own extensions or I can source them — tell me in the booking.',
    tags: ['Braids', 'Cornrows', 'Twists', 'Natural hair'],
    area: 'Yaba',
    bikeFeeKobo: 100_000,
    carFeeKobo: 250_000,
    canTravelByBike: true,
    // Braiding is long work and the quote reflects it; the range is honest.
    typicalMinMinutes: 120,
    typicalMaxMinutes: 300,
    rating: 4.8,
    ratingCount: 97,
    isVerified: true,
  },
  {
    slug: 'spotless-home-cleaning',
    name: 'Spotless Home Cleaning',
    category: 'Cleaning',
    bio: 'Two-person team for deep cleans, post-party and move-out. We bring everything — machine, mop, chemicals.',
    tags: ['Deep clean', 'Move-out', 'Post-party'],
    area: 'Ikeja GRA',
    bikeFeeKobo: 0,
    carFeeKobo: 350_000,
    // A vacuum and a chemical caddy do not go on a bike.
    canTravelByBike: false,
    typicalMinMinutes: 120,
    typicalMaxMinutes: 240,
    rating: 4.7,
    ratingCount: 212,
    isVerified: true,
  },
  {
    slug: 'tunde-plumbing-works',
    name: 'Tunde Plumbing Works',
    category: 'Plumbing',
    bio: 'Leaks, blocked drains, water heaters and pump installs. I quote once I have seen it — no guessing down a phone line.',
    tags: ['Leaks', 'Drains', 'Water heater', 'Pumps'],
    area: 'Surulere',
    bikeFeeKobo: 0,
    carFeeKobo: 300_000,
    canTravelByBike: false,
    typicalMinMinutes: 45,
    typicalMaxMinutes: 180,
    rating: 4.6,
    ratingCount: 143,
    isVerified: true,
  },
  {
    slug: 'volt-electricals',
    name: 'Volt Electricals',
    category: 'Electrician',
    bio: 'Wiring faults, sockets, light fittings, inverter and solar hookups. Certified, and I will tell you when a job needs more than one visit.',
    tags: ['Wiring', 'Inverter', 'Solar', 'Sockets'],
    area: 'Ajah',
    bikeFeeKobo: 120_000,
    carFeeKobo: 300_000,
    canTravelByBike: true,
    typicalMinMinutes: 60,
    typicalMaxMinutes: 180,
    rating: 4.8,
    ratingCount: 88,
    isVerified: true,
  },
  {
    slug: 'glow-by-amaka-makeup',
    name: 'Glow by Amaka',
    category: 'Makeup artist',
    bio: 'Bridal, owambe and photoshoot makeup at your place. Trials available — book one before the big day.',
    tags: ['Bridal', 'Owambe', 'Photoshoot', 'Gele'],
    area: 'Victoria Island',
    bikeFeeKobo: 100_000,
    carFeeKobo: 250_000,
    canTravelByBike: true,
    typicalMinMinutes: 60,
    typicalMaxMinutes: 150,
    rating: 5.0,
    ratingCount: 61,
    isVerified: true,
  },
  {
    slug: 'coolair-ac-servicing',
    name: 'CoolAir AC Servicing',
    category: 'AC repair',
    bio: 'Servicing, gas top-up, installs and relocations for split and window units.',
    tags: ['Servicing', 'Gas top-up', 'Installation'],
    area: 'Ikoyi',
    bikeFeeKobo: 0,
    carFeeKobo: 350_000,
    canTravelByBike: false,
    typicalMinMinutes: 60,
    typicalMaxMinutes: 120,
    rating: 4.5,
    ratingCount: 129,
    isVerified: true,
  },
  {
    slug: 'fixit-handyman-ng',
    name: 'FixIt Handyman',
    category: 'Handyman',
    bio: 'Shelves, doors, locks, curtain rails, flat-pack furniture — the small jobs that pile up.',
    tags: ['Furniture', 'Locks', 'Shelving', 'Doors'],
    area: 'Gbagada',
    bikeFeeKobo: 120_000,
    carFeeKobo: 280_000,
    canTravelByBike: true,
    typicalMinMinutes: 45,
    typicalMaxMinutes: 120,
    rating: 4.4,
    ratingCount: 76,
    isVerified: false,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const p of PROVIDERS) {
    const existing = await prisma.serviceProvider.findUnique({
      where: { slug: p.slug },
      select: { id: true },
    });

    await prisma.serviceProvider.upsert({
      where: { slug: p.slug },
      create: { ...p, state: 'Lagos', isAvailable: true },
      // Contact details and credentials are deliberately not touched on update:
      // a provider who has claimed their account must not be reset by a reseed.
      update: {
        name: p.name,
        category: p.category,
        bio: p.bio,
        tags: p.tags,
        area: p.area,
        bikeFeeKobo: p.bikeFeeKobo,
        carFeeKobo: p.carFeeKobo,
        canTravelByBike: p.canTravelByBike,
        typicalMinMinutes: p.typicalMinMinutes,
        typicalMaxMinutes: p.typicalMaxMinutes,
        isVerified: p.isVerified,
      },
    });

    existing ? updated++ : created++;
    const travel = p.canTravelByBike
      ? `bike NGN ${(p.bikeFeeKobo / 100).toFixed(0)} / car NGN ${(p.carFeeKobo / 100).toFixed(0)}`
      : `car only NGN ${(p.carFeeKobo / 100).toFixed(0)}`;
    console.log(`  ${existing ? 'updated' : 'created'}  ${p.name.padEnd(26)} ${p.category.padEnd(14)} ${travel}`);
  }

  console.log(`\n  ${created} created, ${updated} updated, ${PROVIDERS.length} total`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
