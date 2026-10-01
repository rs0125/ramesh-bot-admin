'use client';
/** Polls saved conversations and keeps per-chat drafts and idempotent send requests in memory. */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, ConversationPage, InboxMessage, InboxPage } from '../lib/worker-api';
import { Icon } from './icon';

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
const dateLabel = (at: string) =>
  new Date(at).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
const conversationStamp = (at: string) => {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

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
    <section
      className={`panel inbox-panel ${selected ? 'has-selection' : ''}`}
      id="inbox"
      aria-label="Ramesh inbox"
    >
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-icon">
            <Icon name="inbox" />
          </span>
          <div>
            <h2>Ramesh’s inbox</h2>
            <p className="muted">Every conversation, a little closer.</p>
          </div>
        </div>
        <span className="inbox-policy">
          <Icon name="at" />
          {requireMention ? 'Group replies on mention' : 'Replies to all group messages'}
        </span>
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          <Icon name="alert" />
          {error}
        </div>
      )}
      <div className="inbox-layout">
        <div className="conversation-sidebar">
          <div className="inbox-search">
            <label className="sr-only" htmlFor="inbox-search">
              Search conversations
            </label>
            <div className="search-field">
              <Icon name="search" />
              <input
                id="inbox-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a conversation…"
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch('');
                    document.getElementById('inbox-search')?.focus();
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
            <div className="inbox-filters" aria-label="Conversation type">
              {[
                ['all', 'All'],
                ['groups', 'Groups'],
                ['direct', 'Direct'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-label={label}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value!)}
                >
                  {label}{' '}
                  {loaded && (
                    <span className="filter-count">
                      {
                        conversations.filter(
                          (item) => value === 'all' || item.isGroup === (value === 'groups'),
                        ).length
                      }
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div
            className="conversation-list"
            aria-label="Conversations"
            aria-busy={!loaded && !error}
          >
            {visible.map((item) => (
              <button
                className={`conversation-item ${selectedId === item.chatId ? 'selected' : ''}`}
                key={item.chatId}
                id={`conversation-${item.chatId}`}
                aria-pressed={selectedId === item.chatId}
                onClick={() => setSelectedId(item.chatId)}
              >
                <span
                  className={`conversation-avatar ${item.isGroup ? 'group' : ''}`}
                  aria-hidden="true"
                >
                  {item.isGroup ? <Icon name="users" /> : item.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-name">
                    <strong>{item.name}</strong>
                    <time dateTime={item.lastMessageAt}>
                      {conversationStamp(item.lastMessageAt)}
                    </time>
                  </span>
                  <span className="conversation-preview">{item.lastMessage}</span>
                  <small>
                    {item.isGroup ? 'Group conversation' : 'Direct message'}{' '}
                    {drafts[item.chatId]?.text && <span className="draft-indicator">· Draft</span>}
                  </small>
                </span>
              </button>
            ))}
            {!visible.length && (
              <div className="inbox-placeholder" role="status">
                <Icon
                  name={!loaded && !error ? 'refresh' : search ? 'search' : 'message'}
                  className={!loaded && !error ? 'spinning' : ''}
                />
                <strong>
                  {error && !loaded
                    ? 'Inbox unavailable'
                    : !loaded
                      ? 'Finding your conversations…'
                      : search || filter !== 'all'
                        ? 'No conversations found'
                        : 'A fresh start'}
                </strong>
                <p>
                  {error && !loaded
                    ? 'We’ll try again automatically.'
                    : !loaded
                      ? 'Just a moment.'
                      : search || filter !== 'all'
                        ? 'Try a different name or conversation type.'
                        : 'Your first message will find its home here.'}
                </p>
                {(search || filter !== 'all') && (
                  <button
                    className="text-link"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    Clear filters <Icon name="arrow" />
                  </button>
                )}
              </div>
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
          <div className="conversation-list-footer">
            <Icon name="shield" />
            <span>Your team’s conversations, in one place.</span>
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
            onBack={() => {
              setSelectedId(null);
              requestAnimationFrame(() =>
                document.getElementById(`conversation-${selected.chatId}`)?.focus(),
              );
            }}
          />
        ) : (
          <div className="thread-empty">
            <span className="empty-icon">
              <Icon name="message" />
            </span>
            <span className="eyebrow">A SPACE FOR EVERY CONVERSATION</span>
            <h3>Pick up the conversation.</h3>
            <p>
              Choose a chat to see the whole picture
              <br className="desktop-break" /> and send a thoughtful reply as Ramesh.
            </p>
            <div className="thread-empty-details">
              <span>
                <Icon name="users" /> Direct & group messages
              </span>
              <span>
                <Icon name="at" /> Mentions, easy to find
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="inbox-footnote">
        <span>
          <Icon name="clock" /> 30 days of conversation history
        </span>
        <span>Earlier messages may be unavailable.</span>
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
  onBack,
}: {
  conversation: Conversation;
  connected: boolean;
  draft: Draft;
  updateDraft: (chatId: string, update: (value: Draft) => Draft) => void;
  receive: <T>(response: Response) => Promise<T>;
  onBack: () => void;
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
  const threadHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (window.matchMedia('(max-width: 700px)').matches)
      threadHeading.current?.focus({ preventScroll: true });
  }, []);

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
        <button
          type="button"
          className="icon-button thread-back"
          aria-label="Back to conversations"
          onClick={onBack}
        >
          <Icon name="back" />
        </button>
        <span
          className={`conversation-avatar ${conversation.isGroup ? 'group' : ''}`}
          aria-hidden="true"
        >
          {conversation.isGroup ? (
            <Icon name="users" />
          ) : (
            conversation.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="thread-title">
          <h3 tabIndex={-1} ref={threadHeading}>
            {conversation.name}
          </h3>
          <p>{conversation.isGroup ? 'Group conversation' : 'Direct message'} · WhatsApp</p>
        </div>
        {conversation.isGroup && (
          <label className="mentions-toggle">
            <input
              type="checkbox"
              checked={mentionsOnly}
              onChange={(event) => setMentionsOnly(event.target.checked)}
            />
            <Icon name="at" /> Tagged only
          </label>
        )}
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          <Icon name="alert" />
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
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        tabIndex={0}
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
        {visible.map((item, index) => (
          <Fragment key={item.id}>
            {(index === 0 || dateLabel(item.at) !== dateLabel(visible[index - 1]!.at)) && (
              <div className="message-date">
                <span>{dateLabel(item.at)}</span>
              </div>
            )}
            <article className={`message-bubble ${item.direction}`}>
              <div className="message-meta">
                <strong>{item.senderName}</strong>
                {item.mentionsBot && (
                  <span className="mention-badge">
                    <Icon name="at" /> Ramesh
                  </span>
                )}
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
                      ['UNCERTAIN', 'FAILED', 'EXPIRED'].includes(item.status)
                        ? 'delivery-issue'
                        : ''
                    }
                  >
                    <Icon
                      name={
                        item.status === 'SENT'
                          ? 'checkDouble'
                          : ['UNCERTAIN', 'FAILED', 'EXPIRED'].includes(item.status)
                            ? 'alert'
                            : 'clock'
                      }
                    />
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
          </Fragment>
        ))}
      </div>
      <form className="message-composer" onSubmit={(event) => void send(event)}>
        <div className="composer-heading">
          <label htmlFor="message-draft">
            <Icon name="message" /> Message as Ramesh
          </label>
          <span>{draft.text.length.toLocaleString()} / 4,000</span>
        </div>
        <textarea
          id="message-draft"
          rows={3}
          maxLength={4000}
          value={draft.text}
          readOnly={!!draft.pending}
          aria-describedby="composer-hint"
          onChange={(event) => updateDraft(chatId, () => ({ text: event.target.value }))}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={`Write to ${conversation.name}…`}
        />
        {sendError && (
          <p className="error-text" role="alert">
            {sendError}
            {draft.pending && ' Retry keeps the same request to prevent a duplicate.'}
          </p>
        )}
        <div className="composer-actions">
          <span role="status" id="composer-hint">
            {!connected ? 'Connect WhatsApp to send.' : notice || 'Ctrl / ⌘ + Enter to send'}
          </span>
          <button
            className="button primary"
            disabled={!connected || sending || !draft.text.trim()}
            type="submit"
          >
            {sending ? 'Submitting…' : draft.pending ? 'Retry send request' : 'Send as Ramesh'}
            <Icon name={sending ? 'refresh' : 'send'} className={sending ? 'spinning' : ''} />
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
