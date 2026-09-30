/** Request boundary regressions include chunked UTF-8 and bodies without Content-Length. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readJson } from '../src/lib/json-body';

test('streamed JSON is counted in bytes and malformed bodies are rejected', async () => {
  const bytes = Buffer.from(JSON.stringify({ password: 'नमस्ते' }));
  const streamed = (limit: number) =>
    readJson(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        duplex: 'half',
        body: new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      } as RequestInit),
      limit,
    );
  assert.deepEqual(await streamed(100), { password: 'नमस्ते' });
  await assert.rejects(streamed(20), { status: 413 });
  for (const body of ['null', '[]', '{invalid']) {
    await assert.rejects(
      readJson(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        100,
      ),
      { status: 400 },
    );
  }
  await assert.rejects(
    readJson(new Request('http://localhost', { method: 'POST', body: '{}' }), 100),
    { status: 415 },
  );
});
