import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WAIT_SECONDS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorCode = (err: unknown) => (err as { code?: string }).code;

function findPgCtl(): string {
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, 'pg_ctl');
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    const versions = fs.existsSync(root) ? fs.readdirSync(root).sort((a, b) => Number(b) - Number(a)) : [];
    for (const v of versions) {
      const exe = path.join(root, v, 'bin', 'pg_ctl.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'pg_ctl';
}

// Starts the PostgreSQL cluster in PGDATA when DATABASE_URL points at this machine.
// Returns false when there is nothing we can start (remote host, no PGDATA set).
function startLocalPostgres(url: URL): Promise<boolean> {
  const dataDir = process.env.PGDATA;
  if (!dataDir || !LOCAL_HOSTS.has(url.hostname)) return Promise.resolve(false);

  const port = url.port || '5432';
  // The log must live outside PGDATA: on Windows, crash recovery fails to open a log file
  // that the server itself holds open inside the data folder ("sharing violation").
  const logFile = `${path.resolve(dataDir)}.log`;
  const args = ['start', '-w', '-t', String(WAIT_SECONDS), '-D', dataDir, '-o', `-p ${port}`, '-l', logFile];
  console.log(`PostgreSQL is not running, starting it (port ${port})...`);
  return new Promise((resolve, reject) => {
    // pg_ctl runs the server in the background, so it keeps running when --watch restarts us.
    const child = execFile(findPgCtl(), args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Could not start PostgreSQL: ${(stderr || stdout || err.message).trim()}`));
      console.log('PostgreSQL started.');
      resolve(true);
    });
    child.unref();
  });
}

async function query(connectionString: string, sql: string): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(sql);
  } finally {
    await client.end().catch(() => {});
  }
}

// Creates the database named in the URL by connecting to the default "postgres" database.
async function createDatabase(url: URL): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error(`Database "${name}" does not exist`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  try {
    await query(admin.toString(), `CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`Created database "${name}"`);
  } catch (err) {
    if (errorCode(err) !== '42P04') throw err; // 42P04: someone else created it at the same moment
  }
}

/**
 * Makes sure PostgreSQL accepts connections: starts the local server if it is down, waits while it
 * is starting up or recovering after an unclean shutdown, and creates the database if it is missing.
 */
export async function ensureDatabase(connectionString: string): Promise<void> {
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
  const url = new URL(connectionString);
  let started = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await query(connectionString, 'SELECT 1');
    } catch (err) {
      const code = errorCode(err);
      if (code === '3D000') return createDatabase(url); // database does not exist yet
      if (code === 'ECONNREFUSED' && !started) {
        started = await startLocalPostgres(url);
        if (!started) throw err;
      } else if ((code === '57P03' || code === 'ECONNREFUSED') && attempt < WAIT_SECONDS) {
        if (attempt % 10 === 0) console.log('Waiting for PostgreSQL to be ready...');
        await sleep(1000);
      } else {
        throw err;
      }
    }
  }
}

// Plain-language hints for the usual PostgreSQL startup problems.
export const DB_HINTS: Record<string, string> = {
  ECONNREFUSED: 'PostgreSQL is not running. Set PGDATA in .env so it starts automatically, or check host/port in DATABASE_URL.',
  '28P01': 'Wrong PostgreSQL username or password in DATABASE_URL.',
  '57P03': 'PostgreSQL is still starting up or stuck in recovery. Wait a moment and try again.',
};
