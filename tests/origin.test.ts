/** Reproduces the localhost/127.0.0.1 login failure and retains the public-origin CSRF boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsOrigin } from '../src/lib/origin';

test('local aliases on the configured port work; foreign origins remain rejected', () => {
  const local = new URL('http://127.0.0.1:3010');
  for (const origin of ['http://localhost:3010', 'http://127.0.0.1:3010', 'http://[::1]:3010'])
    assert.equal(acceptsOrigin(origin, local), true);
  for (const origin of [
    null,
    'null',
    'http://localhost:3011',
    'https://localhost:3010',
    'https://attacker.invalid',
    'http://localhost.attacker.invalid:3010',
    'http://localhost:3010/path',
  ])
    assert.equal(acceptsOrigin(origin, local), false);
  const production = new URL('https://admin.example.com');
  assert.equal(acceptsOrigin('https://admin.example.com', production), true);
  for (const origin of [
    'http://localhost:3010',
    'http://127.0.0.1:3010',
    'https://other.example.com',
    'http://admin.example.com',
  ])
    assert.equal(acceptsOrigin(origin, production), false);
});
