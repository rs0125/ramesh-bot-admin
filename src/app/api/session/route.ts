/** Establishes/clears the small admin session; employee CRM auth is a separate future concern. */
import { cookies } from 'next/headers';
import { createHmac } from 'node:crypto';
import { adminConfig } from '../../../server/config';
import { isSameOrigin, privateJson } from '../../../server/auth';
import {
  equalSecret,
  issueSession,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sessionHash,
  verifySession,
} from '../../../lib/session';
import { attemptLogin, registerSession, revokeSession } from '../../../server/worker-client';
import { BodyError, readJson } from '../../../lib/json-body';

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return privateJson({ error: 'Origin rejected' }, 403);
    const { password } = await readJson(request, 2048);
    const config = adminConfig();
    // Vercel overwrites this header. Other hosts share one bucket unless a trusted proxy is added.
    const client =
      process.env.VERCEL === '1'
        ? (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim()
        : 'local';
    const key = createHmac('sha256', config.sessionSecret).update(client).digest('hex');
    const limit = await attemptLogin(key);
    if (!limit.allowed) {
      const response = privateJson({ error: 'Too many attempts. Try again in a minute.' }, 429);
      response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    if (typeof password !== 'string' || !equalSecret(password, config.password)) {
      return privateJson({ error: 'Incorrect password' }, 401);
    }
    const token = issueSession(config.sessionSecret, config.password);
    await registerSession(sessionHash(token), Number(token.split('.')[0]) * 1000);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.origin.protocol === 'https:',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return privateJson({ ok: true });
  } catch (error) {
    if (error instanceof BodyError) return privateJson({ error: error.message }, error.status);
    return privateJson(
      {
        error:
          'Sign-in is temporarily unavailable. Check the admin configuration and worker connection.',
      },
      503,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return privateJson({ error: 'Origin rejected' }, 403);
    const config = adminConfig();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (verifySession(token, config.sessionSecret, config.password))
      await revokeSession(sessionHash(token!));
    (await cookies()).delete(SESSION_COOKIE);
    return privateJson({ ok: true });
  } catch {
    return privateJson({ error: 'Could not sign out' }, 503);
  }
}
