/** Accepts loopback aliases for local HTTP; public deployments require the exact configured origin. */
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export function acceptsOrigin(value: string | null, expected: URL): boolean {
  if (value === expected.origin) return true;
  if (!value || expected.protocol !== 'http:' || !loopback.has(expected.hostname)) return false;
  try {
    const actual = new URL(value);
    return (
      actual.origin === value &&
      actual.protocol === 'http:' &&
      loopback.has(actual.hostname) &&
      actual.port === expected.port
    );
  } catch {
    return false;
  }
}
