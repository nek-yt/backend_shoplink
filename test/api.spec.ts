// End-to-end tests: the real Nest app on a random port, talking to PostgreSQL.
// Every run uses its own Postgres schema, which is dropped afterwards, so real data is never touched.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { Client } from 'pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../src/app';
import { ensureAdmin } from '../src/auth/auth.service';
import { type AppConfig, loadConfig } from '../src/config';
import { PrismaService } from '../src/database/prisma.service';

const BOT_TOKEN = '123456:TEST-BOT-TOKEN';
const TEST_SCHEMA = `test_${process.pid}_${Date.now()}`;
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shoplink-uploads-'));
const databaseUrl = process.env.TEST_DATABASE_URL || loadConfig().databaseUrl;

const config: AppConfig = {
  ...loadConfig(),
  env: 'test',
  jwtSecret: 'test-secret',
  jwtExpiresIn: '1h',
  databaseUrl,
  databaseSchema: TEST_SCHEMA,
  corsOrigin: '*',
  trustProxy: false,
  telegramBotToken: BOT_TOKEN,
  tiktok: { clientId: 'tt-key', clientSecret: 'tt-secret', redirectUri: 'https://shop.test/auth/tiktok' },
  instagram: { clientId: 'ig-app', clientSecret: 'ig-secret', redirectUri: 'https://shop.test/auth/instagram' },
  authRateLimit: 0,
  uploadDir: UPLOAD_DIR,
};

let app: NestExpressApplication;
let base: string;
let adminToken: string;

interface ApiOptions {
  body?: unknown;
  token?: string;
  raw?: string;
}

async function api(method: string, path: string, { body, token, raw }: ApiOptions = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  const json = res.headers.get('content-type')?.includes('json');
  return { status: res.status, body: text && json ? JSON.parse(text) : text || null };
}

let counter = 0;
async function registerCustomer(extra: Record<string, unknown> = {}) {
  counter += 1;
  const res = await api('POST', '/api/auth/register', {
    body: { name: `User ${counter}`, email: `user${counter}@test.com`, password: 'password123', ...extra },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function createProduct(fields: Record<string, unknown> = {}) {
  const res = await api('POST', '/api/products', {
    token: adminToken,
    body: { name: 'Hoodie', description: 'Warm', price: 100.5, stock: 10, sizes: ['S', 'M'], colors: ['black'], ...fields },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function sql(text: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(text);
  } finally {
    await client.end();
  }
}

before(async () => {
  // Same tables as the real database: every migration, run inside the test schema.
  const dir = path.resolve('prisma', 'migrations');
  const migrations = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql'))).sort();
  const ddl = migrations.map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8')).join('\n');
  await sql(`CREATE SCHEMA ${TEST_SCHEMA}; SET search_path TO ${TEST_SCHEMA}; ${ddl}`);

  app = await createApp(config);
  await ensureAdmin(app.get(PrismaService), { name: 'Admin', email: 'admin@test.com', password: 'admin12345' });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const res = await api('POST', '/api/auth/login', { body: { login: 'admin@test.com', password: 'admin12345' } });
  adminToken = res.body.token;
});

after(async () => {
  await app?.close();
  await sql(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});


// ---------- Auth ----------

test('register with email returns token and user without password', async () => {
  const { token, user } = await registerCustomer({ source: 'tiktok', socialUsername: '@my_tiktok' });
  assert.ok(token);
  assert.equal(user.role, 'customer');
  assert.equal(user.source, 'tiktok');
  assert.equal(user.socialUsername, 'my_tiktok');
  assert.equal(user.password_hash, undefined);
  assert.equal(user.passwordHash, undefined);
});

test('register with phone only and log in with phone in any format', async () => {
  const res = await api('POST', '/api/auth/register', {
    body: { name: 'Phone User', phone: '+998 (90) 111-22-33', password: 'password123', source: 'instagram' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.phone, '+998901112233');
  const login = await api('POST', '/api/auth/login', { body: { login: '+998 90 111 22 33', password: 'password123' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, res.body.user.id);
});

test('register validation errors', async () => {
  const res = await api('POST', '/api/auth/register', { body: { name: '', password: 'short', email: 'bad', source: 'facebook' } });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.includes('name must not be empty'));
  assert.ok(res.body.errors.includes('password must be at least 8 characters'));
  assert.ok(res.body.errors.includes('email must be a valid email'));
  assert.ok(res.body.errors.some((e: string) => e.startsWith('source must be one of')));

  const noContact = await api('POST', '/api/auth/register', { body: { name: 'X', password: 'password123' } });
  assert.equal(noContact.status, 400);
  assert.deepEqual(noContact.body.errors, ['email or phone is required']);
});

test('register rejects duplicate email (case-insensitive)', async () => {
  await registerCustomer({ email: 'dup@test.com' });
  const res = await api('POST', '/api/auth/register', { body: { name: 'Dup', email: 'DUP@test.com', password: 'password123' } });
  assert.equal(res.status, 409);
});

test('login with wrong password or unknown user fails and says which field is wrong', async () => {
  await registerCustomer({ email: 'login@test.com' });
  const wrong = await api('POST', '/api/auth/login', { body: { login: 'login@test.com', password: 'nope-nope' } });
  const unknown = await api('POST', '/api/auth/login', { body: { login: 'ghost@test.com', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.message, unknown.body.message);
  assert.deepEqual(wrong.body.errors, ['password is incorrect']);
  assert.deepEqual(unknown.body.errors, ['login is not registered']);
});

test('bad JSON and non-object bodies are rejected', async () => {
  const bad = await api('POST', '/api/auth/login', { raw: '{bad json' , body: undefined });
  assert.equal(bad.status, 400);
  const badJson = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(badJson.status, 400);
  const arr = await api('POST', '/api/auth/login', { body: [1, 2] });
  assert.equal(arr.status, 400);
});

test('/me requires a valid token and returns profile', async () => {
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
  const { token, user } = await registerCustomer();
  const me = await api('GET', '/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.id, user.id);
});

test('PATCH /me updates profile and protects login methods', async () => {
  const { token } = await registerCustomer({ email: 'patch@test.com' });
  const res = await api('PATCH', '/api/auth/me', { token, body: { name: 'New Name', phone: '+998907777777', socialUsername: '@insta' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'New Name');
  assert.equal(res.body.socialUsername, 'insta');

  const lockout = await api('PATCH', '/api/auth/me', { token, body: { email: null, phone: null } });
  assert.equal(lockout.status, 400);

  await registerCustomer({ email: 'taken@test.com' });
  const taken = await api('PATCH', '/api/auth/me', { token, body: { email: 'taken@test.com' } });
  assert.equal(taken.status, 409);

  const empty = await api('PATCH', '/api/auth/me', { token, body: {} });
  assert.equal(empty.status, 400);
});

// ---------- Telegram ----------

function signWidget(fields: Record<string, unknown>) {
  const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  return { ...fields, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
}

function signWebApp(user: Record<string, unknown>, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ query_id: 'AAHtest', user: JSON.stringify(user), auth_date: String(authDate) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

test('Telegram Login Widget creates a user once and logs them in again', async () => {
  const data = signWidget({ id: 555001, first_name: 'Tg', last_name: 'User', username: 'tguser', auth_date: Math.floor(Date.now() / 1000) });
  const first = await api('POST', '/api/auth/telegram', { body: data });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.user.source, 'telegram');
  assert.equal(first.body.user.telegramId, 555001);
  assert.equal(first.body.user.name, 'Tg User');
  const second = await api('POST', '/api/auth/telegram', { body: data });
  assert.equal(second.body.user.id, first.body.user.id);
});

test('Telegram Login Widget rejects forged and expired data', async () => {
  const data = signWidget({ id: 555002, first_name: 'A', auth_date: Math.floor(Date.now() / 1000) });
  const forged = await api('POST', '/api/auth/telegram', { body: { ...data, id: 999 } });
  assert.equal(forged.status, 401);
  const old = signWidget({ id: 555002, first_name: 'A', auth_date: Math.floor(Date.now() / 1000) - 3 * 86400 });
  assert.equal((await api('POST', '/api/auth/telegram', { body: old })).status, 401);
  assert.equal((await api('POST', '/api/auth/telegram', { body: { id: 1 } })).status, 401);
});

test('Telegram Mini App initData login works and rejects tampering', async () => {
  const initData = signWebApp({ id: 777001, first_name: 'Mini', username: 'miniapp' });
  const ok = await api('POST', '/api/auth/telegram-webapp', { body: { initData } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.telegramId, 777001);
  assert.equal(ok.body.user.socialUsername, 'miniapp');

  const tampered = initData.replace('777001', '777002');
  assert.equal((await api('POST', '/api/auth/telegram-webapp', { body: { initData: tampered } })).status, 401);
  assert.equal((await api('POST', '/api/auth/telegram-webapp', { body: {} })).status, 400);
});

test('Telegram-only users cannot use password login', async () => {
  const initData = signWebApp({ id: 777003, first_name: 'NoPass' });
  await api('POST', '/api/auth/telegram-webapp', { body: { initData } });
  const res = await api('POST', '/api/auth/login', { body: { login: 'NoPass', password: 'whatever1' } });
  assert.equal(res.status, 401);
});

// ---------- TikTok / Instagram ----------

// Fake TikTok and Instagram servers: calls to their hosts are answered here, everything else goes to the real fetch.
// Each fake account is keyed by the OAuth code that "logs in" as it.
const realFetch = globalThis.fetch;
const fakeAccounts: Record<string, { id: string; name: string; username?: string; scope?: string }> = {};
const providerCalls: { url: string; body: string }[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['open.tiktokapis.com', 'api.instagram.com', 'graph.instagram.com'].includes(url.hostname)) return realFetch(input, init);
  const body = String(init?.body ?? '');
  providerCalls.push({ url: url.toString(), body });

  if (url.pathname === '/v2/oauth/token/' || url.pathname === '/oauth/access_token') {
    const code = new URLSearchParams(body).get('code') ?? '';
    const account = fakeAccounts[code];
    if (!account) return json({ error: 'invalid_grant', error_description: 'Authorization code is expired.' }, 400);
    return url.hostname === 'open.tiktokapis.com'
      ? json({ access_token: `token-${code}`, open_id: account.id, scope: account.scope ?? 'user.info.basic,user.info.profile' })
      : json({ access_token: `token-${code}`, user_id: 17841400000000001, permissions: 'instagram_business_basic' });
  }
  const token = url.hostname === 'open.tiktokapis.com'
    ? (new Headers(init?.headers).get('Authorization') ?? '').replace('Bearer ', '')
    : url.searchParams.get('access_token') ?? '';
  const account = fakeAccounts[token.replace('token-', '')];
  if (!account) return json({ error: { code: 'access_token_invalid' } }, 401);
  if (url.pathname === '/v2/user/info/') {
    const fields = (url.searchParams.get('fields') ?? '').split(',');
    if (fields.includes('username') && !(account.scope ?? 'user.info.profile').includes('user.info.profile')) {
      return json({ error: { code: 'scope_not_authorized' } }, 401);
    }
    const user: Record<string, string> = { open_id: account.id, display_name: account.name };
    if (fields.includes('username') && account.username) user.username = account.username;
    return json({ data: { user }, error: { code: 'ok', message: '' } });
  }
  return json({ id: account.id, username: account.username, name: account.name }); // graph.instagram.com/me
};
after(() => {
  globalThis.fetch = realFetch;
});

test('TikTok and Instagram login URLs point at the providers with our app and redirect', async () => {
  const tt = new URL((await api('GET', '/api/auth/tiktok/url?state=abc123')).body.url);
  assert.equal(tt.origin + tt.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(tt.searchParams.get('client_key'), 'tt-key');
  assert.equal(tt.searchParams.get('redirect_uri'), 'https://shop.test/auth/tiktok');
  assert.equal(tt.searchParams.get('response_type'), 'code');
  assert.equal(tt.searchParams.get('state'), 'abc123');

  const ig = new URL((await api('GET', '/api/auth/instagram/url')).body.url);
  assert.equal(ig.origin + ig.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(ig.searchParams.get('client_id'), 'ig-app');
  assert.equal(ig.searchParams.get('scope'), 'instagram_business_basic');
  assert.equal(ig.searchParams.get('state'), null);
});

test('TikTok login creates the user once, logs them in again and refreshes the username', async () => {
  fakeAccounts['tt-code-1'] = { id: 'tt-open-id-1', name: 'Dilnoza', username: 'dilnoza.shop' };
  const first = await api('POST', '/api/auth/tiktok', { body: { code: 'tt-code-1' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.token);
  assert.equal(first.body.user.name, 'Dilnoza');
  assert.equal(first.body.user.source, 'tiktok');
  assert.equal(first.body.user.socialUsername, 'dilnoza.shop');
  assert.equal(first.body.user.tiktokId, 'tt-open-id-1');
  assert.equal(first.body.user.email, null);
  const exchange = providerCalls.find((c) => c.url.includes('/v2/oauth/token/'))!;
  assert.equal(new URLSearchParams(exchange.body).get('client_secret'), 'tt-secret');
  assert.equal(new URLSearchParams(exchange.body).get('redirect_uri'), 'https://shop.test/auth/tiktok');

  fakeAccounts['tt-code-2'] = { id: 'tt-open-id-1', name: 'Dilnoza', username: 'dilnoza.store' };
  const again = await api('POST', '/api/auth/tiktok', { body: { code: 'tt-code-2' } });
  assert.equal(again.body.user.id, first.body.user.id);
  assert.equal(again.body.user.socialUsername, 'dilnoza.store');
  const me = await api('GET', '/api/auth/me', { token: again.body.token });
  assert.equal(me.body.tiktokId, 'tt-open-id-1');
});

test('TikTok login works without the username scope', async () => {
  fakeAccounts['tt-basic'] = { id: 'tt-open-id-2', name: 'Basic Scope', scope: 'user.info.basic' };
  const res = await api('POST', '/api/auth/tiktok', { body: { code: 'tt-basic' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.name, 'Basic Scope');
  assert.equal(res.body.user.socialUsername, null);
});

test('Instagram login creates the user once and strips "#_" from the code', async () => {
  fakeAccounts['ig-code-1'] = { id: '9988776655443322', name: 'Malika Boutique', username: 'malika.boutique' };
  const first = await api('POST', '/api/auth/instagram', { body: { code: 'ig-code-1#_' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.user.source, 'instagram');
  assert.equal(first.body.user.instagramId, '9988776655443322');
  assert.equal(first.body.user.socialUsername, 'malika.boutique');
  assert.equal(first.body.user.name, 'Malika Boutique');

  fakeAccounts['ig-code-2'] = fakeAccounts['ig-code-1'];
  const again = await api('POST', '/api/auth/instagram', { body: { code: 'ig-code-2' } });
  assert.equal(again.body.user.id, first.body.user.id);
});

test('TikTok and Instagram reject bad codes and missing input', async () => {
  const tt = await api('POST', '/api/auth/tiktok', { body: { code: 'nope' } });
  assert.equal(tt.status, 401);
  assert.equal(tt.body.message, 'Invalid or expired TikTok code');
  const ig = await api('POST', '/api/auth/instagram', { body: { code: 'nope' } });
  assert.equal(ig.status, 401);
  assert.equal(ig.body.message, 'Invalid or expired Instagram code');
  const missing = await api('POST', '/api/auth/tiktok', { body: {} });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.errors, ['code is required']);
});

// ---------- Users (admin) ----------

test('user admin endpoints are admins only', async () => {
  const { token } = await registerCustomer();
  for (const path of ['/api/users', '/api/users/stats', '/api/users/logins', '/api/users/1']) {
    assert.equal((await api('GET', path)).status, 401, path);
    assert.equal((await api('GET', path, { token })).status, 403, path);
  }
});

test('stats count registrations, logins and active users', async () => {
  const before = (await api('GET', '/api/users/stats?days=7', { token: adminToken })).body;
  assert.equal(before.daily.length, 7);
  assert.equal(before.timeZone, config.statsTimeZone);

  const { user } = await registerCustomer({ source: 'instagram' });
  for (let i = 0; i < 2; i++) {
    const res = await api('POST', '/api/auth/login', { body: { login: user.email, password: 'password123' } });
    assert.equal(res.status, 200);
  }
  await api('POST', '/api/auth/login', { body: { login: user.email, password: 'wrong-password' } }); // not counted

  const after = (await api('GET', '/api/users/stats?days=7', { token: adminToken })).body;
  assert.equal(after.totalUsers, before.totalUsers + 1);
  assert.equal(after.customers, before.customers + 1);
  assert.equal(after.bySource.instagram, before.bySource.instagram + 1);
  assert.equal(after.registered.today, before.registered.today + 1);
  assert.equal(after.registered.last30Days, before.registered.last30Days + 1);
  assert.equal(after.logins.today, before.logins.today + 3); // register + 2 logins
  assert.equal(after.logins.total, before.logins.total + 3);
  assert.equal(after.loginsByMethod.register, before.loginsByMethod.register + 1);
  assert.equal(after.loginsByMethod.password, before.loginsByMethod.password + 2);
  assert.equal(after.activeUsers.today, before.activeUsers.today + 1);
  const today = after.daily.at(-1);
  assert.equal(today.registered, before.daily.at(-1).registered + 1);
  assert.equal(today.logins, before.daily.at(-1).logins + 3);
  assert.equal(after.registered.today, today.registered);

  assert.equal((await api('GET', '/api/users/stats?days=0', { token: adminToken })).status, 400);
});

test('user list shows login activity and can search, filter and sort', async () => {
  const { user } = await registerCustomer({ name: 'Жасур Каримов', phone: '+998 90 555 44 33', source: 'telegram' });
  await api('POST', '/api/auth/login', { body: { login: user.email, password: 'password123' } });

  const found = await api('GET', '/api/users?search=жасур', { token: adminToken });
  assert.equal(found.status, 200);
  assert.equal(found.body.total, 1);
  const row = found.body.items[0];
  assert.equal(row.id, user.id);
  assert.equal(row.loginCount, 2);
  assert.equal(row.ordersCount, 0);
  assert.ok(row.lastLoginAt);
  assert.equal(row.passwordHash, undefined);

  assert.equal((await api('GET', '/api/users?search=90 555-44', { token: adminToken })).body.items[0].id, user.id);
  const telegram = (await api('GET', '/api/users?source=telegram&limit=100', { token: adminToken })).body;
  assert.ok(telegram.items.every((u: any) => u.source === 'telegram'));
  const admins = (await api('GET', '/api/users?role=admin', { token: adminToken })).body;
  assert.deepEqual(admins.items.map((u: any) => u.email), ['admin@test.com']);
  const recent = (await api('GET', '/api/users?sort=lastLogin&limit=1', { token: adminToken })).body;
  assert.equal(recent.items[0].id, user.id);
  assert.equal((await api('GET', '/api/users?sort=nope', { token: adminToken })).status, 400);
});

test('user detail and login history', async () => {
  const { user } = await registerCustomer();
  await api('POST', '/api/auth/login', { body: { login: user.email, password: 'password123' } });

  const detail = await api('GET', `/api/users/${user.id}`, { token: adminToken });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.recentLogins.map((l: any) => l.method), ['password', 'register']);
  assert.equal(detail.body.recentLogins[0].userName, user.name);

  const history = (await api('GET', `/api/users/logins?userId=${user.id}`, { token: adminToken })).body;
  assert.equal(history.total, 2);
  const tg = (await api('GET', '/api/users/logins?method=telegram&limit=100', { token: adminToken })).body;
  assert.ok(tg.items.every((l: any) => l.method === 'telegram'));
  assert.equal((await api('GET', '/api/users/999999', { token: adminToken })).status, 404);
  assert.equal((await api('GET', '/api/users/logins?method=nope', { token: adminToken })).status, 400);
});

// ---------- Images ----------

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function upload(path: string, token: string | undefined, file: Buffer, name = 'photo.png', type = 'image/png'): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(file)], { type }), name);
  const res = await fetch(base + path, { method: 'PUT', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  return { status: res.status, body: await res.json() };
}

const uploadedFile = (url: string) => path.join(UPLOAD_DIR, ...url.replace('/api/uploads/', '').split('/'));

test('product picture: default, upload, replace, remove', async () => {
  const seller = await registerCustomer();
  const other = await registerCustomer();
  const product = (await api('POST', '/api/products', { token: seller.token, body: { name: 'Lamp', price: 10, stock: 1 } })).body;
  assert.equal(product.imageUrl, '/api/images/product.svg');
  assert.equal(product.hasImage, false);
  const placeholder = await fetch(base + product.imageUrl);
  assert.equal(placeholder.status, 200);
  assert.match(placeholder.headers.get('content-type')!, /image\/svg\+xml/);

  const first = await upload(`/api/products/${product.id}/image`, seller.token, PNG);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.imageUrl, /^\/api\/uploads\/products\/[\w-]+\.png$/);
  assert.equal(first.body.hasImage, true);
  const served = await fetch(base + first.body.imageUrl);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);

  // The old file is deleted when it's replaced.
  const second = await upload(`/api/products/${product.id}/image`, seller.token, PNG);
  assert.notEqual(second.body.imageUrl, first.body.imageUrl);
  assert.equal(fs.existsSync(uploadedFile(first.body.imageUrl)), false);
  assert.equal(fs.existsSync(uploadedFile(second.body.imageUrl)), true);

  assert.equal((await upload(`/api/products/${product.id}/image`, other.token, PNG)).status, 403);
  assert.equal((await upload(`/api/products/${product.id}/image`, undefined, PNG)).status, 401);
  assert.equal((await upload('/api/products/999999/image', seller.token, PNG)).status, 404);

  const removed = await api('DELETE', `/api/products/${product.id}/image`, { token: seller.token });
  assert.equal(removed.body.imageUrl, '/api/images/product.svg');
  assert.equal(removed.body.hasImage, false);
  assert.equal(fs.existsSync(uploadedFile(second.body.imageUrl)), false);
});

async function uploadMany(path: string, token: string | undefined, count: number): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append('images', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), `p${i}.png`);
  const res = await fetch(base + path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  return { status: res.status, body: await res.json() };
}

test('product extra pictures: add several, limit, remove one, deleted with the product', async () => {
  const seller = await registerCustomer();
  const other = await registerCustomer();
  const product = (await api('POST', '/api/products', { token: seller.token, body: { name: 'Vase', price: 10, stock: 1 } })).body;
  assert.deepEqual(product.images, []);

  const added = await uploadMany(`/api/products/${product.id}/images`, seller.token, 3);
  assert.equal(added.status, 201);
  assert.equal(added.body.images.length, 3);
  assert.equal(added.body.hasImage, false, 'the main picture is not touched');
  for (const url of added.body.images) assert.match(url, /^\/api\/uploads\/products\/[\w-]+\.png$/);
  assert.equal((await fetch(base + added.body.images[0])).status, 200);

  const more = await uploadMany(`/api/products/${product.id}/images`, seller.token, 2);
  assert.deepEqual(more.body.images.slice(0, 3), added.body.images, 'new pictures go to the end');
  assert.equal((await api('GET', `/api/products/${product.id}`)).body.images.length, 5);

  const tooMany = await uploadMany(`/api/products/${product.id}/images`, seller.token, 6);
  assert.equal(tooMany.status, 400);
  assert.equal((await api('GET', `/api/products/${product.id}`)).body.images.length, 5);
  assert.equal((await uploadMany(`/api/products/${product.id}/images`, seller.token, 0)).status, 400);
  assert.equal((await uploadMany(`/api/products/${product.id}/images`, other.token, 1)).status, 403);
  assert.equal((await uploadMany(`/api/products/${product.id}/images`, undefined, 1)).status, 401);
  assert.equal((await uploadMany('/api/products/999999/images', seller.token, 1)).status, 404);

  const gone = more.body.images[1];
  const name = gone.split('/').pop();
  assert.equal((await api('DELETE', `/api/products/${product.id}/images/${name}`, { token: other.token })).status, 403);
  const removed = await api('DELETE', `/api/products/${product.id}/images/${name}`, { token: seller.token });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.images, more.body.images.filter((u: string) => u !== gone));
  assert.equal(fs.existsSync(uploadedFile(gone)), false);
  assert.equal((await api('DELETE', `/api/products/${product.id}/images/${name}`, { token: seller.token })).status, 404);

  assert.equal((await api('DELETE', `/api/products/${product.id}`, { token: seller.token })).status, 204);
  for (const url of removed.body.images) assert.equal(fs.existsSync(uploadedFile(url)), false);
});

// ---------- Reviews ----------

test('reviews: add, one per user, not your own, edit, delete, product average', async () => {
  const seller = await registerCustomer();
  const a = await registerCustomer();
  const b = await registerCustomer();
  const product = (await api('POST', '/api/products', { token: seller.token, body: { name: 'Mug', price: 5, stock: 3, rating: 4.9 } })).body;
  assert.equal(product.reviewsCount, 0);
  assert.equal(product.reviewsRating, null);
  const url = `/api/products/${product.id}/reviews`;

  const first = await api('POST', url, { token: a.token, body: { rating: 5, comment: '  Great mug  ' } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.comment, 'Great mug');
  assert.equal(first.body.userName, a.user.name);
  assert.match(first.body.userAvatarUrl, /^\/api\/images\/avatar\.svg/);
  assert.equal((await api('POST', url, { token: a.token, body: { rating: 1 } })).status, 409);
  assert.equal((await api('POST', url, { token: seller.token, body: { rating: 5 } })).status, 403);
  assert.equal((await api('POST', url, { body: { rating: 5 } })).status, 401);
  const bad = await api('POST', url, { token: b.token, body: { rating: 6, comment: 1 } });
  assert.equal(bad.status, 400);
  assert.equal((await api('POST', '/api/products/999999/reviews', { token: b.token, body: { rating: 3 } })).status, 404);

  const second = await api('POST', url, { token: b.token, body: { rating: 2 } });
  assert.equal(second.body.comment, '');
  let p = (await api('GET', `/api/products/${product.id}`)).body;
  assert.equal(p.reviewsCount, 2);
  assert.equal(p.reviewsRating, 3.5);
  assert.equal(p.rating, 4.9, 'the seller-set rating is not touched');

  const list = await api('GET', `${url}?sort=rating_asc`);
  assert.equal(list.body.total, 2);
  assert.deepEqual(list.body.items.map((r: any) => r.rating), [2, 5]);
  assert.equal((await api('GET', `${url}/mine`, { token: a.token })).body.id, first.body.id);
  assert.equal((await api('GET', `${url}/mine`, { token: seller.token })).status, 404);

  assert.equal((await api('PATCH', `${url}/${first.body.id}`, { token: b.token, body: { rating: 1 } })).status, 403);
  assert.equal((await api('PATCH', `${url}/${first.body.id}`, { token: a.token, body: {} })).status, 400);
  const edited = await api('PATCH', `${url}/${first.body.id}`, { token: a.token, body: { rating: 4 } });
  assert.equal(edited.body.rating, 4);
  assert.equal(edited.body.comment, 'Great mug');
  assert.equal((await api('GET', `/api/products/${product.id}`)).body.reviewsRating, 3);

  assert.equal((await api('DELETE', `${url}/${second.body.id}`, { token: a.token })).status, 403);
  assert.equal((await api('DELETE', `${url}/${second.body.id}`, { token: adminToken })).status, 204);
  assert.equal((await api('DELETE', `${url}/${first.body.id}`, { token: a.token })).status, 204);
  assert.equal((await api('DELETE', `${url}/${first.body.id}`, { token: a.token })).status, 404);
  p = (await api('GET', `/api/products/${product.id}`)).body;
  assert.equal(p.reviewsCount, 0);
  assert.equal(p.reviewsRating, null);
});

test('uploads must be real images', async () => {
  const { token } = await registerCustomer();
  const fake = await upload('/api/auth/me/avatar', token, Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png');
  assert.equal(fake.status, 400);
  assert.deepEqual(fake.body.errors, ['image must be a JPEG, PNG, WebP or GIF file']);
  const svg = await upload('/api/auth/me/avatar', token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml');
  assert.equal(svg.status, 400);
  const big = await upload('/api/auth/me/avatar', token, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
  assert.equal(big.status, 413);
  const missing = await fetch(base + '/api/auth/me/avatar', { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: new FormData() });
  assert.equal(missing.status, 400);
});

test('profile picture: initials by default, upload and remove', async () => {
  const { token, user } = await registerCustomer({ name: 'Aziza Karimova' });
  assert.equal(user.avatarUrl, `/api/images/avatar.svg?name=Aziza%20Karimova&id=${user.id}`);
  assert.equal(user.hasAvatar, false);
  const svg = await (await fetch(base + user.avatarUrl)).text();
  assert.match(svg, />AK<\/text>/);
  assert.match(await (await fetch(base + '/api/images/avatar.svg?name=<b>x</b>')).text(), />&#60;<\/text>/);

  const up = await upload('/api/auth/me/avatar', token, PNG);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.match(up.body.avatarUrl, /^\/api\/uploads\/avatars\/[\w-]+\.png$/);
  assert.equal(up.body.hasAvatar, true);
  assert.equal((await api('GET', '/api/auth/me', { token })).body.avatarUrl, up.body.avatarUrl);

  const removed = await api('DELETE', '/api/auth/me/avatar', { token });
  assert.equal(removed.body.hasAvatar, false);
  assert.equal(fs.existsSync(uploadedFile(up.body.avatarUrl)), false);

  const link = await api('PATCH', '/api/auth/me', { token, body: { avatarUrl: 'https://cdn.test/me.jpg' } });
  assert.equal(link.body.avatarUrl, 'https://cdn.test/me.jpg');
  assert.equal((await api('PATCH', '/api/auth/me', { token, body: { avatarUrl: 'javascript:x' } })).status, 400);
});

// ---------- Wishlist ----------

test('wishlist: add (no duplicates), get by id, list, remove, clear', async () => {
  const { token } = await registerCustomer();
  const other = await registerCustomer();
  const a = await createProduct({ name: 'Wish A' });
  const b = await createProduct({ name: 'Wish B' });
  assert.equal((await api('GET', '/api/wishlist')).status, 401);

  const added = await api('POST', '/api/wishlist', { token, body: { productId: a.id } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.product.name, 'Wish A');
  const again = await api('POST', '/api/wishlist', { token, body: { productId: a.id } });
  assert.equal(again.body.id, added.body.id);
  await api('POST', '/api/wishlist', { token, body: { productId: b.id } });
  assert.equal((await api('POST', '/api/wishlist', { token, body: { productId: 999999 } })).status, 404);
  assert.deepEqual((await api('POST', '/api/wishlist', { token, body: {} })).body.errors, ['productId is required']);

  const list = (await api('GET', '/api/wishlist', { token })).body;
  assert.equal(list.total, 2);
  assert.deepEqual(list.items.map((i: any) => i.product.name), ['Wish B', 'Wish A']);

  const one = await api('GET', `/api/wishlist/${added.body.id}`, { token });
  assert.equal(one.body.productId, a.id);
  assert.equal((await api('GET', `/api/wishlist/${added.body.id}`, { token: other.token })).status, 404);
  assert.equal((await api('DELETE', `/api/wishlist/${added.body.id}`, { token: other.token })).status, 404);

  assert.equal((await api('DELETE', `/api/wishlist/${added.body.id}`, { token })).status, 204);
  assert.equal((await api('DELETE', `/api/wishlist/product/${b.id}`, { token })).status, 204);
  assert.equal((await api('DELETE', `/api/wishlist/product/${b.id}`, { token })).status, 404);
  await api('POST', '/api/wishlist', { token, body: { productId: a.id } });
  assert.equal((await api('DELETE', '/api/wishlist', { token })).status, 204);
  assert.equal((await api('GET', '/api/wishlist', { token })).body.total, 0);
});

test('deleting a product removes it from wishlists and carts', async () => {
  const { token } = await registerCustomer();
  const p = await createProduct({ sizes: [], colors: [] });
  await api('POST', '/api/wishlist', { token, body: { productId: p.id } });
  await api('POST', '/api/cart', { token, body: { productId: p.id } });
  await api('DELETE', `/api/products/${p.id}`, { token: adminToken });
  assert.equal((await api('GET', '/api/wishlist', { token })).body.total, 0);
  assert.equal((await api('GET', '/api/cart', { token })).body.items.length, 0);
});

test('each user (admin too) has their own wishlist, cart and orders', async () => {
  const alice = await registerCustomer({ phone: '+998901234601' });
  const bob = await registerCustomer({ phone: '+998901234602' });
  const p = await createProduct({ name: 'Private Item', sizes: [], colors: [] });

  const wish = (await api('POST', '/api/wishlist', { token: alice.token, body: { productId: p.id } })).body;
  const line = (await api('POST', '/api/cart', { token: alice.token, body: { productId: p.id, quantity: 2 } })).body;

  for (const token of [bob.token, adminToken]) {
    assert.equal((await api('GET', '/api/wishlist', { token })).body.items.some((i: any) => i.id === wish.id), false);
    assert.equal((await api('GET', '/api/cart', { token })).body.items.some((i: any) => i.id === line.id), false);
    assert.equal((await api('GET', `/api/wishlist/${wish.id}`, { token })).status, 404);
    assert.equal((await api('GET', `/api/cart/${line.id}`, { token })).status, 404);
    assert.equal((await api('PATCH', `/api/cart/${line.id}`, { token, body: { quantity: 1 } })).status, 404);
    assert.equal((await api('DELETE', `/api/cart/${line.id}`, { token })).status, 404);
    assert.equal((await api('DELETE', `/api/wishlist/${wish.id}`, { token })).status, 404);
    // Emptying your own cart/wishlist never touches anyone else's.
    await api('DELETE', '/api/cart', { token });
    await api('DELETE', '/api/wishlist', { token });
  }

  // Bob adding the same product gets his own lines, separate from Alice's.
  const bobLine = (await api('POST', '/api/cart', { token: bob.token, body: { productId: p.id } })).body;
  assert.notEqual(bobLine.id, line.id);
  assert.equal(bobLine.quantity, 1);

  // Alice's things are all still there, unchanged.
  assert.equal((await api('GET', `/api/wishlist/${wish.id}`, { token: alice.token })).status, 200);
  assert.equal((await api('GET', `/api/cart/${line.id}`, { token: alice.token })).body.quantity, 2);

  // Bob's checkout orders only Bob's cart.
  const order = (await api('POST', '/api/cart/checkout', { token: bob.token, body: { address: 'B' } })).body;
  assert.equal(order.userId, bob.user.id);
  assert.deepEqual(order.items.map((i: any) => i.quantity), [1]);
  assert.equal((await api('GET', `/api/cart/${line.id}`, { token: alice.token })).body.quantity, 2);
  assert.equal((await api('GET', '/api/orders', { token: alice.token })).body.total, 0);
  assert.equal((await api('GET', `/api/orders/${order.id}`, { token: alice.token })).status, 404);
});

// ---------- Cart ----------

test('cart: add merges the same product/size/color, totals, quantity, remove', async () => {
  const { token } = await registerCustomer();
  const other = await registerCustomer();
  const hoodie = await createProduct({ name: 'Cart Hoodie', price: 100, stock: 5, sizes: ['S', 'M'], colors: ['black'] });
  const cap = await createProduct({ name: 'Cart Cap', price: 25.5, stock: 10, sizes: [], colors: [] });

  const first = await api('POST', '/api/cart', { token, body: { productId: hoodie.id, size: 'm', color: 'BLACK' } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.size, 'M');
  assert.equal(first.body.color, 'black');
  assert.equal(first.body.quantity, 1);
  const merged = await api('POST', '/api/cart', { token, body: { productId: hoodie.id, size: 'M', color: 'black', quantity: 2 } });
  assert.equal(merged.body.id, first.body.id);
  assert.equal(merged.body.quantity, 3);
  const otherSize = await api('POST', '/api/cart', { token, body: { productId: hoodie.id, size: 'S', color: 'black' } });
  assert.notEqual(otherSize.body.id, first.body.id);
  const capLine = await api('POST', '/api/cart', { token, body: { productId: cap.id, quantity: 2 } });
  assert.equal(capLine.body.size, null);

  const cart = (await api('GET', '/api/cart', { token })).body;
  assert.equal(cart.items.length, 3);
  assert.equal(cart.totalQuantity, 6);
  assert.equal(cart.total, 451);
  assert.ok(cart.items.every((i: any) => i.available));

  assert.equal((await api('GET', `/api/cart/${capLine.body.id}`, { token })).body.subtotal, 51);
  assert.equal((await api('GET', `/api/cart/${capLine.body.id}`, { token: other.token })).status, 404);

  const tooMany = await api('POST', '/api/cart', { token, body: { productId: hoodie.id, size: 'M', color: 'black', quantity: 2 } });
  assert.equal(tooMany.status, 409);
  assert.deepEqual(tooMany.body.errors, ['"Cart Hoodie": requested 6, only 5 left']); // 3 M + 1 S + 2 more
  const noSize = await api('POST', '/api/cart', { token, body: { productId: hoodie.id, color: 'black' } });
  assert.equal(noSize.status, 400);
  assert.match(noSize.body.errors[0], /size is required/);
  assert.equal((await api('POST', '/api/cart', { token, body: { productId: 999999 } })).status, 404);

  const updated = await api('PATCH', `/api/cart/${capLine.body.id}`, { token, body: { quantity: 4 } });
  assert.equal(updated.body.quantity, 4);
  assert.equal((await api('PATCH', `/api/cart/${capLine.body.id}`, { token, body: { quantity: 11 } })).status, 409);
  assert.equal((await api('PATCH', `/api/cart/${capLine.body.id}`, { token, body: { quantity: 0 } })).status, 400);
  assert.equal((await api('PATCH', `/api/cart/${capLine.body.id}`, { token: other.token, body: { quantity: 1 } })).status, 404);

  // Stock dropping below the cart quantity shows up as available: false.
  await api('PATCH', `/api/products/${cap.id}`, { token: adminToken, body: { stock: 1 } });
  const line = (await api('GET', `/api/cart/${capLine.body.id}`, { token })).body;
  assert.equal(line.available, false);

  assert.equal((await api('DELETE', `/api/cart/${capLine.body.id}`, { token })).status, 204);
  assert.equal((await api('DELETE', `/api/cart/${capLine.body.id}`, { token })).status, 404);
  assert.equal((await api('DELETE', '/api/cart', { token })).status, 204);
  assert.equal((await api('GET', '/api/cart', { token })).body.total, 0);
});

test('cart checkout places one order and empties the cart', async () => {
  const { token } = await registerCustomer({ phone: '+998901112299' });
  const empty = await api('POST', '/api/cart/checkout', { token, body: { address: 'Tashkent' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, 'Your cart is empty');

  const shirt = await createProduct({ name: 'Checkout Shirt', price: 30, stock: 4, sizes: ['L'], colors: [] });
  await api('POST', '/api/cart', { token, body: { productId: shirt.id, size: 'L', quantity: 3 } });
  assert.deepEqual((await api('POST', '/api/cart/checkout', { token, body: {} })).body.errors, ['address is required']);

  const order = await api('POST', '/api/cart/checkout', { token, body: { address: 'Tashkent, Yunusabad', comment: 'Ring twice' } });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.total, 90);
  assert.equal(order.body.phone, '+998901112299');
  assert.deepEqual(order.body.items.map((i: any) => [i.productName, i.size, i.quantity]), [['Checkout Shirt', 'L', 3]]);
  assert.equal((await api('GET', `/api/products/${shirt.id}`)).body.stock, 1);
  assert.equal((await api('GET', '/api/cart', { token })).body.items.length, 0);

  // Not enough stock: nothing is ordered and the cart stays as it was.
  await api('POST', '/api/cart', { token, body: { productId: shirt.id, size: 'L' } });
  await api('PATCH', `/api/products/${shirt.id}`, { token: adminToken, body: { stock: 0 } });
  assert.equal((await api('POST', '/api/cart/checkout', { token, body: { address: 'Tashkent' } })).status, 409);
  assert.equal((await api('GET', '/api/cart', { token })).body.items.length, 1);
});

test('get by id: one login record and one sale', async () => {
  const seller = await registerCustomer();
  const buyer = await registerCustomer({ phone: '+998901112300' });
  const history = (await api('GET', `/api/users/logins?userId=${seller.user.id}`, { token: adminToken })).body;
  const login = await api('GET', `/api/users/logins/${history.items[0].id}`, { token: adminToken });
  assert.equal(login.status, 200);
  assert.equal(login.body.userId, seller.user.id);
  assert.equal(login.body.method, 'register');
  assert.equal((await api('GET', '/api/users/logins/999999', { token: adminToken })).status, 404);
  assert.equal((await api('GET', `/api/users/logins/${history.items[0].id}`, { token: seller.token })).status, 403);

  const p = (await api('POST', '/api/products', { token: seller.token, body: { name: 'Sale Item', price: 15, stock: 3 } })).body;
  const order = (await api('POST', '/api/orders', { token: buyer.token, body: { address: 'X', items: [{ productId: p.id, quantity: 2 }] } })).body;
  const sale = await api('GET', `/api/orders/sales/${order.id}`, { token: seller.token });
  assert.equal(sale.status, 200);
  assert.equal(sale.body.total, 30);
  assert.equal((await api('GET', `/api/orders/sales/${order.id}`, { token: buyer.token })).status, 404);
});

// ---------- Products ----------

test('any user can sell products but only change their own; admins can change any', async () => {
  const body = { name: 'Handmade Bag', price: 50, stock: 3 };
  assert.equal((await api('POST', '/api/products', { body })).status, 401);

  const seller = await registerCustomer();
  const other = await registerCustomer();
  const created = await api('POST', '/api/products', { token: seller.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const product = created.body;
  assert.equal(product.sellerId, seller.user.id);

  const forbidden = await api('PATCH', `/api/products/${product.id}`, { token: other.token, body: { price: 1 } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.message, 'You can only change your own products');
  assert.equal((await api('DELETE', `/api/products/${product.id}`, { token: other.token })).status, 403);

  const updated = await api('PATCH', `/api/products/${product.id}`, { token: seller.token, body: { price: 60 } });
  assert.equal(updated.body.price, 60);
  assert.equal((await api('PATCH', `/api/products/${product.id}`, { token: adminToken, body: { stock: 5 } })).body.stock, 5);

  const mine = (await api('GET', '/api/products/mine', { token: seller.token })).body;
  assert.deepEqual(mine.items.map((p: any) => p.id), [product.id]);
  assert.equal((await api('GET', '/api/products/mine', { token: other.token })).body.total, 0);
  assert.equal((await api('GET', '/api/products/mine')).status, 401);
  const bySeller = (await api('GET', `/api/products?sellerId=${seller.user.id}`)).body;
  assert.deepEqual(bySeller.items.map((p: any) => p.id), [product.id]);

  assert.equal((await api('DELETE', `/api/products/${product.id}`, { token: seller.token })).status, 204);
  assert.equal((await api('DELETE', `/api/products/${product.id}`, { token: seller.token })).status, 404);
});

test('sellers see orders for their products, with only their items', async () => {
  const seller = await registerCustomer();
  const buyer = await registerCustomer({ phone: '+998901234000' });
  const own = (await api('POST', '/api/products', { token: seller.token, body: { name: 'Seller Cap', price: 20, stock: 5 } })).body;
  const shop = await createProduct({ name: 'Shop Hoodie', price: 100, sizes: [], colors: [] });

  const order = await api('POST', '/api/orders', {
    token: buyer.token,
    body: { address: 'Tashkent', items: [{ productId: own.id, quantity: 2 }, { productId: shop.id, quantity: 1 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.total, 140);

  const sales = (await api('GET', '/api/orders/sales', { token: seller.token })).body;
  assert.equal(sales.total, 1);
  const sale = sales.items[0];
  assert.equal(sale.id, order.body.id);
  assert.deepEqual(sale.items.map((i: any) => i.productName), ['Seller Cap']);
  assert.equal(sale.items[0].sellerId, seller.user.id);
  assert.equal(sale.total, 40);
  assert.equal(sale.address, 'Tashkent');

  // Still shown after the seller deletes the product.
  await api('DELETE', `/api/products/${own.id}`, { token: seller.token });
  assert.equal((await api('GET', '/api/orders/sales', { token: seller.token })).body.total, 1);
  assert.equal((await api('GET', '/api/orders/sales', { token: buyer.token })).body.total, 0);
  assert.equal((await api('GET', '/api/orders/sales?status=shipped', { token: seller.token })).body.total, 0);
  assert.equal((await api('GET', '/api/orders/sales')).status, 401);
});

test('create product returns all fields with correct types and defaults', async () => {
  const p = await createProduct({ name: '  Футболка  ', price: 19.99, rating: 4.5, stock: 3, sizes: ['M', ' L ', 'm'], colors: ['red'] });
  assert.equal(p.name, 'Футболка');
  assert.equal(p.price, 19.99);
  assert.equal(p.rating, 4.5);
  assert.equal(p.stock, 3);
  assert.equal(p.inStock, true);
  assert.deepEqual(p.sizes, ['M', 'L']);
  assert.deepEqual(p.colors, ['red']);
  assert.equal(p.imageUrl, '/api/images/product.svg');
  assert.equal(p.hasImage, false);
  assert.equal(p.description, 'Warm');

  const minimal = await api('POST', '/api/products', { token: adminToken, body: { name: 'Minimal', price: 0, stock: 0 } });
  assert.equal(minimal.status, 201);
  assert.equal(minimal.body.rating, 0);
  assert.deepEqual(minimal.body.sizes, []);
  assert.equal(minimal.body.inStock, false);
});

test('product validation errors', async () => {
  const res = await api('POST', '/api/products', {
    token: adminToken,
    body: { name: '', price: -1, rating: 6, stock: 1.5, sizes: 'M', colors: [''], imageUrl: 'javascript:alert(1)' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.errors.length, 7);
  const decimals = await api('POST', '/api/products', { token: adminToken, body: { name: 'X', price: 1.234, stock: 1 } });
  assert.equal(decimals.status, 400);
  const stringPrice = await api('POST', '/api/products', { token: adminToken, body: { name: 'X', price: '10', stock: 1 } });
  assert.equal(stringPrice.status, 400);
});

test('get, update and delete a product', async () => {
  const p = await createProduct();
  const got = await api('GET', `/api/products/${p.id}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, p);

  const upd = await api('PATCH', `/api/products/${p.id}`, { token: adminToken, body: { price: 55, stock: 0, imageUrl: 'https://img.test/a.jpg' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.price, 55);
  assert.equal(upd.body.stock, 0);
  assert.equal(upd.body.inStock, false);
  assert.equal(upd.body.name, p.name);
  assert.equal(upd.body.imageUrl, 'https://img.test/a.jpg');

  assert.equal((await api('PATCH', `/api/products/${p.id}`, { token: adminToken, body: {} })).status, 400);
  assert.equal((await api('DELETE', `/api/products/${p.id}`, { token: adminToken })).status, 204);
  assert.equal((await api('GET', `/api/products/${p.id}`)).status, 404);
  assert.equal((await api('DELETE', `/api/products/${p.id}`, { token: adminToken })).status, 404);
});

test('invalid product ids return 400', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    assert.equal((await api('GET', `/api/products/${id}`)).status, 400, id);
  }
});

test('list products with filters, sorting and pagination', async () => {
  const tag = `filt${Date.now()}`;
  await createProduct({ name: `${tag} Красное платье`, price: 300, rating: 5, stock: 2, sizes: ['XS'], colors: ['Red'] });
  await createProduct({ name: `${tag} Blue jeans`, price: 100, rating: 3, stock: 0, sizes: ['32'], colors: ['blue'] });
  await createProduct({ name: `${tag} Black tee`, price: 200, rating: 4, stock: 5, sizes: ['M'], colors: ['black'] });

  const all = await api('GET', `/api/products?search=${tag}&sort=price_asc`);
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);
  assert.deepEqual(all.body.items.map((p: any) => p.price), [100, 200, 300]);

  const cyr = await api('GET', `/api/products?search=${encodeURIComponent('КРАСНОЕ')}`);
  assert.equal(cyr.body.total, 1);

  const color = await api('GET', `/api/products?search=${tag}&color=RED`);
  assert.equal(color.body.items[0].colors[0], 'Red');
  assert.equal(color.body.total, 1);

  assert.equal((await api('GET', `/api/products?search=${tag}&size=m`)).body.total, 1);
  assert.equal((await api('GET', `/api/products?search=${tag}&inStock=true`)).body.total, 2);
  assert.equal((await api('GET', `/api/products?search=${tag}&inStock=false`)).body.total, 1);
  assert.equal((await api('GET', `/api/products?search=${tag}&minPrice=150&maxPrice=250`)).body.total, 1);
  assert.equal((await api('GET', `/api/products?search=${tag}&minRating=4`)).body.total, 2);

  const page2 = await api('GET', `/api/products?search=${tag}&sort=price_desc&limit=2&page=2`);
  assert.equal(page2.body.pages, 2);
  assert.equal(page2.body.items.length, 1);
  assert.equal(page2.body.items[0].price, 100);

  const pct = await api('GET', `/api/products?search=${encodeURIComponent('%')}`);
  assert.equal(pct.body.total, 0);
});

test('invalid list query parameters return 400', async () => {
  for (const qs of ['page=0', 'limit=101', 'limit=abc', 'minPrice=-5', 'minRating=9', 'inStock=yes', 'sort=random', 'size=a&size=b']) {
    assert.equal((await api('GET', `/api/products?${qs}`)).status, 400, qs);
  }
});

// ---------- Orders ----------

test('place an order: stock is reduced, prices are snapshotted, profile defaults are used', async () => {
  const { token, user } = await registerCustomer({ phone: '+998901234500', source: 'instagram' });
  const p = await createProduct({ price: 19.99, stock: 5, sizes: ['S', 'M'], colors: ['black', 'white'] });

  const res = await api('POST', '/api/orders', {
    token,
    body: { address: 'Tashkent', items: [{ productId: p.id, quantity: 2, size: 'm', color: 'WHITE' }, { productId: p.id, quantity: 1, size: 'S', color: 'black' }] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = res.body;
  assert.equal(order.status, 'new');
  assert.equal(order.userId, user.id);
  assert.equal(order.customerName, user.name);
  assert.equal(order.phone, '+998901234500');
  assert.equal(order.source, 'instagram');
  assert.equal(order.total, 59.97);
  assert.equal(order.items[0].size, 'M');
  assert.equal(order.items[0].color, 'white');
  assert.equal(order.items[0].subtotal, 39.98);

  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 2);

  // Changing the product price later does not change the order.
  await api('PATCH', `/api/products/${p.id}`, { token: adminToken, body: { price: 999 } });
  assert.equal((await api('GET', `/api/orders/${order.id}`, { token })).body.total, 59.97);
});

test('order fails without changing stock when there is not enough', async () => {
  const { token } = await registerCustomer({ phone: '+998901234501' });
  const a = await createProduct({ stock: 5, sizes: [], colors: [] });
  const b = await createProduct({ stock: 1, sizes: [], colors: [] });
  const res = await api('POST', '/api/orders', {
    token,
    body: { address: 'X', items: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 2 }] },
  });
  assert.equal(res.status, 409);
  assert.equal((await api('GET', `/api/products/${a.id}`)).body.stock, 5);
  assert.equal((await api('GET', `/api/products/${b.id}`)).body.stock, 1);

  // Same product split across lines is counted together.
  const split = await api('POST', '/api/orders', {
    token,
    body: { address: 'X', items: [{ productId: b.id, quantity: 1 }, { productId: b.id, quantity: 1 }] },
  });
  assert.equal(split.status, 409);
});

test('order validation: size/color rules, missing fields, unknown products', async () => {
  const { token } = await registerCustomer();
  const p = await createProduct({ sizes: ['S'], colors: ['black'] });
  const noSizes = await createProduct({ sizes: [], colors: [] });

  const noPhone = await api('POST', '/api/orders', { token, body: { address: 'X', items: [{ productId: p.id, quantity: 1, size: 'S', color: 'black' }] } });
  assert.equal(noPhone.status, 400);
  assert.deepEqual(noPhone.body.errors, ['phone is required']);

  const phone = '+998901234502';
  const cases = [
    { body: { phone, items: [{ productId: p.id, quantity: 1, size: 'S', color: 'black' }] } },
    { body: { phone, address: 'X', items: [] } },
    { body: { phone, address: 'X' } },
    { body: { phone, address: 'X', items: [{ productId: p.id, quantity: 0, size: 'S', color: 'black' }] } },
    { body: { phone, address: 'X', items: [{ productId: p.id, quantity: 1, color: 'black' }] } },
    { body: { phone, address: 'X', items: [{ productId: p.id, quantity: 1, size: 'XXL', color: 'black' }] } },
    { body: { phone, address: 'X', items: [{ productId: noSizes.id, quantity: 1, size: 'M' }] } },
    { body: { phone, address: 'X', items: [{ productId: 999999, quantity: 1 }] } },
    { body: { phone, address: 'X', items: ['bad'] } },
  ];
  for (const c of cases) {
    const res = await api('POST', '/api/orders', { token, body: c.body });
    assert.equal(res.status, 400, JSON.stringify(c.body));
  }
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 10);
});

test('everyone sees only their own orders; admins see all of them at /all', async () => {
  const alice = await registerCustomer({ phone: '+998901234503' });
  const bob = await registerCustomer({ phone: '+998901234504' });
  const p = await createProduct({ sizes: [], colors: [] });
  const order = (await api('POST', '/api/orders', { token: alice.token, body: { address: 'A', items: [{ productId: p.id, quantity: 1 }] } })).body;
  assert.match(order.orderNumber, /^SL-[2-9A-HJKMNP-Z]{8}$/);

  assert.equal((await api('GET', `/api/orders/${order.id}`, { token: bob.token })).status, 404);
  assert.equal((await api('GET', `/api/orders/number/${order.orderNumber}`, { token: bob.token })).status, 404);
  assert.equal((await api('POST', `/api/orders/${order.id}/cancel`, { token: bob.token })).status, 404);
  assert.equal((await api('GET', '/api/orders', { token: bob.token })).body.total, 0);
  const aliceOrders = (await api('GET', '/api/orders', { token: alice.token })).body;
  assert.deepEqual(aliceOrders.items.map((o: any) => o.orderNumber), [order.orderNumber]);
  assert.equal((await api('GET', `/api/orders/number/${order.orderNumber.toLowerCase()}`, { token: alice.token })).body.id, order.id);

  // The admin's own list has only the admin's orders, not the customers'.
  const adminMine = (await api('GET', '/api/orders?limit=100', { token: adminToken })).body;
  assert.ok(adminMine.items.every((o: any) => o.userId !== alice.user.id));
  // Admins can't cancel a customer's order with /cancel (they change the status instead).
  assert.equal((await api('POST', `/api/orders/${order.id}/cancel`, { token: adminToken })).status, 404);

  // All orders: admins only.
  assert.equal((await api('GET', '/api/orders/all', { token: alice.token })).status, 403);
  const filtered = (await api('GET', `/api/orders/all?userId=${alice.user.id}`, { token: adminToken })).body;
  assert.deepEqual(filtered.items.map((o: any) => o.id), [order.id]);
  assert.equal((await api('GET', `/api/orders/${order.id}`, { token: adminToken })).status, 200);
  assert.equal((await api('GET', `/api/orders/number/${order.orderNumber}`, { token: adminToken })).status, 200);

  // Every order gets a different number.
  const second = (await api('POST', '/api/orders', { token: alice.token, body: { address: 'A', items: [{ productId: p.id, quantity: 1 }] } })).body;
  assert.notEqual(second.orderNumber, order.orderNumber);
});

test('customer cancel returns stock; only new orders can be cancelled', async () => {
  const { token } = await registerCustomer({ phone: '+998901234505' });
  const p = await createProduct({ stock: 4, sizes: [], colors: [] });
  const order = (await api('POST', '/api/orders', { token, body: { address: 'A', items: [{ productId: p.id, quantity: 3 }] } })).body;
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 1);

  const cancelled = await api('POST', `/api/orders/${order.id}/cancel`, { token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 4);

  assert.equal((await api('POST', `/api/orders/${order.id}/cancel`, { token })).status, 409);
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 4);
});

test('admin status workflow enforces allowed transitions', async () => {
  const customer = await registerCustomer({ phone: '+998901234506' });
  const p = await createProduct({ stock: 3, sizes: [], colors: [] });
  const order = (await api('POST', '/api/orders', { token: customer.token, body: { address: 'A', items: [{ productId: p.id, quantity: 1 }] } })).body;
  const setStatus = (status: string, token = adminToken) => api('PATCH', `/api/orders/${order.id}/status`, { token, body: { status } });

  assert.equal((await setStatus('confirmed', customer.token)).status, 403);
  assert.equal((await setStatus('delivered')).status, 409);
  assert.equal((await setStatus('bogus')).status, 400);
  assert.equal((await setStatus('confirmed')).body.status, 'confirmed');
  assert.equal((await api('POST', `/api/orders/${order.id}/cancel`, { token: customer.token })).status, 409);
  assert.equal((await setStatus('shipped')).body.status, 'shipped');
  assert.equal((await setStatus('cancelled')).status, 409);
  assert.equal((await setStatus('delivered')).body.status, 'delivered');
  assert.equal((await setStatus('new')).status, 409);
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 2);

  const statusFilter = await api('GET', '/api/orders/all?status=delivered', { token: adminToken });
  assert.ok(statusFilter.body.items.every((o: any) => o.status === 'delivered'));
});

test('admin cancelling a confirmed order returns stock, even after product edits', async () => {
  const customer = await registerCustomer({ phone: '+998901234507' });
  const p = await createProduct({ stock: 5, sizes: [], colors: [] });
  const order = (await api('POST', '/api/orders', { token: customer.token, body: { address: 'A', items: [{ productId: p.id, quantity: 2 }] } })).body;
  await api('PATCH', `/api/orders/${order.id}/status`, { token: adminToken, body: { status: 'confirmed' } });
  await api('PATCH', `/api/products/${p.id}`, { token: adminToken, body: { stock: 10 } });
  await api('PATCH', `/api/orders/${order.id}/status`, { token: adminToken, body: { status: 'cancelled' } });
  assert.equal((await api('GET', `/api/products/${p.id}`)).body.stock, 12);
});

test('deleting a product keeps past orders intact', async () => {
  const customer = await registerCustomer({ phone: '+998901234508' });
  const p = await createProduct({ name: 'Gone soon', price: 10, sizes: [], colors: [] });
  const order = (await api('POST', '/api/orders', { token: customer.token, body: { address: 'A', items: [{ productId: p.id, quantity: 1 }] } })).body;
  assert.equal((await api('DELETE', `/api/products/${p.id}`, { token: adminToken })).status, 204);

  const after = await api('GET', `/api/orders/${order.id}`, { token: customer.token });
  assert.equal(after.body.items[0].productId, null);
  assert.equal(after.body.items[0].productName, 'Gone soon');
  assert.equal(after.body.total, 10);
  // Cancelling still works when the product no longer exists.
  assert.equal((await api('POST', `/api/orders/${order.id}/cancel`, { token: customer.token })).status, 200);
});

// ---------- Misc ----------

test('health, swagger, openapi and unknown routes', async () => {
  assert.equal((await api('GET', '/health')).body.status, 'ok');
  assert.equal((await fetch(base + '/docs/')).status, 200);
  assert.equal((await fetch(base + '/', { redirect: 'manual' })).headers.get('location'), '/docs');
  assert.equal((await fetch(base + '/login')).status, 404);
  const spec = await api('GET', '/openapi.json');
  assert.equal(spec.body.info.title, 'ShopLink API');
  assert.equal((await api('GET', '/api/nope')).status, 404);
});

test('every path in the OpenAPI spec is served by the app', async () => {
  const spec = (await api('GET', '/openapi.json')).body;
  for (const [path, methods] of Object.entries<object>(spec.paths)) {
    for (const method of Object.keys(methods).filter((m) => m !== 'parameters')) {
      const res = await api(method.toUpperCase(), path.replace('{id}', '1'));
      assert.notEqual(res.body?.message, 'Route not found', `${method.toUpperCase()} ${path}`);
    }
  }
});
