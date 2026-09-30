/** Accepts only named session controls, never an arbitrary URL, command, or recipient. */
import type { BotAction } from '../../../../lib/worker-api';
import { isAdmin, isSameOrigin, privateJson } from '../../../../server/auth';
import { requestWorker } from '../../../../server/worker-client';
import { BodyError, readJson } from '../../../../lib/json-body';

export async function POST(request: Request) {
  try {
    if (!(await isAdmin())) return privateJson({ error: 'Sign in to continue' }, 401);
    if (!isSameOrigin(request)) return privateJson({ error: 'Origin rejected' }, 403);
    const { action } = await readJson(request, 1024);
    if (action !== 'connect' && action !== 'disconnect' && action !== 'reconnect')
      return privateJson({ error: 'Invalid action' }, 400);
    return privateJson(await requestWorker(action as BotAction));
  } catch (error) {
    if (error instanceof BodyError) return privateJson({ error: error.message }, error.status);
    return privateJson(
      {
        error:
          'The worker could not complete that action. Check its current status before retrying.',
      },
      503,
    );
  }
}
