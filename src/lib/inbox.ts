/** Validates bounded inbox contracts before worker data is exposed to the browser. */
import type { ConversationPage, InboxPage } from './worker-api';

export function validChatId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    /^[\w.-]+@(g\.us|s\.whatsapp\.net|lid)$/.test(value)
  );
}
export function validCursor(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^[\w-]{1,256}$/.test(value));
}
export function validSend(
  body: Record<string, unknown>,
): body is { chatId: string; text: string; requestId: string } {
  return (
    validChatId(body.chatId) &&
    typeof body.text === 'string' &&
    body.text.trim().length > 0 &&
    body.text.trim().length <= 4000 &&
    typeof body.requestId === 'string' &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.requestId)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function conversationPage(data: Record<string, unknown>): ConversationPage {
  if (
    !validCursor(data.nextCursor) ||
    typeof data.groupRepliesRequireMention !== 'boolean' ||
    !Array.isArray(data.conversations) ||
    data.conversations.length > 50 ||
    !data.conversations.every(
      (item) =>
        record(item) &&
        validChatId(item.chatId) &&
        typeof item.name === 'string' &&
        item.name.length <= 512 &&
        typeof item.isGroup === 'boolean' &&
        typeof item.lastMessage === 'string' &&
        item.lastMessage.length <= 200 &&
        date(item.lastMessageAt),
    )
  )
    throw new Error('Invalid worker inbox');
  return data as unknown as ConversationPage;
}
export function inboxPage(data: Record<string, unknown>): InboxPage {
  if (
    !validCursor(data.nextCursor) ||
    !Array.isArray(data.messages) ||
    data.messages.length > 50 ||
    !data.messages.every(
      (item) =>
        record(item) &&
        typeof item.id === 'string' &&
        item.id.length <= 64 &&
        validChatId(item.chatId) &&
        typeof item.text === 'string' &&
        item.text.length <= 262144 &&
        (item.senderId === null || typeof item.senderId === 'string') &&
        typeof item.senderName === 'string' &&
        ['inbound', 'outbound'].includes(String(item.direction)) &&
        ['whatsapp', 'assistant', 'admin'].includes(String(item.source)) &&
        typeof item.mentionsBot === 'boolean' &&
        date(item.at) &&
        typeof item.kind === 'string' &&
        ['RECEIVED', 'READY_TO_SEND', 'SENDING', 'SENT', 'EXPIRED', 'FAILED', 'UNCERTAIN'].includes(
          String(item.status),
        ),
    )
  )
    throw new Error('Invalid worker messages');
  return data as unknown as InboxPage;
}
