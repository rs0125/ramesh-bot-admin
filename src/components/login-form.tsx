'use client';
/** Client form submits to the same-origin session endpoint; secrets are never persisted in JS storage. */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icon';

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const password = new FormData(event.currentTarget).get('password');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not sign in');
      router.replace('/');
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
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
          required
          aria-invalid={!!error}
          aria-describedby={error ? 'login-error' : undefined}
          placeholder="Enter your password"
        />
        <button
          type="button"
          className="icon-button password-toggle"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
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
        {busy ? 'Signing in…' : 'Open workspace'}
        <Icon name={busy ? 'refresh' : 'arrow'} className={busy ? 'spinning' : ''} />
      </button>
    </form>
  );
}
