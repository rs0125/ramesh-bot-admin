/** Server-only configuration. Secrets never become props or NEXT_PUBLIC_ variables. */
import 'server-only';

function secret(key: string, minimum = 32): string {
  const value = process.env[key] ?? '';
  if (value.length < minimum)
    throw new Error(`Configure ${key} with at least ${minimum} characters`);
  return value;
}

function origin(value: string, label: string): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(`Invalid ${label}`);
  return url;
}

export function adminConfig() {
  return {
    password: secret('ADMIN_PASSWORD', 16),
    sessionSecret: secret('ADMIN_SESSION_SECRET'),
    origin: origin(process.env.ADMIN_ORIGIN ?? '', 'ADMIN_ORIGIN'),
  };
}

export function workerConfig() {
  return {
    url: origin(process.env.WORKER_API_URL ?? '', 'WORKER_API_URL'),
    token: secret('WORKER_API_TOKEN'),
  };
}
