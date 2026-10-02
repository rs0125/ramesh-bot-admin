/** Authenticated inbox reads and same-origin sends, proxied with server-only worker credentials. */
import { isAdmin, isSameOrigin, privateJson } from '../../../../server/auth';
import {
  requestConversations,
  requestMessages,
  sendMessage,
  WorkerRequestError,
} from '../../../../server/worker-client';
import { validChatId, validCursor, validSend } from '../../../../lib/inbox';
import { BodyError, readJson } from '../../../../lib/json-body';

function failure(error: unknown, fallback: string) {
  if (error instanceof BodyError || error instanceof WorkerRequestError)
    return privateJson({ error: error.message }, error.status);
  return privateJson({ error: fallback }, 503);
}
export async function GET(request: Request) {
  try {
    if (!(await isAdmin())) return privateJson({ error: 'Sign in to continue' }, 401);
    const query = new URL(request.url).searchParams;
    const cursor = query.get('cursor');
    const chatId = query.get('chatId');
    if (!validCursor(cursor) || (chatId !== null && !validChatId(chatId)))
      return privateJson({ error: 'Invalid conversation or cursor' }, 400);
    return privateJson(
      chatId ? await requestMessages(chatId, cursor) : await requestConversations(cursor),
    );
  } catch (error) {
    return failure(error, 'Could not load the inbox. Try again, or contact your administrator.');
  }
}
export async function POST(request: Request) {
  try {
    if (!(await isAdmin())) return privateJson({ error: 'Sign in to continue' }, 401);
    if (!isSameOrigin(request)) return privateJson({ error: 'Origin rejected' }, 403);
    const body = await readJson(request, 24576);
    if (!validSend(body))
      return privateJson({ error: 'Choose a conversation and enter 1–4000 characters' }, 400);
    return privateJson(await sendMessage({ ...body, text: body.text.trim() }), 202);
  } catch (error) {
    return failure(error, 'Could not confirm whether the message was sent.');
  }
}
