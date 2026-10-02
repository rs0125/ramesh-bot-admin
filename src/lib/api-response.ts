/** Keeps proxy/network failures readable while preserving explicit API recovery messages. */
export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => {
    throw new Error(fallback);
  });
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : fallback);
  return data as T;
}

export function requestError(error: unknown, fallback: string) {
  return error instanceof Error && !(error instanceof TypeError) && error.name !== 'TimeoutError'
    ? error.message
    : fallback;
}
