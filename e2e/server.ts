/** Supervises disposable production servers so browser tests can exercise genuine process restarts. */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workerRoot = process.env.BOT_WORKER_DIR;
const state = await mkdtemp(join(tmpdir(), 'wareongo-e2e-'));
const origin = 'http://127.0.0.1:4310';
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: `file:${state}/bot.db`,
  AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  WORKER_HOST: '127.0.0.1',
  WORKER_PORT: '4311',
  WORKER_API_URL: 'http://127.0.0.1:4311',
  WORKER_API_TOKEN: 'isolated-e2e-worker-token-not-a-real-secret',
  ADMIN_ORIGIN: origin,
  ADMIN_PASSWORD: 'isolated-e2e-admin-password',
  ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
  WHATSAPP_AUTO_CONNECT: 'false',
  LOG_LEVEL: 'silent',
  E2E_STATE_DIR: state,
  RELEASE_SHA: 'e'.repeat(40),
};
delete env.VERCEL; // Local rate limiting must ignore spoofed forwarding headers.
const children = new Set<ChildProcess>();
function run(args: string[], cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    });
  child.on('exit', (code) => {
    children.delete(child);
    if (code && code !== 0 && code !== 143) process.stderr.write(output);
  });
  return child;
}
function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 || code === 143 || signal === 'SIGTERM'
        ? resolve()
        : reject(new Error(`Test process exited: ${code ?? signal}`)),
    );
  });
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = exited(child);
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await done;
  } finally {
    clearTimeout(deadline);
  }
}
async function ready(url: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Test server exited before readiness');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* Wait for the listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server never became ready');
}
let worker: ChildProcess | undefined;
let admin: ChildProcess | undefined;
async function startWorker() {
  worker = workerRoot
    ? run(['--import', 'tsx', 'tests/fixtures/simulated-worker.ts'], workerRoot)
    : run(['--import', 'tsx', 'e2e/fake-worker.ts']);
  await ready('http://127.0.0.1:4311/healthz', worker);
}
async function startAdmin() {
  admin = run([
    join(root, 'node_modules/next/dist/bin/next'),
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    '4310',
  ]);
  await ready(`${origin}/login`, admin);
}
const server = createServer((request, response) => {
  void (async () => {
    if (request.url === '/ready') {
      response.end('ready');
      return;
    }
    if (request.headers.authorization !== 'Bearer isolated-e2e-control') {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/outbound') {
      const data = await readFile(join(state, 'outbound.jsonl'), 'utf8').catch(() => '');
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          data.trim()
            ? data
                .trim()
                .split('\n')
                .map((row) => JSON.parse(row))
            : [],
        ),
      );
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    if (request.url === '/restart-worker') {
      await stop(worker);
      await startWorker();
    } else if (request.url === '/stop-worker') await stop(worker);
    else if (request.url === '/start-worker') await startWorker();
    else if (request.url === '/restart-admin') {
      await stop(admin);
      await startAdmin();
    } else {
      response.writeHead(404).end();
      return;
    }
    response.end('{"ok":true}');
  })().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    response.writeHead(500).end();
  });
});
let shuttingDown = false;
async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.closeAllConnections();
  server.close();
  await Promise.all([...children].map(stop));
  await rm(state, { recursive: true, force: true });
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void cleanup().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
try {
  if (workerRoot)
    await exited(run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], workerRoot));
  await startWorker();
  await startAdmin();
  await new Promise<void>((resolve) => server.listen(4313, '127.0.0.1', resolve));
} catch (error) {
  await cleanup();
  throw error;
}
