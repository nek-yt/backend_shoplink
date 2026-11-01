import crypto from 'crypto';

/** Uploaded files are served under this path (see app.ts). */
export const UPLOADS_PATH = '/api/uploads';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** How many extra pictures a product can have (besides the main imageUrl). */
export const MAX_PRODUCT_IMAGES = 10;
export const DEFAULT_PRODUCT_IMAGE = '/api/images/product.svg';

/**
 * The real type of an uploaded image, read from its first bytes (the name and Content-Type the browser
 * sends can't be trusted). SVG is not accepted: it can contain scripts.
 */
export function detectImage(buf: Buffer): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function defaultAvatarUrl(user: { id: number; name: string }): string {
  return `/api/images/avatar.svg?name=${encodeURIComponent(user.name)}&id=${user.id}`;
}

const AVATAR_COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae'];

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A colored circle with the user's initials, like Gmail. The same id always gets the same color. */
export function avatarSvg(name: string, seed: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1))
    .map((w) => [...w][0]?.toLocaleUpperCase() ?? '')
    .join('') || '?';
  const color = AVATAR_COLORS[crypto.createHash('md5').update(seed || name).digest()[0] % AVATAR_COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<circle cx="64" cy="64" r="64" fill="${color}"/>
<text x="64" y="64" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="600" fill="#fff">${escapeXml(letters)}</text>
</svg>`;
}

/** Gray "no photo" picture for products without an image. */
export const PRODUCT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#eef0f3"/>
<g fill="none" stroke="#b4bac4" stroke-width="10" stroke-linejoin="round">
<rect x="110" y="120" width="180" height="150" rx="14"/>
<path d="M120 255l55-60 40 42 25-26 45 44"/>
</g>
<circle cx="245" cy="165" r="16" fill="#b4bac4"/>
<text x="200" y="320" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#9aa1ac">No image</text>
</svg>`;
