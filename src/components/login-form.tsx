'use client';
/** Client form submits to the same-origin session endpoint; secrets are never persisted in JS storage. */
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icon';
import { readApiResponse, requestError } from '../lib/api-response';

export function LoginForm({
  onSuccess,
  submitLabel = 'Sign in',
  autoFocus = false,
}: {
  onSuccess?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [requestBusy, setBusy] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const busy = requestBusy || navigating;
  const [error, setError] = useState('');
  const [invalidPassword, setInvalidPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setInvalidPassword(false);
    const password = new FormData(event.currentTarget).get('password');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(20000),
      });
      setInvalidPassword(response.status === 401);
      await readApiResponse(response, 'Sign-in is temporarily unavailable. Please try again.');
      if (onSuccess) onSuccess();
      else {
        startNavigation(() => {
          router.replace('/');
          router.refresh();
        });
      }
    } catch (error) {
      setError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Signing in took too long. Check your connection and try again.'
          : requestError(error, 'Could not reach sign-in. Check your connection and try again.'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="login-form" aria-busy={busy}>
      <label htmlFor="password">Admin password</label>
      <div className="password-field">
        <input
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          autoFocus={autoFocus}
          required
          readOnly={busy}
          onChange={() => {
            if (error) setError('');
            setInvalidPassword(false);
          }}
          aria-invalid={invalidPassword}
          aria-describedby={error ? 'login-error' : undefined}
          placeholder="Enter your password"
        />
        <button
          type="button"
          className="icon-button password-toggle"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          disabled={busy}
          onClick={() => setShowPassword((value) => !value)}
        >
          <Icon name={showPassword ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {error && (
        <p id="login-error" role="alert" className="error-text">
          <Icon name="alert" /> {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? 'Signing in…' : submitLabel}
        <Icon name={busy ? 'refresh' : 'arrow'} className={busy ? 'spinning' : ''} />
      </button>
    </form>
  );
}
