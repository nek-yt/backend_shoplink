import crypto from 'crypto';

const MAX_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
}

function safeEqualHex(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isFresh(authDate: unknown): boolean {
  const n = Number(authDate);
  const age = Date.now() / 1000 - n;
  return Number.isFinite(n) && age >= -300 && age <= MAX_AGE_SECONDS;
}

function toTelegramUser(raw: Record<string, unknown>): TelegramUser | null {
  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { id, firstName: str(raw.first_name), lastName: str(raw.last_name), username: str(raw.username) };
}

/**
 * Verifies data from the Telegram Login Widget (website login button).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyLoginWidget(data: Record<string, unknown>, botToken: string): TelegramUser | null {
  const { hash, ...fields } = data;
  if (typeof hash !== 'string') return null;
  const checkString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== null)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (!safeEqualHex(expected, hash.toLowerCase()) || !isFresh(fields.auth_date)) return null;
  return toTelegramUser(fields);
}

/**
 * Verifies initData from a Telegram Mini App (shop opened inside Telegram).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyWebAppInitData(initData: string, botToken: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (!safeEqualHex(expected, hash.toLowerCase()) || !isFresh(params.get('auth_date'))) return null;
  try {
    const user: unknown = JSON.parse(params.get('user') ?? 'null');
    return user && typeof user === 'object' ? toTelegramUser(user as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
