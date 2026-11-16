'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function SessionActionDialog({
  name,
  action,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  action: 'rename' | 'remove';
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState(name);
  const id = useId();
  const rename = action === 'rename';
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    if (rename) {
      input.current?.focus();
      input.current?.select();
    } else cancel.current?.focus();
    return () => {
      element?.close();
      trigger?.focus();
    };
  }, [rename]);

  return (
    <dialog
      ref={dialog}
      className="repository-removal-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && (!rename || title.trim())) onConfirm(title.trim());
        }}
      >
        <h2 id={`${id}-title`}>{rename ? 'Rename session' : 'Remove session?'}</h2>
        {rename ? (
          <div className="session-name-field">
            <label htmlFor={`${id}-name`}>Session name</label>
            <input
              ref={input}
              id={`${id}-name`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              disabled={pending}
            />
          </div>
        ) : (
          <>
            <p>
              Confirm that you want to remove <strong>{name}</strong> from your workspace.
            </p>
            <p className="removal-note">
              Saved history is retained. The repository and your other sessions stay available.
            </p>
          </>
        )}
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
          <button
            type="submit"
            className="primary-button"
            disabled={pending || (rename && !title.trim())}
          >
            {pending ? (rename ? 'Saving…' : 'Removing…') : rename ? 'Save name' : 'Remove session'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
