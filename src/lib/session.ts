/** Framework-independent signing helpers; session tokens carry only an expiry and nonce. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE = 'wog_bot_admin';

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function equalSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

function signature(payload: string, secret: string, password: string): string {
  // Password rotation invalidates every cookie, including those still in the session store.
  return createHmac('sha256', secret)
    .update(password)
    .update('\0')
    .update(payload)
    .digest('base64url');
}

export function issueSession(secret: string, password: string, now = Date.now()): string {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(18).toString('base64url')}`;
  return `${payload}.${signature(payload, secret, password)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  password: string,
  now = Date.now(),
): boolean {
  if (!token || token.length > 200) return false;
  const [expiry, nonce, mac, extra] = token.split('.');
  if (
    !expiry ||
    !/^\d+$/.test(expiry) ||
    !nonce ||
    !/^[A-Za-z0-9_-]{24}$/.test(nonce) ||
    !mac ||
    extra !== undefined
  )
    return false;
  const expiresAt = Number(expiry);
  const current = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= current ||
    expiresAt > current + SESSION_SECONDS
  )
    return false;
  return equalSecret(mac, signature(`${expiry}.${nonce}`, secret, password));
}
