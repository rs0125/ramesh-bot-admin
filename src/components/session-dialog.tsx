'use client';
/** Reauthenticates without unmounting the workspace or persisting private drafts to browser storage. */
import { useEffect, useRef } from 'react';
import { LoginForm } from './login-form';
import { Icon } from './icon';

export function SessionDialog({ open, onResume }: { open: boolean; onResume: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog session-dialog"
      aria-labelledby="session-title"
      aria-describedby="session-description"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'input:not([disabled]), button:not([disabled]), a[href]',
          ),
        );
        const first = targets[0];
        const last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <span className="empty-icon">
        <Icon name="shield" />
      </span>
      <h2 id="session-title">Session expired</h2>
      <p id="session-description">Sign in here to continue without losing your drafts.</p>
      {open && <LoginForm onSuccess={onResume} submitLabel="Sign in and continue" autoFocus />}
      <a className="text-link session-leave" href="/login">
        Return to sign-in
      </a>
    </dialog>
  );
}
