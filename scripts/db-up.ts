// Runs before `npm run dev`: starts PostgreSQL if needed, then applies any new Prisma migrations.
import { execFileSync } from 'child_process';
import { Client } from 'pg';
import { loadConfig } from '../src/config';
import { DB_HINTS, ensureDatabase } from '../src/database/ensure-database';

const prisma = (...args: string[]) =>
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], { stdio: 'inherit' });

// A database made by the old Express version already has the tables from 0_init but no Prisma
// history. Prisma refuses to migrate it (P3005) until 0_init is recorded as applied ("baselining").
async function needsBaseline(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public._prisma_migrations') IS NULL AS no_history, to_regclass('public.users') IS NOT NULL AS has_tables`,
    );
    return rows[0].no_history && rows[0].has_tables;
  } finally {
    await client.end();
  }
}

async function main() {
  const { databaseUrl } = loadConfig();
  await ensureDatabase(databaseUrl);
  if (await needsBaseline(databaseUrl)) {
    console.log('Existing ShopLink tables found, marking the initial migration as applied (your data is kept).');
    prisma('migrate', 'resolve', '--applied', '0_init');
  }
  prisma('migrate', 'deploy');
}

main().catch((err) => {
  if (err.status !== undefined) process.exit(err.status); // prisma already printed what went wrong
  console.error(`Database is not ready: ${err.message}`);
  if (DB_HINTS[err.code]) console.error(`Hint: ${DB_HINTS[err.code]}`);
  process.exit(1);
});
