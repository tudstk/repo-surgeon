'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import {
  getSnapshotSyncStatus,
  syncRepositorySnapshot,
  WorkspaceRequestError,
  type OwnedRepository,
} from '@/lib/workspace-api';

type Check = 'checking' | 'up-to-date' | 'behind' | 'unavailable';

export function GitHubSync({
  repositoryId,
  csrfToken,
  disabled,
  onSynced,
}: {
  repositoryId: string;
  csrfToken: string;
  disabled: boolean;
  onSynced: (snapshot: OwnedRepository) => void;
}) {
  const [check, setCheck] = useState<Check>('checking');
  const [attempt, setAttempt] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(false);
  const statusText = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getSnapshotSyncStatus(repositoryId, controller.signal).then(
      ({ up_to_date }) => {
        if (!controller.signal.aborted) setCheck(up_to_date ? 'up-to-date' : 'behind');
      },
      () => {
        if (!controller.signal.aborted) setCheck('unavailable');
      },
    );
    return () => controller.abort();
  }, [repositoryId, attempt]);

  async function sync() {
    if (disabled || pending.current || check !== 'behind') return;
    pending.current = true;
    setSyncing(true);
    setError(undefined);
    try {
      const snapshot = await syncRepositorySnapshot(repositoryId, csrfToken);
      if (!mounted.current) return;
      statusText.current?.focus({ preventScroll: true });
      setCheck('up-to-date');
      onSynced(snapshot);
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof WorkspaceRequestError && cause.detail
            ? cause.detail
            : 'Could not sync the snapshot. Try again.',
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSyncing(false);
    }
  }

  const status = {
    checking: 'Checking GitHub…',
    'up-to-date': 'Up to date',
    behind: 'Behind GitHub',
    unavailable: 'Could not check GitHub',
  }[check];

  return (
    <div className="github-sync">
      <div className="github-sync-controls">
        <span
          ref={statusText}
          tabIndex={-1}
          role="status"
          className="github-sync-status"
          data-check={check}
        >
          {status}
        </span>
        {check === 'behind' ? (
          <button
            type="button"
            className="secondary-button github-sync-button"
            disabled={disabled || syncing}
            onClick={() => void sync()}
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button github-sync-check"
          aria-label="Check GitHub for updates"
          title="Check GitHub for updates"
          disabled={check === 'checking' || syncing}
          onClick={() => {
            setCheck('checking');
            setError(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          <Icon name="sync" />
        </button>
      </div>
      {error ? (
        <p className="github-sync-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
