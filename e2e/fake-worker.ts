/** Standalone admin CI fixture: HTTP contract without Baileys, Prisma, or a sibling checkout. */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotStatus, InboxMessage } from '../src/lib/worker-api';

const directory = process.env.E2E_STATE_DIR;
if (!directory?.includes('wareongo-e2e-')) throw new Error('Missing isolated test state');
const path = join(directory, 'fixture.json');
type State = {
  enabled: boolean;
  paired: boolean;
  sessions: Record<string, number>;
  attempts: number;
  resets: number;
  messages?: InboxMessage[];
};
const saved: State = await readFile(path, 'utf8')
  .then((data) => JSON.parse(data) as State)
  .catch(() => ({ enabled: false, paired: false, sessions: {}, attempts: 0, resets: 0 }));
const group = '123456@g.us';
const direct = '20000000000@s.whatsapp.net';
saved.messages ??= [
  {
    id: '11111111-1111-4111-8111-111111111111',
    chatId: group,
    text: 'The site visit is tomorrow at 10.',
    senderId: 'alice@lid',
    senderName: 'Alice',
    direction: 'inbound',
    source: 'whatsapp',
    mentionsBot: false,
    at: new Date(Date.now() - 30000).toISOString(),
    status: 'RECEIVED',
    kind: 'text',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    chatId: group,
    text: '@Ramesh can you confirm the visit?',
    senderId: 'bob@lid',
    senderName: 'Bob',
    direction: 'inbound',
    source: 'whatsapp',
    mentionsBot: true,
    at: new Date(Date.now() - 20000).toISOString(),
    status: 'RECEIVED',
    kind: 'text',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    chatId: direct,
    text: 'Can we arrange a call?',
    senderId: direct,
    senderName: 'Kavya',
    direction: 'inbound',
    source: 'whatsapp',
    mentionsBot: false,
    at: new Date(Date.now() - 10000).toISOString(),
    status: 'RECEIVED',
    kind: 'text',
  },
];
let writes = Promise.resolve();
const persist = () => {
  const data = JSON.stringify(saved);
  return (writes = writes.then(() => writeFile(path, data)));
};
const status: BotStatus = {
  state: 'stopped',
  qr: null,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  metrics: { received: 0, replied: 0, duplicates: 0, errors: 0, dropped: 0 },
  events: [],
};
function update() {
  status.state = saved.enabled ? (saved.paired ? 'connected' : 'pairing') : 'stopped';
  status.qr =
    status.state === 'pairing' ? 'synthetic-local-test-qr-never-valid-for-whatsapp' : null;
}
update();
const servers = [4311, 4312].map((port) =>
  createServer((request, response) => {
    void (async () => {
      response.setHeader('Content-Type', 'application/json');
      const send = (data: unknown) => response.end(JSON.stringify(data));
      if (request.url === '/healthz') {
        send({ status: 'ok', release: 'e'.repeat(40) });
        return;
      }
      const expected = port === 4312 ? 'isolated-e2e-control' : process.env.WORKER_API_TOKEN;
      if (request.headers.authorization !== `Bearer ${expected}`) {
        response.writeHead(401);
        send({ error: 'Unauthorized' });
        return;
      }
      let raw = '';
      for await (const chunk of request) {
        raw += String(chunk);
        if (raw.length > 32_768) throw new Error('Large fixture request');
      }
      const body = raw ? (JSON.parse(raw) as Record<string, string | number>) : {};
      const url = new URL(request.url ?? '/', 'http://fixture');
      if (port === 4312 && body.action === 'pair') {
        saved.paired = true;
        update();
        await persist();
        send({ ok: true });
      } else if (url.pathname === '/v1/inbox/conversations') {
        send({
          conversations: [group, direct].map((chatId) => {
            const latest = saved.messages!.filter((item) => item.chatId === chatId).at(-1)!;
            return {
              chatId,
              name: chatId === group ? 'Site visits' : 'Kavya',
              isGroup: chatId === group,
              lastMessage: latest.text.slice(0, 200),
              lastMessageAt: latest.at,
            };
          }),
          nextCursor: null,
          groupRepliesRequireMention: true,
        });
      } else if (url.pathname === '/v1/inbox/messages') {
        send({
          messages: saved.messages!.filter(
            (item) => item.chatId === url.searchParams.get('chatId'),
          ),
          nextCursor: null,
        });
      } else if (url.pathname === '/v1/inbox/send') {
        if (status.state !== 'connected') {
          response.writeHead(409);
          send({ error: 'Connect WhatsApp before sending' });
          return;
        }
        if (![group, direct].includes(String(body.chatId))) {
          response.writeHead(404);
          send({ error: 'Conversation not found' });
          return;
        }
        const id = `${body.requestId}:reply`;
        const duplicate = saved.messages!.some((item) => item.id === id);
        if (!duplicate)
          saved.messages!.push({
            id,
            chatId: String(body.chatId),
            text: String(body.text),
            senderId: null,
            senderName: 'Ramesh',
            direction: 'outbound',
            source: 'admin',
            mentionsBot: false,
            at: new Date().toISOString(),
            status: 'SENT',
            kind: 'text',
          });
        await persist();
        response.writeHead(202);
        send({ requestId: body.requestId, status: duplicate ? 'duplicate' : 'queued' });
      } else if (request.url === '/v1/status') send(status);
      else if (request.url === '/v1/control') {
        saved.enabled = body.action !== 'disconnect';
        update();
        await persist();
        send(status);
      } else if (request.url === '/v1/admin/session') {
        const hash = String(body.tokenHash);
        if (body.action === 'create') saved.sessions[hash] = Number(body.expiresAt);
        if (body.action === 'revoke') delete saved.sessions[hash];
        await persist();
        send(
          body.action === 'verify'
            ? { active: (saved.sessions[hash] ?? 0) > Date.now() }
            : { ok: true },
        );
      } else if (request.url === '/v1/admin/attempt') {
        if (saved.resets <= Date.now()) {
          saved.attempts = 0;
          saved.resets = Date.now() + 60_000;
        }
        saved.attempts++;
        await persist();
        send({
          allowed: saved.attempts <= 10,
          retryAfter: Math.max(1, Math.ceil((saved.resets - Date.now()) / 1000)),
        });
      } else {
        response.writeHead(404);
        send({ error: 'Not found' });
      }
    })().catch(() => {
      response.writeHead(500).end();
    });
  }).listen(port, '127.0.0.1'),
);
process.on('SIGTERM', () => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});
