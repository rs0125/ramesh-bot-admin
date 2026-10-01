/** Fixed-route server-to-server client. Credentials and session hashes stay on the servers. */
import 'server-only';
import type { BotAction, BotStatus } from '../lib/worker-api';
import { workerConfig } from './config';
import { conversationPage, inboxPage } from '../lib/inbox';

export class WorkerRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(
  path:
    | '/v1/status'
    | '/v1/control'
    | '/v1/admin/attempt'
    | '/v1/admin/session'
    | '/v1/inbox/conversations'
    | '/v1/inbox/messages'
    | '/v1/inbox/send',
  body?: Record<string, unknown>,
  query?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const config = workerConfig();
  const url = new URL(path, config.url);
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Worker returned no data');
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (response.ok && path.startsWith('/v1/inbox/') ? 16_777_216 : 65_536))
        throw new Error('Worker response too large');
      parts.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid worker response');
    if (!response.ok) {
      const error = (data as Record<string, unknown>).error;
      if (
        path.startsWith('/v1/inbox/') &&
        typeof error === 'string' &&
        error.length <= 256 &&
        [400, 404, 409, 429, 503].includes(response.status)
      )
        throw new WorkerRequestError(response.status, error);
      throw new Error('Worker unavailable');
    }
    return data as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestConversations(cursor: string | null) {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  return conversationPage(await request('/v1/inbox/conversations', undefined, query));
}
export async function requestMessages(chatId: string, cursor: string | null) {
  const query = new URLSearchParams({ chatId });
  if (cursor) query.set('cursor', cursor);
  return inboxPage(await request('/v1/inbox/messages', undefined, query));
}
export async function sendMessage(body: { chatId: string; text: string; requestId: string }) {
  const data = await request('/v1/inbox/send', body);
  if (data.requestId !== body.requestId || !['queued', 'duplicate'].includes(String(data.status)))
    throw new Error('Invalid send response');
  return { requestId: body.requestId, status: String(data.status) };
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
