'use client';

import { useEffect, useId, useRef } from 'react';

export function RepositoryRemovalDialog({
  name,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      trigger?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="repository-removal-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={`${id}-title`}>Remove repository?</h2>
      <p id={`${id}-description`}>
        Remove <strong>{name}</strong> and its associated sessions from your workspace?
      </p>
      <p className="removal-note">
        You can undo this removal. The snapshot and saved sessions are retained, and nothing on
        GitHub changes.
      </p>
      {error ? (
        <p role="alert" className="danger">
          {error}
        </p>
      ) : null}
      <div className="removal-dialog-actions">
        <button
          ref={cancel}
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="button" className="primary-button" disabled={pending} onClick={onConfirm}>
          {pending ? 'Removing…' : 'Remove repository'}
        </button>
      </div>
    </dialog>
  );
}
