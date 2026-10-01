'use client';
/** Polls saved conversations and keeps per-chat drafts and idempotent send requests in memory. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, ConversationPage, InboxMessage, InboxPage } from '../lib/worker-api';

type Draft = { text: string; pending?: { requestId: string; text: string } };
const delivery: Record<string, string> = {
  READY_TO_SEND: 'Queued',
  SENDING: 'Sending…',
  SENT: 'Sent to WhatsApp',
  FAILED: 'Failed',
  EXPIRED: 'Expired before sending',
  UNCERTAIN: 'Delivery uncertain',
};
const stamp = (at: string) =>
  new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Inbox({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [requireMention, setRequireMention] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const paging = useRef(false);
  const paged = useRef(false);

  const receive = useCallback(
    async <T,>(response: Response): Promise<T> => {
      if (response.status === 401) {
        router.replace('/login');
        throw new Error('Sign in to continue');
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Inbox unavailable');
      return data as T;
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (paging.current) return;
        const data: ConversationPage = await receive(
          await fetch('/api/bot/inbox', {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          }),
        );
        if (controller.signal.aborted) return;
        setConversations((previous) => [
          ...data.conversations,
          ...previous.filter(
            (item) => !data.conversations.some((next) => next.chatId === item.chatId),
          ),
        ]);
        if (!paged.current) setCursor(data.nextCursor);
        setRequireMention(data.groupRepliesRequireMention);
        setLoaded(true);
        setError('');
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Inbox unavailable');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [receive]);

  async function more() {
    if (!cursor || paging.current) return;
    paging.current = true;
    setMoreBusy(true);
    try {
      const data: ConversationPage = await receive(
        await fetch(`/api/bot/inbox?${new URLSearchParams({ cursor })}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        }),
      );
      setConversations((previous) => [
        ...previous,
        ...data.conversations.filter((item) => !previous.some((old) => old.chatId === item.chatId)),
      ]);
      paged.current = true;
      setCursor(data.nextCursor);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load conversations');
    } finally {
      paging.current = false;
      setMoreBusy(false);
    }
  }
  const visible = conversations.filter(
    (item) =>
      (filter === 'all' || item.isGroup === (filter === 'groups')) &&
      `${item.name} ${item.chatId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = conversations.find((item) => item.chatId === selectedId);
  const updateDraft = useCallback((chatId: string, update: (value: Draft) => Draft) => {
    setDrafts((previous) => ({ ...previous, [chatId]: update(previous[chatId] ?? { text: '' }) }));
  }, []);

  return (
    <section className="panel inbox-panel" id="inbox" aria-label="Ramesh inbox">
      <div className="panel-heading">
        <div>
          <h2>Ramesh’s inbox</h2>
          <p className="muted">Direct messages, group conversations, and replies in one place.</p>
        </div>
        <span className="inbox-policy">
          {requireMention ? 'Group replies on mention' : 'Replies to all group messages'}
        </span>
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          {error}
        </div>
      )}
      <div className="inbox-layout">
        <div className="conversation-sidebar">
          <div className="inbox-search">
            <label className="sr-only" htmlFor="inbox-search">
              Search conversations
            </label>
            <input
              id="inbox-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations…"
            />
            <div className="inbox-filters" aria-label="Conversation type">
              {[
                ['all', 'All'],
                ['groups', 'Groups'],
                ['direct', 'Direct'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value!)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="conversation-list" aria-label="Conversations">
            {visible.map((item) => (
              <button
                className={`conversation-item ${selectedId === item.chatId ? 'selected' : ''}`}
                key={item.chatId}
                aria-pressed={selectedId === item.chatId}
                onClick={() => setSelectedId(item.chatId)}
              >
                <span className={`conversation-avatar ${item.isGroup ? 'group' : ''}`}>
                  {item.isGroup ? '#' : item.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="conversation-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.isGroup ? 'Group' : 'Direct message'} · {stamp(item.lastMessageAt)}
                  </small>
                  <span>{item.lastMessage}</span>
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="inbox-placeholder">
                {!loaded
                  ? 'Loading conversations…'
                  : search || filter !== 'all'
                    ? 'No matching conversations.'
                    : 'New conversations will appear here when Ramesh receives a message.'}
              </p>
            )}
            {cursor && (
              <button
                className="button secondary load-more"
                disabled={moreBusy}
                onClick={() => void more()}
              >
                {moreBusy ? 'Loading…' : 'More conversations'}
              </button>
            )}
          </div>
        </div>
        {selected ? (
          <ConversationThread
            key={selected.chatId}
            conversation={selected}
            connected={connected}
            draft={drafts[selected.chatId] ?? { text: '' }}
            updateDraft={updateDraft}
            receive={receive}
          />
        ) : (
          <div className="thread-empty">
            <span>↗</span>
            <h3>Open a conversation</h3>
            <p>Read messages and send a reply as Ramesh.</p>
            <p>All group messages are saved. Tagged messages are highlighted.</p>
          </div>
        )}
      </div>
      <div className="inbox-footnote">
        History is kept for 30 days and supplies Ramesh’s recent conversation context. Messages
        received before history was enabled may be unavailable.
      </div>
    </section>
  );
}

function ConversationThread({
  conversation,
  connected,
  draft,
  updateDraft,
  receive,
}: {
  conversation: Conversation;
  connected: boolean;
  draft: Draft;
  updateDraft: (chatId: string, update: (value: Draft) => Draft) => void;
  receive: <T>(response: Response) => Promise<T>;
}) {
  const { chatId } = conversation;
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const sendLock = useRef(false);
  const paging = useRef(false);
  const paged = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (paging.current) return;
        const data: InboxPage = await receive(
          await fetch(`/api/bot/inbox?${new URLSearchParams({ chatId })}`, {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          }),
        );
        if (controller.signal.aborted) return;
        setMessages((previous) => mergeMessages(previous, data.messages));
        if (!paged.current) setCursor(data.nextCursor);
        setLoaded(true);
        setError('');
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Could not load messages');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [chatId, receive, refresh]);

  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    if (draft.pending && messages.some((item) => item.id === `${draft.pending!.requestId}:reply`)) {
      const id = draft.pending.requestId;
      updateDraft(chatId, (current) =>
        current.pending?.requestId === id ? { text: '' } : current,
      );
      setSendError('');
      setNotice('Message saved. Its send status appears in the conversation.');
    }
  }, [messages, chatId, draft.pending, updateDraft]);

  async function older() {
    if (!cursor || paging.current) return;
    paging.current = true;
    setMoreBusy(true);
    follow.current = false;
    try {
      const data: InboxPage = await receive(
        await fetch(`/api/bot/inbox?${new URLSearchParams({ chatId, cursor })}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        }),
      );
      const previousHeight = scroll.current?.scrollHeight ?? 0;
      setMessages((previous) => mergeMessages(data.messages, previous));
      setCursor(data.nextCursor);
      paged.current = true;
      setError('');
      requestAnimationFrame(() => {
        if (scroll.current)
          scroll.current.scrollTop += scroll.current.scrollHeight - previousHeight;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load older messages');
    } finally {
      paging.current = false;
      setMoreBusy(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sendLock.current || !connected || !draft.text.trim()) return;
    sendLock.current = true;
    setSending(true);
    setSendError('');
    setNotice('');
    const pending = draft.pending ?? { requestId: crypto.randomUUID(), text: draft.text.trim() };
    updateDraft(chatId, (current) => ({ ...current, pending }));
    try {
      const response = await fetch('/api/bot/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, ...pending }),
        signal: AbortSignal.timeout(20000),
      });
      // Definite rejections did not enqueue anything; a timeout/503 retains the same request ID.
      if ([400, 401, 403, 404, 409, 413, 415, 429].includes(response.status))
        updateDraft(chatId, (current) => ({ text: current.text }));
      await receive(response);
      updateDraft(chatId, (current) =>
        current.pending?.requestId === pending.requestId ? { text: '' } : current,
      );
      setNotice('Queued to send as Ramesh.');
      follow.current = true;
      setRefresh((value) => value + 1);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not confirm the send request');
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  const visible = mentionsOnly ? messages.filter((item) => item.mentionsBot) : messages;
  return (
    <div className="conversation-thread">
      <div className="thread-heading">
        <div>
          <h3>{conversation.name}</h3>
          <p>
            {conversation.isGroup ? 'Group conversation' : 'Direct message'}{' '}
            <span title={chatId}>· {chatId}</span>
          </p>
        </div>
        {conversation.isGroup && (
          <label className="mentions-toggle">
            <input
              type="checkbox"
              checked={mentionsOnly}
              onChange={(event) => setMentionsOnly(event.target.checked)}
            />{' '}
            Tagged only
          </label>
        )}
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          {error}
        </div>
      )}
      <div
        className="message-list"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element)
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        aria-label="Messages"
      >
        {cursor && (
          <button
            className="button secondary load-more"
            disabled={moreBusy}
            onClick={() => void older()}
          >
            {moreBusy ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {!visible.length && (
          <p className="inbox-placeholder">
            {!loaded
              ? 'Loading messages…'
              : mentionsOnly
                ? 'No tagged messages in this part of the conversation.'
                : 'No saved messages yet.'}
          </p>
        )}
        {visible.map((item) => (
          <article className={`message-bubble ${item.direction}`} key={item.id}>
            <div className="message-meta">
              <strong>{item.senderName}</strong>
              {item.mentionsBot && <span className="mention-badge">@Ramesh</span>}
              {item.direction === 'outbound' && (
                <span>{item.source === 'admin' ? 'Admin message' : 'Automatic reply'}</span>
              )}
            </div>
            <p>{item.text}</p>
            <div className="message-bottom">
              <time dateTime={item.at}>{stamp(item.at)}</time>
              {item.direction === 'outbound' && (
                <span
                  className={
                    ['UNCERTAIN', 'FAILED', 'EXPIRED'].includes(item.status) ? 'delivery-issue' : ''
                  }
                >
                  {delivery[item.status] ?? item.status}
                </span>
              )}
            </div>
            {item.status === 'UNCERTAIN' && (
              <small className="delivery-issue">
                WhatsApp may have received this message. It will not be retried automatically.
              </small>
            )}
          </article>
        ))}
      </div>
      <form className="message-composer" onSubmit={(event) => void send(event)}>
        <label htmlFor="message-draft">Message as Ramesh</label>
        <textarea
          id="message-draft"
          rows={3}
          maxLength={4000}
          value={draft.text}
          readOnly={!!draft.pending}
          onChange={(event) => updateDraft(chatId, () => ({ text: event.target.value }))}
          placeholder={`Write to ${conversation.name}…`}
        />
        {sendError && (
          <p className="error-text" role="alert">
            {sendError}
            {draft.pending && ' Retry keeps the same request to prevent a duplicate.'}
          </p>
        )}
        <div className="composer-actions">
          <span role="status">
            {!connected
              ? 'Connect WhatsApp to send.'
              : notice || `${draft.text.length.toLocaleString()} / 4,000`}
          </span>
          <button
            className="button primary"
            disabled={!connected || sending || !draft.text.trim()}
            type="submit"
          >
            {sending ? 'Submitting…' : draft.pending ? 'Retry send request' : 'Send as Ramesh'}
          </button>
        </div>
      </form>
    </div>
  );
}
function mergeMessages(previous: InboxMessage[], incoming: InboxMessage[]) {
  const merged = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) => a.at.localeCompare(b.at));
}
