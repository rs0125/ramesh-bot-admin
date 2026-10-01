'use client';
/** Live view of worker state. Polling stops on unmount and never overlaps itself. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotAction, BotStatus } from '../lib/worker-api';
import { PairingCode } from './pairing-code';
import { Inbox } from './inbox';
import { Brand } from './brand';
import { Icon, type IconName } from './icon';

const sections = [
  ['overview', 'Overview'],
  ['inbox', 'Inbox'],
  ['connection', 'Connection'],
  ['activity', 'Activity'],
] as const;

const labels: Record<BotStatus['state'], string> = {
  stopped: 'Disconnected',
  connecting: 'Connecting',
  pairing: 'Ready to pair',
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
  const [activeSection, setActiveSection] = useState('overview');
  const [scrolled, setScrolled] = useState(false);
  const revision = useRef(0);
  const controlPending = useRef(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    const onHashChange = () => {
      const current = sections.find(([id]) => window.location.hash === `#${id}`);
      setActiveSection(current?.[0] ?? 'overview');
    };
    onScroll();
    onHashChange();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const receive = useCallback(
    async (response: Response, expectedRevision: number) => {
      if (revision.current !== expectedRevision) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401) {
        setFresh(false);
        setStatus(null);
        router.replace('/login');
        return;
      }
      const data = await response.json();
      if (revision.current !== expectedRevision) return;
      if (!response.ok) throw new Error(data.error ?? 'Worker request failed');
      setStatus(data as BotStatus);
      setFresh(true);
      setError('');
    },
    [router],
  );

  useEffect(() => {
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
          setError(error instanceof Error ? error.message : 'Worker unavailable');
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
  }, [receive]);

  async function control(action: BotAction) {
    if (controlPending.current) return;
    controlPending.current = true;
    const expectedRevision = ++revision.current;
    setFresh(false);
    setBusy(action);
    setError('');
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
      setError(error instanceof Error ? error.message : 'Action failed');
      setFresh(false);
    } finally {
      setBusy(null);
      controlPending.current = false;
    }
  }

  async function signOut() {
    revision.current++;
    setFresh(false);
    setLogoutBusy(true);
    try {
      const response = await fetch('/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not sign out');
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Could not sign out. Please try again.');
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
          ? 'Worker unavailable'
          : 'Checking connection';
  const metrics = status?.metrics;
  const pairing = fresh && !logoutBusy && status?.state === 'pairing' && !!status.qr;
  const metricCards: {
    title: string;
    value: number | undefined;
    detail: string;
    icon: IconName;
  }[] = [
    {
      title: 'Messages received',
      value: metrics?.received,
      detail: 'Conversations coming your way',
      icon: 'inbox',
    },
    {
      title: 'Messages sent',
      value: metrics?.replied,
      detail: 'Submitted to WhatsApp',
      icon: 'send',
    },
    {
      title: 'Duplicates skipped',
      value: metrics?.duplicates,
      detail: 'Keeping conversations clear',
      icon: 'checkDouble',
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
            {sections.map(([id, title]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={activeSection === id ? 'location' : undefined}
                onClick={() => setActiveSection(id)}
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
              onClick={() => void signOut()}
              disabled={logoutBusy || !!busy}
              className="button ghost signout"
            >
              <span>{logoutBusy ? 'Signing out…' : 'Sign out'}</span>
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </header>
      <main className="page" id="main-content">
        <section className="overview-section" id="overview" aria-labelledby="overview-title">
          <div className="page-heading">
            <div>
              <span className="eyebrow">RAMESH / YOUR SALES WORKSPACE</span>
              <h1 id="overview-title">
                Bot overview<span className="heading-period">.</span>
              </h1>
              <p className="muted">Good conversations. Great connections. Everything in view.</p>
            </div>
            <a className="button secondary" href="#inbox">
              Open inbox <Icon name="arrow" />
            </a>
          </div>
          <div className="connection-strip" role="status">
            <div className="connection-strip-label">
              <span
                className={`status-dot ${connected ? 'online' : ''} ${transitioning ? 'pulsing' : ''}`}
              />
              <strong>{label}</strong>
              <span className="strip-description">
                {connected
                  ? 'Ramesh is ready for the next conversation.'
                  : pairing
                    ? 'Your QR code is ready. Link WhatsApp below.'
                    : transitioning
                      ? 'Updating your WhatsApp connection…'
                      : fresh
                        ? 'Link WhatsApp to start the conversation.'
                        : 'Waiting for a connection update.'}
              </span>
            </div>
            <a className="text-link" href="#connection">
              Manage connection <Icon name="upRight" />
            </a>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" />
              <div>
                <strong>Let’s get you connected again.</strong>
                <p>{error}</p>
              </div>
              <span>Retrying automatically</span>
            </div>
          )}
          <div className="section-caption">
            <span>ACTIVITY AT A GLANCE</span>
            <span>
              <Icon name="clock" /> Since last restart {status && !fresh && '· Last known totals'}
            </span>
          </div>
          <section className="metrics" aria-label="Activity since worker start">
            {metricCards.map(({ title, value, detail, icon }, index) => (
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
                  {value === undefined
                    ? '—'
                    : new Intl.NumberFormat(undefined, {
                        notation: value >= 1000 ? 'compact' : 'standard',
                        maximumSignificantDigits: 3,
                      }).format(value)}
                </strong>
                <div className="metric-bottom">
                  <small>{detail}</small>
                  <span className="metric-index">0{index + 1}</span>
                </div>
              </div>
            ))}
          </section>
        </section>
        <Inbox connected={connected} />
        <div className="operations-heading">
          <span className="eyebrow">BEHIND THE CONVERSATIONS</span>
          <h2>A little peace of mind.</h2>
          <p className="muted">Your connection and the latest activity, in one place.</p>
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
                  <p className="muted">Ramesh’s linked account</p>
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
              {pairing ? (
                <div className="qr-frame">
                  <PairingCode value={status!.qr!} />
                </div>
              ) : (
                <div className="connection-art">
                  <span className="connection-symbol">
                    <Icon
                      name={connected ? 'checkDouble' : transitioning ? 'refresh' : 'phone'}
                      className={transitioning ? 'spinning' : ''}
                    />
                  </span>
                  <span className="connection-art-caption">
                    {connected ? 'LINKED & READY' : transitioning ? 'ONE MOMENT' : 'LET’S CONNECT'}
                  </span>
                </div>
              )}
              <h3>
                {connected
                  ? 'You’re connected'
                  : pairing
                    ? 'Scan to link your account'
                    : transitioning
                      ? 'Making the connection'
                      : !fresh && error
                        ? 'Connection unavailable'
                        : !fresh
                          ? 'Checking your connection'
                          : 'Bring your bot online'}
              </h3>
              <p>
                {connected
                  ? 'WhatsApp is linked. Read your conversations or jump in with a reply as Ramesh.'
                  : pairing
                    ? 'On your phone, open WhatsApp and follow these steps.'
                    : transitioning
                      ? 'This can take a moment. Your connection status will update automatically.'
                      : !fresh
                        ? 'We’re checking in with Ramesh. Controls will be ready when the connection is restored.'
                        : 'Link a WhatsApp account to receive direct messages and follow group conversations.'}
              </p>
              {pairing && (
                <ol className="pairing-steps">
                  <li>
                    <span>1</span>Open Settings
                  </li>
                  <li>
                    <span>2</span>Linked devices
                  </li>
                  <li>
                    <span>3</span>Link a device
                  </li>
                </ol>
              )}
              {connected && (
                <a className="text-link" href="#inbox">
                  Back to your conversations <Icon name="arrow" />
                </a>
              )}
            </div>
            <div className="connection-actions">
              <button
                className="button primary"
                disabled={!!busy || !fresh || logoutBusy}
                onClick={() => void control(inactive ? 'connect' : 'reconnect')}
              >
                <Icon
                  name={inactive ? 'phone' : 'refresh'}
                  className={busy === 'connect' || busy === 'reconnect' ? 'spinning' : ''}
                />
                {busy === 'connect' || busy === 'reconnect'
                  ? 'Working…'
                  : inactive
                    ? 'Connect WhatsApp'
                    : 'Reconnect'}
              </button>
              <button
                className="button secondary"
                disabled={!!busy || !fresh || inactive || logoutBusy}
                onClick={() => void control('disconnect')}
              >
                <Icon name="pause" />
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
            <p className="panel-footnote">
              <Icon name="shield" /> Disconnect pauses Ramesh until you connect again.
            </p>
          </section>
          <section className="panel activity-panel" id="activity" aria-labelledby="activity-title">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="panel-icon">
                  <Icon name="activity" />
                </span>
                <div>
                  <h2 id="activity-title">Recent activity</h2>
                  <p className="muted">The latest from Ramesh</p>
                </div>
              </div>
              <span className={`live-indicator ${fresh ? 'live' : ''}`}>
                <span className={`status-dot ${fresh ? 'online' : ''}`} />
                {fresh ? 'Live updates' : 'Updates paused'}
              </span>
            </div>
            <div className="event-list">
              {status?.events.length ? (
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
                  <h3>A quiet start</h3>
                  <p>
                    Connection updates and replies
                    <br />
                    will find their way here.
                  </p>
                </div>
              )}
            </div>
            <div className="activity-footer">
              <span>
                <Icon name="alert" /> Delivery errors
              </span>
              <strong>{metrics?.errors?.toLocaleString() ?? '—'}</strong>
            </div>
            {!!metrics?.dropped && (
              <div className="activity-footer">
                <span>Skipped while busy</span>
                <strong>{metrics.dropped.toLocaleString()}</strong>
              </div>
            )}
          </section>
        </div>
        <footer className="page-footer">
          <span>
            <span className="footer-wordmark">w.</span> WareOnGo{' '}
            <span className="footer-divider">/</span> Ramesh workspace
          </span>
          <span>A fresh count with every restart.</span>
          <a className="text-link" href="#overview">
            Back to top <Icon name="upRight" />
          </a>
        </footer>
      </main>
    </div>
  );
}
