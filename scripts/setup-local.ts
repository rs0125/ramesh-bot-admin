/** Generates local admin secrets independently; an operator supplies the worker's API token. */
import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const path = new URL('../.env.local', import.meta.url);
let text: string;
try {
  text = await readFile(path, 'utf8');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  text = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
}
const current = parse(text);
for (const key of ['ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET']) {
  if (current[key]) continue;
  const line = `${key}="${randomBytes(32).toString('base64url')}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}
await writeFile(path, text, { mode: 0o600 });
await chmod(path, 0o600);
console.log(
  'Admin .env.local ready. Set WORKER_API_TOKEN to match your worker; no secrets were printed.',
);
