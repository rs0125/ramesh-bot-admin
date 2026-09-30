/** Standalone admin CI fixture: HTTP contract without Baileys, Prisma, or a sibling checkout. */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotStatus } from '../src/lib/worker-api';

const directory = process.env.E2E_STATE_DIR;
if (!directory?.includes('wareongo-e2e-')) throw new Error('Missing isolated test state');
const path = join(directory, 'fixture.json');
type State = {
  enabled: boolean;
  paired: boolean;
  sessions: Record<string, number>;
  attempts: number;
  resets: number;
};
const saved: State = await readFile(path, 'utf8')
  .then((data) => JSON.parse(data) as State)
  .catch(() => ({ enabled: false, paired: false, sessions: {}, attempts: 0, resets: 0 }));
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
      if (port === 4312 && body.action === 'pair') {
        saved.paired = true;
        update();
        await persist();
        send({ ok: true });
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
