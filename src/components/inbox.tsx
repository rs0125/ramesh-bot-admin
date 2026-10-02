'use client';
/** Polls saved conversations and keeps per-chat drafts and idempotent send requests in memory. */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Conversation, ConversationPage, InboxMessage, InboxPage } from '../lib/worker-api';
import { Icon } from './icon';
import { ContentSkeleton } from './loading-skeleton';
import { readApiResponse, requestError } from '../lib/api-response';

type Draft = {
  text: string;
  error?: string;
  pending?: { requestId: string; text: string; submitting: boolean };
};
const delivery: Record<string, string> = {
  READY_TO_SEND: 'Waiting to send',
  SENDING: 'Sending…',
  SENT: 'Sent to WhatsApp',
  FAILED: 'Not sent',
  EXPIRED: 'Not sent — timed out',
  UNCERTAIN: 'Send status unknown',
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

export function Inbox({
  paused,
  onSessionExpired,
  connected,
  connectionNotice,
  onDraftStateChange,
  focused,
  onToggleFocus,
}: {
  paused: boolean;
  onSessionExpired: () => void;
  connected: boolean;
  connectionNotice: string;
  onDraftStateChange: (summary: { count: number; pending: number }) => void;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [requireMention, setRequireMention] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [refresh, setRefresh] = useState(0);
  const paging = useRef(false);
  const paged = useRef(false);
  const draftCount = Object.values(drafts).filter(
    (draft) => draft.text.trim() || draft.pending,
  ).length;
  const pendingCount = Object.values(drafts).filter((draft) => draft.pending).length;

  useEffect(() => {
    onDraftStateChange({ count: draftCount, pending: pendingCount });
  }, [draftCount, pendingCount, onDraftStateChange]);

  useEffect(() => {
    if (!draftCount) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draftCount]);

  const receive = useCallback(
    async <T,>(
      response: Response,
      fallback = 'Could not load the inbox. Try again.',
    ): Promise<T> => {
      if (response.status === 401) {
        onSessionExpired();
        throw new Error('Sign in to continue');
      }
      return readApiResponse<T>(response, fallback);
    },
    [onSessionExpired],
  );

  useEffect(() => {
    if (paused) return;
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
          setError(
            requestError(
              error,
              'Could not load conversations. Check your connection and try again.',
            ),
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [receive, refresh, paused]);

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
      setMoreError('');
    } catch (error) {
      setMoreError(requestError(error, 'Could not load more conversations. Please try again.'));
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
      className={`panel inbox-panel ${selected ? 'has-selection' : ''} ${focused ? 'is-focused' : ''}`}
      id="inbox"
      aria-label="Ramesh inbox"
    >
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-icon">
            <Icon name="inbox" />
          </span>
          <div>
            <h2>Inbox</h2>
          </div>
        </div>
        <div className="inbox-toolbar">
          <button
            className="button secondary focus-inbox"
            onClick={onToggleFocus}
            aria-pressed={focused}
            aria-controls="inbox-layout"
            aria-label={focused ? 'Collapse inbox' : 'Expand inbox'}
          >
            <Icon name={focused ? 'collapse' : 'expand'} />
            <span>{focused ? 'Collapse inbox' : 'Expand inbox'}</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          <Icon name="alert" />
          <span>
            {error}
            {loaded && ' Showing your last loaded conversations.'}
          </span>
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setRefresh((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      <div className="inbox-layout" id="inbox-layout">
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
                aria-describedby={cursor ? 'conversation-scope' : undefined}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations…"
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
                  onClick={() => {
                    setFilter(value!);
                    if (selected && value !== 'all' && selected.isGroup !== (value === 'groups'))
                      setSelectedId(null);
                  }}
                >
                  {label}{' '}
                  {loaded && (
                    <span
                      className="filter-count"
                      title={cursor ? 'Loaded conversations' : 'Conversations'}
                    >
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
            {!loaded && !error && <ContentSkeleton kind="conversations" />}
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
                    {item.isGroup ? 'Group' : 'Direct message'}{' '}
                    {drafts[item.chatId]?.text && <span className="draft-indicator">· Draft</span>}
                  </small>
                </span>
              </button>
            ))}
            {!visible.length && (loaded || error) && (
              <div className="inbox-placeholder" role="status">
                <Icon name={search ? 'search' : 'message'} />
                <strong>
                  {error && !loaded
                    ? 'Inbox unavailable'
                    : search || filter !== 'all'
                      ? cursor
                        ? 'No matches in loaded conversations'
                        : 'No matches'
                      : 'No conversations yet'}
                </strong>
                <p>
                  {error && !loaded
                    ? 'We’ll try again automatically.'
                    : search || filter !== 'all'
                      ? cursor
                        ? 'Load more conversations or clear the filters.'
                        : 'Try another name or clear the filters.'
                      : connected
                        ? 'New WhatsApp messages will appear here.'
                        : 'Connect WhatsApp to receive messages.'}
                </p>
                {loaded && !search && filter === 'all' && !connected && (
                  <a className="text-link" href="#connection">
                    Manage connection <Icon name="arrow" />
                  </a>
                )}
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
            {moreError && (
              <p className="pagination-error" role="alert">
                {moreError}
              </p>
            )}
            {cursor && (
              <button
                className="button secondary load-more"
                disabled={moreBusy}
                onClick={() => void more()}
              >
                {moreBusy
                  ? 'Loading conversations…'
                  : moreError
                    ? 'Retry loading conversations'
                    : 'Load more conversations'}
              </button>
            )}
          </div>
          {cursor && (
            <div className="conversation-list-footer">
              <Icon name="search" />
              <span id="conversation-scope">
                {`Search covers ${conversations.length} loaded ${conversations.length === 1 ? 'conversation' : 'conversations'}.`}
              </span>
            </div>
          )}
        </div>
        {selected ? (
          <ConversationThread
            key={selected.chatId}
            paused={paused}
            conversation={selected}
            connected={connected}
            connectionNotice={connectionNotice}
            autoReplyNote={
              selected.isGroup && requireMention
                ? 'Ramesh also replies automatically when mentioned.'
                : 'Ramesh also replies automatically.'
            }
            draft={drafts[selected.chatId] ?? { text: '' }}
            updateDraft={updateDraft}
            receive={receive}
            onBack={() => {
              setSelectedId(null);
              requestAnimationFrame(() => {
                const target =
                  document.getElementById(`conversation-${selected.chatId}`) ??
                  document.getElementById('inbox-search');
                target?.focus();
              });
            }}
          />
        ) : (
          <div className="thread-empty">
            <span className="empty-icon">
              <Icon name="message" />
            </span>
            <h3>Select a conversation</h3>
            <p>Read messages and reply as Ramesh.</p>
          </div>
        )}
      </div>
      <div className="inbox-footnote">
        <span>
          <Icon name="clock" /> History kept for 30 days
        </span>
        {draftCount > 0 && <span>Reloading or leaving this page clears drafts.</span>}
      </div>
    </section>
  );
}

function ConversationThread({
  paused,
  conversation,
  connected,
  connectionNotice,
  autoReplyNote,
  draft,
  updateDraft,
  receive,
  onBack,
}: {
  paused: boolean;
  conversation: Conversation;
  connected: boolean;
  connectionNotice: string;
  autoReplyNote: string;
  draft: Draft;
  updateDraft: (chatId: string, update: (value: Draft) => Draft) => void;
  receive: <T>(response: Response, fallback?: string) => Promise<T>;
  onBack: () => void;
}) {
  const { chatId } = conversation;
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sending = !!draft.pending?.submitting;
  const sendError = draft.error;
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const sendLock = useRef<string | null>(null);
  const paging = useRef(false);
  const paged = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const threadHeading = useRef<HTMLHeadingElement>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [newMessages, setNewMessages] = useState(0);
  const rendered = useRef({ ids: new Set<string>(), height: 0, mentionsOnly: false });
  const olderAnchor = useRef<{ top: number; height: number } | null>(null);

  // Long headings, zoom, and recovery copy must leave space for history instead of overlapping the footer.
  useLayoutEffect(() => {
    const thread = scroll.current?.closest<HTMLElement>('.conversation-thread');
    const panel = thread?.closest<HTMLElement>('.inbox-panel');
    if (!thread || !panel) return;
    const fixedParts = Array.from(thread.children).filter(
      (element) => !element.classList.contains('thread-scroll-area'),
    );
    const chrome = Array.from(panel.children).filter(
      (element) => !element.classList.contains('inbox-layout'),
    );
    const measure = () => {
      const threadMinimum = Math.ceil(
        fixedParts.reduce(
          (height, element) => height + element.getBoundingClientRect().height,
          160,
        ),
      );
      const panelMinimum = Math.ceil(
        Array.from(panel.children)
          .filter((element) => !element.classList.contains('inbox-layout'))
          .reduce(
            (height, element) => height + element.getBoundingClientRect().height,
            threadMinimum + 2,
          ),
      );
      panel.style.setProperty('--thread-min-height', `${threadMinimum}px`);
      panel.style.setProperty('--inbox-min-height', `${panelMinimum}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [thread, ...fixedParts, ...chrome]) observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      panel.style.removeProperty('--thread-min-height');
      panel.style.removeProperty('--inbox-min-height');
    };
  }, [error]);

  function jumpToLatest() {
    follow.current = true;
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    setAwayFromLatest(false);
    setNewMessages(0);
  }

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const previous = rendered.current;
    const added = messages.filter(
      (item) => !previous.ids.has(item.id) && (!mentionsOnly || item.mentionsBot),
    ).length;
    if (olderAnchor.current) {
      element.scrollTop =
        olderAnchor.current.top + element.scrollHeight - olderAnchor.current.height;
      olderAnchor.current = null;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      setAwayFromLatest(!follow.current);
    } else if (
      !previous.ids.size ||
      previous.mentionsOnly !== mentionsOnly ||
      (follow.current && (added > 0 || element.scrollHeight !== previous.height))
    ) {
      jumpToLatest();
    } else if (!follow.current && added > 0) {
      setNewMessages((count) => count + added);
    }
    rendered.current = {
      ids: new Set(messages.map((item) => item.id)),
      height: element.scrollHeight,
      mentionsOnly,
    };
  }, [messages, mentionsOnly]);

  useEffect(() => {
    if (window.matchMedia('(max-width: 700px)').matches)
      threadHeading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (paused) return;
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
          setError(
            requestError(error, 'Could not load messages. Check your connection and try again.'),
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [chatId, receive, refresh, paused]);

  useEffect(() => {
    if (draft.pending && messages.some((item) => item.id === `${draft.pending!.requestId}:reply`)) {
      const id = draft.pending.requestId;
      if (sendLock.current === id) sendLock.current = null;
      updateDraft(chatId, (current) =>
        current.pending?.requestId === id ? { text: '' } : current,
      );
      setMentionsOnly(false);
      jumpToLatest();
      setNotice('Message submitted.');
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
      olderAnchor.current = scroll.current
        ? { top: scroll.current.scrollTop, height: scroll.current.scrollHeight }
        : null;
      setMessages((previous) => mergeMessages(data.messages, previous));
      setCursor(data.nextCursor);
      paged.current = true;
      setMoreError('');
    } catch (error) {
      setMoreError(requestError(error, 'Could not load older messages. Please try again.'));
    } finally {
      paging.current = false;
      setMoreBusy(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sendLock.current || sending || !connected || !draft.text.trim()) return;
    setNotice('');
    const pending = {
      ...(draft.pending ?? { requestId: crypto.randomUUID(), text: draft.text.trim() }),
      submitting: true,
    };
    sendLock.current = pending.requestId;
    updateDraft(chatId, (current) => ({ ...current, error: '', pending }));
    let rejected = false;
    try {
      const response = await fetch('/api/bot/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, requestId: pending.requestId, text: pending.text }),
        signal: AbortSignal.timeout(20000),
      });
      // Definite rejections did not enqueue anything; a timeout/503 retains the same request ID.
      rejected = [400, 401, 403, 404, 409, 413, 415, 429].includes(response.status);
      await receive(response, 'Could not confirm whether the message was sent.');
      updateDraft(chatId, (current) =>
        current.pending?.requestId === pending.requestId ? { text: '' } : current,
      );
      setNotice('Message submitted.');
      setMentionsOnly(false);
      follow.current = true;
      setRefresh((value) => value + 1);
    } catch (error) {
      updateDraft(chatId, (current) =>
        current.pending?.requestId === pending.requestId
          ? {
              ...current,
              pending: rejected ? undefined : { ...current.pending, submitting: false },
              error: requestError(error, 'Could not confirm whether the message was sent.'),
            }
          : current,
      );
    } finally {
      if (sendLock.current === pending.requestId) sendLock.current = null;
      updateDraft(chatId, (current) =>
        current.pending?.requestId === pending.requestId
          ? {
              ...current,
              pending: { ...current.pending, submitting: false },
            }
          : current,
      );
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
          <p>{conversation.isGroup ? 'Group conversation' : 'Direct message'}</p>
        </div>
        {conversation.isGroup && (
          <label className="mentions-toggle">
            <input
              type="checkbox"
              checked={mentionsOnly}
              onChange={(event) => setMentionsOnly(event.target.checked)}
            />
            <Icon name="at" /> Mentions of Ramesh
          </label>
        )}
      </div>
      {error && (
        <div className="inbox-error" role="alert">
          <Icon name="alert" />
          <span>
            {error}
            {loaded && ' Showing your last loaded messages.'}
          </span>
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setRefresh((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      <div className="thread-scroll-area">
        <div
          className="message-list"
          ref={scroll}
          onScroll={() => {
            const element = scroll.current;
            if (element) {
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
              setAwayFromLatest(!follow.current);
              if (follow.current) setNewMessages(0);
            }
          }}
          aria-label="Messages"
          aria-busy={!loaded && !error}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          tabIndex={0}
        >
          {moreError && (
            <p className="pagination-error" role="alert">
              {moreError}
            </p>
          )}
          {cursor && (
            <button
              className="button secondary load-more"
              disabled={moreBusy}
              onClick={() => void older()}
            >
              {moreBusy ? 'Loading…' : moreError ? 'Retry older messages' : 'Load older messages'}
            </button>
          )}
          {!loaded && !error && <ContentSkeleton kind="messages" />}
          {!visible.length && (loaded || error) && (
            <p className="inbox-placeholder">
              {!loaded
                ? error
                  ? 'Messages could not be loaded. Try again above.'
                  : 'Loading messages…'
                : mentionsOnly
                  ? 'No mentions of Ramesh in the loaded messages.'
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
                            ? 'check'
                            : ['UNCERTAIN', 'FAILED', 'EXPIRED'].includes(item.status)
                              ? 'alert'
                              : 'clock'
                        }
                      />
                      {delivery[item.status] ?? 'Status unavailable'}
                    </span>
                  )}
                </div>
                {item.status === 'UNCERTAIN' && (
                  <small className="delivery-issue">
                    This message may have been sent. Ramesh won’t resend it automatically.
                  </small>
                )}
              </article>
            </Fragment>
          ))}
        </div>
        {awayFromLatest && (
          <button type="button" className="button secondary jump-to-latest" onClick={jumpToLatest}>
            <Icon name="down" />
            {newMessages > 0
              ? `${newMessages} new ${newMessages === 1 ? 'message' : 'messages'} · Jump to latest`
              : 'Jump to latest'}
          </button>
        )}
        <span className="sr-only" role="status">
          {newMessages > 0
            ? `${newMessages} new ${newMessages === 1 ? 'message' : 'messages'} below.`
            : ''}
        </span>
      </div>
      <form className="message-composer" onSubmit={(event) => void send(event)}>
        <div className="composer-heading">
          <label htmlFor="message-draft">
            <Icon name="message" /> Message
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
          onChange={(event) => {
            setNotice('');
            updateDraft(chatId, () => ({ text: event.target.value }));
          }}
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
          </p>
        )}
        {!connected && (
          <div className="composer-connection-note">
            <Icon name="phone" />
            <span>{connectionNotice}</span>
            <a className="text-link" href="#connection">
              Manage connection <Icon name="upRight" />
            </a>
          </div>
        )}
        {connected && <p className="composer-policy">{autoReplyNote}</p>}
        <div className="composer-actions">
          <span role="status" id="composer-hint">
            {notice ||
              (draft.pending
                ? sending
                  ? 'Waiting for confirmation…'
                  : 'Editing is paused. Retry sending to avoid a duplicate.'
                : 'Ctrl / ⌘ + Enter to send')}
          </span>
          <button
            className="button primary"
            disabled={!connected || sending || !draft.text.trim()}
            type="submit"
          >
            {sending ? 'Submitting…' : draft.pending ? 'Retry sending' : 'Send as Ramesh'}
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
