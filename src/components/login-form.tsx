'use client';
/** Client form submits to the same-origin session endpoint; secrets are never persisted in JS storage. */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    <form onSubmit={submit} className="login-form">
      <label htmlFor="password">Admin password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        placeholder="Enter your admin password"
      />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Open workspace →'}
      </button>
    </form>
  );
}
