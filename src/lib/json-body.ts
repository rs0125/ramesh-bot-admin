/** Bounded request reader shared by public login and authenticated control routes. */
export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readJson(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    throw new BodyError(415, 'Expected JSON');
  if (Number(request.headers.get('content-length')) > limit)
    throw new BodyError(413, 'Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, 'Invalid request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyError(408, 'Request timed out')), 5000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new BodyError(413, 'Request too large');
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new BodyError(400, 'Invalid request');
    return data as Record<string, unknown>;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, 'Invalid request');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
