'use client';
/** Native modal protects in-memory drafts; cancellation returns focus to the sign-out control. */
import { useEffect, useRef } from 'react';
import { Icon } from './icon';

export function SignOutDialog({
  open,
  draftCount,
  pendingCount,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  draftCount: number;
  pendingCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const discardDrafts = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="sign-out-title"
      aria-describedby="sign-out-description"
      onCancel={onCancel}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        if (event.shiftKey && document.activeElement === keepEditing.current) {
          event.preventDefault();
          discardDrafts.current?.focus();
        } else if (!event.shiftKey && document.activeElement === discardDrafts.current) {
          event.preventDefault();
          keepEditing.current?.focus();
        }
      }}
    >
      <span className="empty-icon">
        <Icon name="message" />
      </span>
      <h2 id="sign-out-title">
        {draftCount ? 'Discard drafts and sign out?' : 'Messages submitted'}
      </h2>
      <p id="sign-out-description">
        {draftCount ? (
          <>
            Signing out will discard drafts in {draftCount}{' '}
            {draftCount === 1 ? 'conversation' : 'conversations'}.
          </>
        ) : (
          'No unsent drafts remain. Check message status in the inbox.'
        )}
      </p>
      {pendingCount > 0 && (
        <p className="pending-send-note">
          {pendingCount} {pendingCount === 1 ? 'message is' : 'messages are'} awaiting confirmation.
          Signing out won’t cancel messages already submitted.
        </p>
      )}
      <div className="dialog-actions">
        <button ref={keepEditing} className="button primary" autoFocus onClick={onCancel}>
          {draftCount ? 'Keep drafts' : 'Back to inbox'}
        </button>
        <button ref={discardDrafts} className="button secondary" onClick={onConfirm}>
          {draftCount ? 'Discard drafts and sign out' : 'Sign out'}
        </button>
      </div>
    </dialog>
  );
}
