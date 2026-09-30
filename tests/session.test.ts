/** Cookie tests verify authorization boundaries without starting Next.js or a worker. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { issueSession, verifySession, SESSION_SECONDS } from '../src/lib/session.js';

test('admin sessions reject tampering, expiry, wrong secrets, and rotated passwords', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const secret = 'synthetic-secret';
  const password = 'synthetic-password';
  const token = issueSession(secret, password, now);
  assert.equal(verifySession(token, secret, password, now), true);
  assert.equal(verifySession(`${token}x`, secret, password, now), false);
  assert.equal(verifySession(token, 'other-secret', password, now), false);
  assert.equal(verifySession(token, secret, 'new-password', now), false);
  assert.equal(verifySession(token, secret, password, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifySession(undefined, secret, password, now), false);
});
