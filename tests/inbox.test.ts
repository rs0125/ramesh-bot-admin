import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPage, inboxPage, validSend } from '../src/lib/inbox';

test('send input rejects arbitrary destinations, empty/oversized text and absent idempotency keys', () => {
  const body = {
    chatId: '123456@g.us',
    text: 'Hello team',
    requestId: '11111111-1111-4111-8111-111111111111',
  };
  assert.equal(validSend(body), true);
  for (const patch of [
    { chatId: 'https://example.com' },
    { chatId: 'status@broadcast' },
    { text: ' ' },
    { text: 'x'.repeat(4001) },
    { requestId: '' },
  ])
    assert.equal(validSend({ ...body, ...patch }), false);
});
test('malformed inbox responses and unbounded pages fail before reaching the browser', () => {
  assert.throws(() => inboxPage({ messages: [{ text: 'incomplete' }], nextCursor: null }));
  assert.throws(() => conversationPage({ conversations: [], nextCursor: null }));
  assert.throws(() => inboxPage({ messages: [], nextCursor: 'invalid/cursor' }));
  assert.deepEqual(inboxPage({ messages: [], nextCursor: null }), {
    messages: [],
    nextCursor: null,
  });
});
