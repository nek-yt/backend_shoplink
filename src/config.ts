import { config as loadEnv } from 'dotenv';
import path from 'path';
import type { OAuthApp } from './auth/oauth';

loadEnv({ quiet: true });

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  env: string;
  isProd: boolean;
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  databaseUrl: string;
  /** Postgres schema for the tables (the tests use a temporary one). Default: public. */
  databaseSchema?: string;
  corsOrigin: string;
  trustProxy: boolean | number | string;
  telegramBotToken: string;
  /** Log in with TikTok / Instagram; null when not configured. */
  tiktok: OAuthApp | null;
  instagram: OAuthApp | null;
  /** Max login/register attempts per IP per 15 minutes. 0 disables the limit. */
  authRateLimit: number;
  /** Time zone that "today" means in the user stats. */
  statsTimeZone: string;
  /** Folder for uploaded product pictures and profile pictures. */
  uploadDir: string;
  admin: { name: string; email: string; password: string };
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function oauthApp(clientId?: string, clientSecret?: string, redirectUri?: string): OAuthApp | null {
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

function parseTimeZone(value: string | undefined): string {
  const tz = value || 'Asia/Tashkent';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new Error(`STATS_TIME_ZONE "${tz}" is not a valid time zone (example: Asia/Tashkent)`);
  }
  return tz;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    if (isProd) throw new Error('JWT_SECRET must be set in production');
    jwtSecret = 'dev-only-secret-change-me';
  }

  return {
    env: nodeEnv,
    isProd,
    port: parseNonNegativeInt(env.PORT, 4000),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    databaseUrl: env.DATABASE_URL || '',
    corsOrigin: env.CORS_ORIGIN || '*',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    tiktok: oauthApp(env.TIKTOK_CLIENT_KEY, env.TIKTOK_CLIENT_SECRET, env.TIKTOK_REDIRECT_URI),
    instagram: oauthApp(env.INSTAGRAM_APP_ID, env.INSTAGRAM_APP_SECRET, env.INSTAGRAM_REDIRECT_URI),
    authRateLimit: parseNonNegativeInt(env.AUTH_RATE_LIMIT, 30),
    statsTimeZone: parseTimeZone(env.STATS_TIME_ZONE),
    uploadDir: path.resolve(env.UPLOAD_DIR || 'uploads'),
    admin: {
      name: env.ADMIN_NAME || 'Admin',
      email: env.ADMIN_EMAIL || (isProd ? '' : 'admin@shoplink.com'),
      password: env.ADMIN_PASSWORD || (isProd ? '' : 'admin12345'),
    },
  };
}
