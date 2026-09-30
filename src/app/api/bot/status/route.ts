/** Authenticated, uncached proxy for connection status and the current pairing QR. */
import { isAdmin, privateJson } from '../../../../server/auth';
import { requestWorker } from '../../../../server/worker-client';

export async function GET() {
  try {
    if (!(await isAdmin())) return privateJson({ error: 'Sign in to continue' }, 401);
    return privateJson(await requestWorker());
  } catch {
    return privateJson(
      {
        error:
          'The bot worker is unreachable. Check that it is running and its API settings match.',
      },
      503,
    );
  }
}
