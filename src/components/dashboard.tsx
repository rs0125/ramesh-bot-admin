'use client';
/** Live view of worker state. Polling stops on unmount and never overlaps itself. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotAction, BotStatus } from '../lib/worker-api';
import { PairingCode } from './pairing-code';

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
  const revision = useRef(0);
  const controlPending = useRef(false);

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

  const connected = status?.state === 'connected' && fresh;
  const inactive = status?.state === 'stopped' || status?.state === 'error';
  const label =
    fresh && status ? labels[status.state] : status ? 'Worker unavailable' : 'Checking connection';
  const metrics = status?.metrics;

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">w.</span>
          <strong>WareOnGo</strong>
        </div>
        <div className="workspace-label">SALES WORKSPACE</div>
        <div className="nav-item active">
          <span>◉</span> Bot overview <span className="nav-dot" />
        </div>
        <div className="sidebar-note">
          <span className="small-label">CURRENT CAPABILITY</span>
          <strong>A simple hello.</strong>
          <p>Direct messages and group mentions, with one reply per message.</p>
        </div>
        <div className="sidebar-bottom">
          <span className={`status-dot ${connected ? 'online' : ''}`} />
          {connected ? 'WhatsApp connected' : 'Waiting for connection'}
          <button onClick={signOut} disabled={logoutBusy} className="signout">
            {logoutBusy ? 'Signing out…' : 'Sign out ↗'}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace /</span> Overview
          </div>
          <span className="admin-badge">Admin</span>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <span className="eyebrow">WHATSAPP OPERATIONS</span>
              <h1>Bot overview</h1>
              <p className="muted">One place to connect your account and see what’s happening.</p>
            </div>
            <span className={`status-badge ${connected ? 'connected' : ''}`}>
              <span className="status-dot" />
              {label}
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <section className="metrics" aria-label="Activity since worker start">
            {[
              ['Messages received', metrics?.received, 'Text messages seen this session'],
              ['Hello replies', metrics?.replied, 'Successfully submitted'],
              ['Duplicates skipped', metrics?.duplicates, 'Kept out of the conversation'],
            ].map(([title, value, detail]) => (
              <div className="metric" key={String(title)}>
                <span>{title}</span>
                <strong>{value ?? '—'}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </section>
          <div className="content-grid">
            <section className="panel connection-panel">
              <div className="panel-heading">
                <div>
                  <h2>WhatsApp connection</h2>
                  <p className="muted">Your bot’s linked account</p>
                </div>
                <span className="panel-icon">↗</span>
              </div>
              <div className={`pairing-stage ${connected ? 'is-connected' : ''}`}>
                {fresh && status?.state === 'pairing' && status.qr ? (
                  <PairingCode value={status.qr} />
                ) : (
                  <div className="connection-art">
                    <span className="connection-orbit" />
                    <span className="connection-symbol">{connected ? '✓' : '↗'}</span>
                  </div>
                )}
                <h3>
                  {connected
                    ? 'You’re connected'
                    : status?.state === 'pairing' && fresh
                      ? 'Scan to link your account'
                      : 'Bring your bot online'}
                </h3>
                <p>
                  {connected
                    ? 'Send a message or mention the bot in a group. It will reply hello.'
                    : status?.state === 'pairing' && fresh
                      ? 'Open WhatsApp → Settings → Linked devices → Link a device.'
                      : 'Connect WhatsApp to start receiving DMs and group mentions.'}
                </p>
              </div>
              <div className="connection-actions">
                <button
                  className="button primary"
                  disabled={!!busy || !fresh}
                  onClick={() => void control(inactive ? 'connect' : 'reconnect')}
                >
                  {busy === 'connect' || busy === 'reconnect'
                    ? 'Working…'
                    : inactive
                      ? 'Connect WhatsApp ↗'
                      : 'Reconnect'}
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy || !fresh || inactive}
                  onClick={() => void control('disconnect')}
                >
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
              <p className="panel-footnote">
                Disconnect pauses the bot until you connect again, including after restarts.
              </p>
            </section>
            <section className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p className="muted">Latest events from this worker</p>
                </div>
                <span className={`live-indicator ${fresh ? 'live' : ''}`}>
                  {fresh ? 'LIVE' : 'OFFLINE'}
                </span>
              </div>
              <div className="event-list">
                {status?.events.length ? (
                  status.events.map((event, index) => (
                    <div className="event" key={`${event.at}-${index}`}>
                      <span className={`event-dot ${event.level}`} />
                      <div>
                        <p>{event.message}</p>
                        <time dateTime={event.at}>
                          {new Date(event.at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </time>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <span>≋</span>
                    <h3>A quiet start</h3>
                    <p>Connection updates and replies will appear here.</p>
                  </div>
                )}
              </div>
              <div className="activity-footer">
                <span>Delivery errors</span>
                <strong>{metrics?.errors ?? '—'}</strong>
              </div>
              {!!metrics?.dropped && (
                <div className="activity-footer">
                  <span>Skipped while busy</span>
                  <strong>{metrics.dropped}</strong>
                </div>
              )}
            </section>
          </div>
          <footer className="page-footer">
            <span>Sales bot · WareOnGo</span>
            <span>Activity counters reset when the worker restarts.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
