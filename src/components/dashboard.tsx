'use client';
/** Live view of worker state. Polling stops on unmount and never overlaps itself. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotAction, BotStatus } from '../lib/worker-api';
import { PairingCode } from './pairing-code';
import { Inbox } from './inbox';
import { Brand } from './brand';
import { Icon, type IconName } from './icon';
import { SignOutDialog } from './sign-out-dialog';
import { useWorkspaceNavigation, workspaceSections } from './use-workspace-navigation';
import { ContentSkeleton, Skeleton } from './loading-skeleton';
import { SessionDialog } from './session-dialog';
import { readApiResponse, requestError } from '../lib/api-response';

const labels: Record<BotStatus['state'], string> = {
  stopped: 'Disconnected',
  connecting: 'Connecting',
  pairing: 'Ready to scan',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnecting: 'Disconnecting',
  error: 'Needs attention',
};

export function Dashboard() {
  const router = useRouter();
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<BotAction | null>(null);
  const [fresh, setFresh] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [actionError, setActionError] = useState<{
    message: string;
    action: BotAction | 'signout';
  } | null>(null);
  const [inboxFocused, setInboxFocused] = useState(false);
  const [draftSummary, setDraftSummary] = useState({ count: 0, pending: 0 });
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const sessionGeneration = useRef(0);
  const logoutPending = useRef(false);
  const leaveInboxFocus = useCallback(() => setInboxFocused(false), []);
  const { activeSection, scrolled } = useWorkspaceNavigation(leaveInboxFocus);
  const revision = useRef(0);
  const controlPending = useRef(false);

  const expireSession = useCallback(() => {
    if (logoutPending.current || sessionGeneration.current !== sessionVersion) return;
    sessionGeneration.current++;
    revision.current++;
    setFresh(false);
    setStatus(null);
    setConfirmSignOut(false);
    setSessionExpired(true);
  }, [sessionVersion]);

  const receive = useCallback(
    async (response: Response, expectedRevision: number) => {
      if (revision.current !== expectedRevision) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401) {
        expireSession();
        return;
      }
      const data = await readApiResponse<BotStatus>(
        response,
        'Connection status is temporarily unavailable.',
      );
      if (revision.current !== expectedRevision) return;
      setStatus(data);
      setFresh(true);
      setError('');
    },
    [expireSession],
  );

  useEffect(() => {
    if (sessionExpired || logoutBusy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const expectedRevision = revision.current;
      try {
        if (controlPending.current) return;
        await receive(
          await fetch('/api/bot/status', {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          }),
          expectedRevision,
        );
      } catch (error) {
        if (!controller.signal.aborted && revision.current === expectedRevision) {
          setFresh(false);
          setError(
            requestError(error, 'Could not reach Ramesh. Check your connection and try again.'),
          );
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [receive, sessionExpired, logoutBusy, statusRefresh]);

  async function control(action: BotAction) {
    if (controlPending.current || logoutPending.current || sessionExpired) return;
    controlPending.current = true;
    const expectedRevision = ++revision.current;
    setFresh(false);
    setBusy(action);
    setActionError(null);
    try {
      await receive(
        await fetch('/api/bot/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
          signal: AbortSignal.timeout(35_000),
        }),
        expectedRevision,
      );
    } catch (error) {
      setActionError({
        message: requestError(error, 'Check the connection status before trying again.'),
        action,
      });
      setFresh(false);
    } finally {
      setBusy(null);
      controlPending.current = false;
    }
  }

  async function signOut() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    revision.current++;
    setFresh(false);
    setLogoutBusy(true);
    setActionError(null);
    try {
      const response = await fetch('/api/session', {
        method: 'DELETE',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('Could not sign out');
      router.replace('/login');
      router.refresh();
    } catch {
      logoutPending.current = false;
      setActionError({ message: 'Please try signing out again.', action: 'signout' });
      setLogoutBusy(false);
    }
  }

  const connected = status?.state === 'connected' && fresh && !logoutBusy;
  const inactive = status?.state === 'stopped' || status?.state === 'error';
  const transitioning =
    !!busy || ['connecting', 'reconnecting', 'disconnecting'].includes(status?.state ?? '');
  const label = logoutBusy
    ? 'Signing out'
    : busy
      ? busy === 'disconnect'
        ? 'Disconnecting'
        : 'Connecting'
      : fresh && status
        ? labels[status.state]
        : error
          ? 'Updates unavailable'
          : 'Checking connection';
  const metrics = status?.metrics;
  const initialLoading = !status && !error && !sessionExpired;
  const pairing = fresh && !logoutBusy && status?.state === 'pairing' && !!status.qr;
  const metricCards: {
    title: string;
    value: number | undefined;
    icon: IconName;
  }[] = [
    {
      title: 'Received',
      value: metrics?.received,
      icon: 'inbox',
    },
    {
      title: 'Sent to WhatsApp',
      value: metrics?.replied,
      icon: 'send',
    },
    {
      title: 'Duplicates skipped',
      value: metrics?.duplicates,
      icon: 'duplicates',
    },
  ];

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <header className={`workspace-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="header-inner">
          <a className="brand-link" href="#overview" aria-label="WareOnGo Ramesh overview">
            <Brand />
          </a>
          <nav className="workspace-nav" aria-label="Workspace navigation">
            {workspaceSections.map(([id, title]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={activeSection === id ? 'location' : undefined}
              >
                {title}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <span className="admin-badge">
              <span className="admin-avatar">A</span> Admin
            </span>
            <button
              onClick={() => (draftSummary.count ? setConfirmSignOut(true) : void signOut())}
              disabled={logoutBusy || !!busy}
              className="button ghost signout"
            >
              <span>{logoutBusy ? 'Signing out…' : 'Sign out'}</span>
              <Icon name="logout" />
            </button>
          </div>
        </div>
        {actionError && (
          <div className="action-feedback" role="alert">
            <Icon name="alert" />
            <div>
              <strong>
                {actionError.action === 'signout'
                  ? 'Could not confirm sign-out.'
                  : 'Could not confirm the connection change.'}
              </strong>
              <p>{actionError.message}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss action error"
              onClick={() => setActionError(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </header>
      <main
        className={`page ${inboxFocused ? 'is-inbox-focused' : ''}`}
        id="main-content"
        tabIndex={-1}
      >
        <section className="overview-section" id="overview" aria-labelledby="overview-title">
          <div className="page-heading">
            <h1 id="overview-title">Overview</h1>
            <a className="button secondary" href="#inbox">
              Open inbox <Icon name="arrow" />
            </a>
          </div>
          <div className="connection-strip" role="status">
            <div className="connection-strip-label">
              <span
                className={`status-dot ${connected ? 'online' : ''} ${transitioning ? 'pulsing' : ''}`}
              />
              <strong>{connected ? 'WhatsApp connected' : label}</strong>
              {(pairing || (fresh && !connected && !transitioning)) && (
                <span className="strip-description">
                  {pairing
                    ? 'Scan the QR code in Connection.'
                    : 'Connect WhatsApp to receive messages and reply.'}
                </span>
              )}
            </div>
            <a className="text-link" href="#connection">
              Manage connection <Icon name="upRight" />
            </a>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" />
              <div>
                <p>{error}</p>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  setError('');
                  setStatusRefresh((value) => value + 1);
                }}
              >
                Check again
              </button>
            </div>
          )}
          <div className="section-caption">
            <span>MESSAGE TOTALS</span>
            <span>
              <Icon name="clock" /> Since Ramesh last started{' '}
              {status && !fresh && '· Last known totals'}
            </span>
          </div>
          <section
            className="metrics"
            aria-label="Message totals since Ramesh last started"
            aria-busy={initialLoading}
          >
            {metricCards.map(({ title, value, icon }) => (
              <div className="metric" key={title}>
                <div className="metric-top">
                  <span>{title}</span>
                  <Icon name={icon} />
                </div>
                <strong
                  className={value !== undefined && value >= 1000 ? 'compact-number' : undefined}
                  title={value?.toLocaleString()}
                  aria-label={value?.toLocaleString()}
                >
                  {initialLoading ? (
                    <>
                      <Skeleton className="skeleton-metric" />
                      <span className="sr-only">Loading total</span>
                    </>
                  ) : value === undefined ? (
                    '—'
                  ) : (
                    new Intl.NumberFormat(undefined, {
                      notation: value >= 1000 ? 'compact' : 'standard',
                      maximumSignificantDigits: 3,
                    }).format(value)
                  )}
                </strong>
              </div>
            ))}
          </section>
        </section>
        <Inbox
          paused={sessionExpired || logoutBusy}
          onSessionExpired={expireSession}
          connected={connected}
          connectionNotice={
            !fresh
              ? error
                ? 'Connection status is unavailable. You can still write a draft.'
                : 'Checking the connection before you can send.'
              : 'Connect WhatsApp to send this message.'
          }
          onDraftStateChange={setDraftSummary}
          focused={inboxFocused}
          onToggleFocus={() => {
            setInboxFocused((value) => !value);
            requestAnimationFrame(() =>
              document
                .getElementById('inbox')
                ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
            );
          }}
        />
        <div className="operations-heading">
          <h2>Connection & activity</h2>
        </div>
        <div className="content-grid">
          <section
            className="panel connection-panel"
            id="connection"
            aria-labelledby="connection-title"
          >
            <div className="panel-heading">
              <div className="panel-title">
                <span className="panel-icon">
                  <Icon name="phone" />
                </span>
                <div>
                  <h2 id="connection-title">WhatsApp connection</h2>
                </div>
              </div>
              <span className={`status-badge ${connected ? 'connected' : ''}`}>
                <span className={`status-dot ${connected ? 'online' : ''}`} />
                {label}
              </span>
            </div>
            <div
              className={`pairing-stage ${connected ? 'is-connected' : ''} ${pairing ? 'is-pairing' : ''}`}
            >
              {initialLoading ? (
                <div className="connection-art" role="status" aria-label="Loading connection">
                  <Skeleton className="skeleton-connection" />
                  <span className="sr-only">Loading connection…</span>
                </div>
              ) : pairing ? (
                <div className="qr-frame">
                  <PairingCode value={status!.qr!} />
                </div>
              ) : (
                <div className="connection-art">
                  <span className="connection-symbol">
                    <Icon
                      name={connected ? 'connected' : transitioning ? 'refresh' : 'phone'}
                      className={transitioning ? 'spinning' : ''}
                    />
                  </span>
                </div>
              )}
              <h3>
                {connected
                  ? 'WhatsApp is connected'
                  : pairing
                    ? 'Scan to connect WhatsApp'
                    : !fresh && error
                      ? 'Connection unavailable'
                      : transitioning
                        ? busy === 'disconnect' || status?.state === 'disconnecting'
                          ? 'Disconnecting WhatsApp…'
                          : 'Connecting to WhatsApp…'
                        : !fresh
                          ? 'Checking connection…'
                          : 'Connect WhatsApp'}
              </h3>
              {!connected && !pairing && (
                <p>
                  {!fresh && error
                    ? 'We’ll keep checking the connection automatically.'
                    : transitioning
                      ? 'This may take a moment.'
                      : !fresh
                        ? 'Controls will be available once the connection is checked.'
                        : 'Connect the WhatsApp account Ramesh will use to send and receive messages.'}
                </p>
              )}
              {pairing && (
                <ol className="pairing-steps">
                  <li>
                    <span>1</span>
                    <div>Open WhatsApp on your phone.</div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      Open <strong>Linked devices</strong> from Settings (iPhone) or the three-dot
                      menu (Android).
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      Tap <strong>Link a device</strong>, then scan this code.
                    </div>
                  </li>
                </ol>
              )}
              {connected && (
                <a className="text-link" href="#inbox">
                  Open inbox <Icon name="arrow" />
                </a>
              )}
              {!fresh && error && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setError('');
                    setStatusRefresh((value) => value + 1);
                  }}
                >
                  Check again
                </button>
              )}
            </div>
            <div className="connection-actions">
              <button
                className={`button ${pairing ? 'secondary' : 'primary'}`}
                disabled={!!busy || !fresh || logoutBusy}
                onClick={() => void control(inactive ? 'connect' : 'reconnect')}
              >
                <Icon
                  name={inactive ? 'phone' : 'refresh'}
                  className={busy === 'connect' || busy === 'reconnect' ? 'spinning' : ''}
                />
                {busy === 'connect' || busy === 'reconnect'
                  ? busy === 'connect'
                    ? 'Connecting…'
                    : status?.state === 'pairing'
                      ? 'Refreshing QR code…'
                      : 'Reconnecting…'
                  : inactive || !status
                    ? 'Connect WhatsApp'
                    : pairing
                      ? 'Refresh QR code'
                      : 'Reconnect'}
              </button>
              <button
                className="button secondary"
                disabled={!!busy || !fresh || inactive || logoutBusy}
                onClick={() => void control('disconnect')}
              >
                <Icon name="pause" />
                {busy === 'disconnect'
                  ? status?.state === 'pairing'
                    ? 'Cancelling…'
                    : 'Disconnecting…'
                  : pairing
                    ? 'Cancel setup'
                    : 'Disconnect'}
              </button>
            </div>
            {!pairing && (
              <p className="panel-footnote">
                <Icon name="shield" /> Disconnect pauses incoming messages and replies.
              </p>
            )}
          </section>
          <section className="panel activity-panel" id="activity" aria-labelledby="activity-title">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="panel-icon">
                  <Icon name="activity" />
                </span>
                <div>
                  <h2 id="activity-title">Recent activity</h2>
                </div>
              </div>
              <span className={`live-indicator ${fresh ? 'live' : ''}`}>
                <span className={`status-dot ${fresh ? 'online' : ''}`} />
                {initialLoading ? 'Loading activity' : fresh ? 'Live updates' : 'Updates paused'}
              </span>
            </div>
            <div className="event-list" aria-busy={initialLoading}>
              {initialLoading ? (
                <ContentSkeleton kind="activity" />
              ) : status?.events.length ? (
                <ol className="event-timeline">
                  {status.events.map((event, index) => (
                    <li className={`event ${event.level}`} key={`${event.at}-${index}`}>
                      <span className="event-icon">
                        <Icon name={event.level === 'error' ? 'alert' : 'check'} />
                      </span>
                      <div>
                        <p>{event.message}</p>
                        <time dateTime={event.at}>
                          {new Date(event.at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Icon name="activity" />
                  </span>
                  <h3>{status ? 'No recent activity' : 'Activity unavailable'}</h3>
                  <p>
                    {status
                      ? 'Connection updates and replies will appear here.'
                      : 'Activity will appear when live updates resume.'}
                  </p>
                </div>
              )}
            </div>
            <div className="activity-footer">
              <span>
                <Icon name="alert" /> Errors
              </span>
              <strong>{metrics?.errors?.toLocaleString() ?? '—'}</strong>
            </div>
            {!!metrics?.dropped && (
              <div className="activity-footer">
                <span>Messages skipped while busy</span>
                <strong>{metrics.dropped.toLocaleString()}</strong>
              </div>
            )}
          </section>
        </div>
        <footer className="page-footer">
          <a className="text-link" href="#overview">
            Back to top <Icon name="upRight" />
          </a>
        </footer>
      </main>
      <SignOutDialog
        open={confirmSignOut}
        draftCount={draftSummary.count}
        pendingCount={draftSummary.pending}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />
      <SessionDialog
        open={sessionExpired}
        onResume={() => {
          revision.current++;
          sessionGeneration.current++;
          setSessionVersion(sessionGeneration.current);
          setError('');
          setSessionExpired(false);
        }}
      />
    </div>
  );
}
