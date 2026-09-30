/** Next.js cookie and CSRF boundary, shared by pages and every administrative API route. */
import 'server-only';
import { cookies } from 'next/headers';
import { adminConfig } from './config';
import { SESSION_COOKIE, sessionHash, verifySession } from '../lib/session';
import { activeSession } from './worker-client';
import { acceptsOrigin } from '../lib/origin';

export async function isAdmin(): Promise<boolean> {
  const config = adminConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySession(token, config.sessionSecret, config.password)) return false;
  return activeSession(sessionHash(token!));
}

export function isSameOrigin(request: Request): boolean {
  return acceptsOrigin(request.headers.get('origin'), adminConfig().origin);
}

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
