import { ApiError } from '../common/api-error';

// "Log in with TikTok / Instagram" (OAuth 2.0 authorization code flow):
// 1. The frontend sends the user to authorizeUrl(...) (GET /api/auth/<provider>/url gives it).
// 2. The provider sends them back to the redirect URI with ?code=...&state=...
// 3. The frontend checks `state` and POSTs the code here; we swap it for the user's profile.

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SocialProfile {
  /** The provider's id for this user (TikTok open_id, Instagram app-scoped id). */
  id: string;
  name: string;
  username: string | null;
}

export type OAuthProvider = 'tiktok' | 'instagram';

export const PROVIDER_NAMES: Record<OAuthProvider, string> = { tiktok: 'TikTok', instagram: 'Instagram' };

const INSTAGRAM_GRAPH = 'https://graph.instagram.com/v26.0';

async function call(provider: OAuthProvider, url: string, init?: RequestInit): Promise<{ ok: boolean; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ApiError(502, `Could not reach ${PROVIDER_NAMES[provider]}, please try again`);
  }
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

const rejected = (provider: OAuthProvider) => new ApiError(401, `Invalid or expired ${PROVIDER_NAMES[provider]} code`);
const badResponse = (provider: OAuthProvider) => new ApiError(502, `Unexpected response from ${PROVIDER_NAMES[provider]}`);

export function authorizeUrl(provider: OAuthProvider, app: OAuthApp, state?: string): string {
  const url =
    provider === 'tiktok'
      ? new URL('https://www.tiktok.com/v2/auth/authorize/')
      : new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set(provider === 'tiktok' ? 'client_key' : 'client_id', app.clientId);
  url.searchParams.set('response_type', 'code');
  // TikTok: username needs user.info.profile, which your app must have approved in the TikTok portal.
  url.searchParams.set('scope', provider === 'tiktok' ? 'user.info.basic,user.info.profile' : 'instagram_business_basic');
  url.searchParams.set('redirect_uri', app.redirectUri);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** https://developers.tiktok.com/doc/oauth-user-access-token-management + /doc/tiktok-api-v2-get-user-info */
async function tiktokProfile(app: OAuthApp, code: string): Promise<SocialProfile> {
  const token = await call('tiktok', 'https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: app.redirectUri,
    }),
  });
  const accessToken = token.body?.access_token;
  if (!token.ok || typeof accessToken !== 'string') throw rejected('tiktok');

  // Asking for a field whose scope wasn't granted fails the whole request, so only ask for username if allowed.
  const scopes = String(token.body.scope ?? '').split(',');
  const fields = ['open_id', 'display_name', ...(scopes.includes('user.info.profile') ? ['username'] : [])];
  const info = await call('tiktok', `https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(',')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = info.body?.data?.user;
  if (!info.ok || typeof user?.open_id !== 'string' || !user.open_id) throw badResponse('tiktok');
  const username = typeof user.username === 'string' && user.username ? user.username : null;
  return { id: user.open_id, name: user.display_name || username || 'TikTok user', username };
}

/**
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 * Works only for professional (Business / Creator) Instagram accounts.
 */
async function instagramProfile(app: OAuthApp, code: string): Promise<SocialProfile> {
  const token = await call('instagram', 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: app.redirectUri,
      code: code.replace(/#_$/, ''), // Instagram appends "#_" to the code in the redirect
    }),
  });
  // The docs show the token inside data[0]; the live API returns it at the top level.
  const accessToken = (token.body?.data?.[0] ?? token.body)?.access_token;
  if (!token.ok || typeof accessToken !== 'string') throw rejected('instagram');

  // `id` comes back as a string. (user_id in the token response is a JSON number too big for JavaScript.)
  const me = await call('instagram', `${INSTAGRAM_GRAPH}/me?fields=id,username,name&access_token=${encodeURIComponent(accessToken)}`);
  const user = me.body?.data?.[0] ?? me.body;
  if (!me.ok || typeof user?.id !== 'string' || !user.id) throw badResponse('instagram');
  const username = typeof user.username === 'string' && user.username ? user.username : null;
  return { id: user.id, name: user.name || username || 'Instagram user', username };
}

export function fetchProfile(provider: OAuthProvider, app: OAuthApp, code: string): Promise<SocialProfile> {
  return provider === 'tiktok' ? tiktokProfile(app, code) : instagramProfile(app, code);
}
