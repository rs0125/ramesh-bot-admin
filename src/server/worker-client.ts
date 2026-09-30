/** Fixed-route server-to-server client. Credentials and session hashes stay on the servers. */
import 'server-only';
import type { BotAction, BotStatus } from '../lib/worker-api';
import { workerConfig } from './config';

async function request(
  path: '/v1/status' | '/v1/control' | '/v1/admin/attempt' | '/v1/admin/session',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = workerConfig();
  const response = await fetch(new URL(path, config.url), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Worker unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Worker returned no data');
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error('Worker response too large');
      parts.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid worker response');
    return data as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestWorker(action?: BotAction): Promise<BotStatus> {
  const data = await request(
    action ? '/v1/control' : '/v1/status',
    action ? { action } : undefined,
  );
  const states = [
    'stopped',
    'connecting',
    'pairing',
    'connected',
    'reconnecting',
    'disconnecting',
    'error',
  ];
  const metrics = data.metrics as Record<string, unknown> | undefined;
  if (
    !states.includes(String(data.state)) ||
    !(data.qr === null || typeof data.qr === 'string') ||
    typeof data.updatedAt !== 'string' ||
    typeof data.startedAt !== 'string' ||
    !metrics ||
    !['received', 'replied', 'duplicates', 'errors', 'dropped'].every(
      (key) => Number.isSafeInteger(metrics[key]) && Number(metrics[key]) >= 0,
    ) ||
    !Array.isArray(data.events) ||
    data.events.length > 30 ||
    !data.events.every((event: unknown) => {
      if (!event || typeof event !== 'object') return false;
      const e = event as Record<string, unknown>;
      return (
        typeof e.at === 'string' &&
        typeof e.message === 'string' &&
        e.message.length <= 256 &&
        (e.level === 'info' || e.level === 'error')
      );
    })
  )
    throw new Error('Invalid worker status');
  return data as unknown as BotStatus;
}

export async function attemptLogin(key: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const data = await request('/v1/admin/attempt', { key });
  if (
    typeof data.allowed !== 'boolean' ||
    !Number.isSafeInteger(data.retryAfter) ||
    Number(data.retryAfter) < 1
  )
    throw new Error('Invalid login limit');
  return { allowed: data.allowed, retryAfter: Number(data.retryAfter) };
}

export async function registerSession(tokenHash: string, expiresAt: number): Promise<void> {
  if ((await request('/v1/admin/session', { action: 'create', tokenHash, expiresAt })).ok !== true)
    throw new Error('Could not register session');
}

export async function activeSession(tokenHash: string): Promise<boolean> {
  return (await request('/v1/admin/session', { action: 'verify', tokenHash })).active === true;
}

export async function revokeSession(tokenHash: string): Promise<void> {
  if ((await request('/v1/admin/session', { action: 'revoke', tokenHash })).ok !== true)
    throw new Error('Could not revoke session');
}
