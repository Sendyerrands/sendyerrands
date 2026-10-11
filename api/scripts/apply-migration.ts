/**
 * Applies one migration over the pooled connection, and records it.
 *
 *   npx tsx scripts/apply-migration.ts <migration_folder_name>
 *
 * Exists because `prisma migrate deploy` needs the DIRECT database port, which
 * is unreachable from here — only the 6543 pooler answers. The pooler cannot
 * run `migrate deploy` (it needs advisory locks), but it runs DDL perfectly
 * well, so the statements go through it and the bookkeeping row is written by
 * hand afterwards.
 *
 * The checksum is sha256 of the migration.sql bytes. That is not assumed: the
 * script re-proves it against migrations already in the table before writing
 * anything, and refuses to continue if it cannot. Getting it wrong would make
 * `migrate deploy` report drift on the next real deploy.
 *
 * Idempotent on the bookkeeping: if the row already exists the script stops
 * rather than applying twice.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const name = process.argv[2]?.trim();

if (!name) {
  console.error('\n  Usage: npx tsx scripts/apply-migration.ts <migration_folder_name>\n');
  process.exit(1);
}

const dir = join('prisma', 'migrations', name);
const sqlPath = join(dir, 'migration.sql');

/**
 * Splits on statement boundaries.
 *
 * Comment lines are stripped first so a `;` inside one cannot split a
 * statement in half. This file's SQL has no dollar-quoted bodies or string
 * literals containing semicolons; if that ever changes, this needs a real
 * parser rather than a smarter regex.
 */
function statements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const raw = readFileSync(sqlPath);
  const checksum = createHash('sha256').update(raw).digest('hex');

  // Prove the algorithm against rows already in the table. If these do not
  // match, the assumption is wrong and nothing should be written.
  const existing = await prisma.$queryRawUnsafe<{ migration_name: string; checksum: string }[]>(
    `SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 5`
  );
  let proven = 0;
  for (const r of existing) {
    try {
      const f = join('prisma', 'migrations', r.migration_name, 'migration.sql');
      if (createHash('sha256').update(readFileSync(f)).digest('hex') === r.checksum) proven++;
    } catch {
      /* a migration folder that is not on disk proves nothing either way */
    }
  }
  if (proven < 3) {
    console.error(`\n  Checksum algorithm not proven (${proven} matches). Refusing to write.\n`);
    process.exit(1);
  }
  console.log(`  checksum algorithm proven against ${proven} existing migrations`);

  const already = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1`,
    name
  );
  if (already.length) {
    console.error(`\n  ${name} is already recorded. Nothing to do.\n`);
    process.exit(1);
  }

  if (!readdirSync(dir).includes('migration.sql')) {
    console.error(`\n  No migration.sql in ${dir}\n`);
    process.exit(1);
  }

  const parts = statements(raw.toString('utf8'));
  console.log(`  applying ${parts.length} statements from ${name}`);

  const started = new Date();
  for (const [i, stmt] of parts.entries()) {
    const head = stmt.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`    ${String(i + 1).padStart(2)}/${parts.length}  ok    ${head}`);
    } catch (err) {
      console.error(`    ${String(i + 1).padStart(2)}/${parts.length}  FAIL  ${head}`);
      console.error('      ' + (err instanceof Error ? err.message.split('\n')[0] : String(err)));
      console.error('\n  Stopped. Nothing was recorded, so this can be re-run after fixing.\n');
      process.exit(1);
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6)`,
    randomUUID(),
    checksum,
    new Date(),
    name,
    started,
    parts.length
  );

  console.log(`\n  recorded ${name} (${parts.length} steps, checksum ${checksum.slice(0, 12)}…)\n`);
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
