import 'reflect-metadata';
import { createApp } from './app';
import { ensureAdmin } from './auth/auth.service';
import { loadConfig } from './config';
import { DB_HINTS, ensureDatabase } from './database/ensure-database';
import { PrismaService } from './database/prisma.service';

async function main() {
  const config = loadConfig();
  await ensureDatabase(config.databaseUrl);

  const app = await createApp(config);
  app.enableShutdownHooks();
  if (await ensureAdmin(app.get(PrismaService), config.admin)) {
    console.log(`Admin account created: ${config.admin.email}`);
  }
  if (!config.isProd && !process.env.JWT_SECRET) {
    console.warn('Warning: JWT_SECRET is not set, using an insecure development secret.');
  }

  await app.listen(config.port);
  console.log(`ShopLink API running on http://localhost:${config.port}`);
  console.log(`Swagger: http://localhost:${config.port}/docs`);
}

main().catch((err) => {
  console.error(`Failed to start: ${err.message}`);
  const hint = DB_HINTS[err.code];
  if (hint) console.error(`Hint: ${hint}`);
  if (err.code === 'EADDRINUSE') console.error('Hint: another program (maybe an old "npm run dev") is already using this port. Close it or change PORT in .env.');
  if (err.code === 'P2021') console.error('Hint: the tables are missing. Run: npm run db:migrate');
  process.exit(1);
});
