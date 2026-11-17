'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import {
  getSnapshotSyncStatus,
  syncRepositorySnapshot,
  WorkspaceRequestError,
  type OwnedRepository,
} from '@/lib/workspace-api';

type Check = 'checking' | 'up-to-date' | 'behind' | 'unavailable';

export function useGitHubSync(
  repositoryId: string | undefined,
  csrfToken: string,
  disabled: boolean,
  onSynced: (snapshot: OwnedRepository) => void,
) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ repositoryId, attempt }), [repositoryId, attempt]);
  const [result, setResult] = useState<{ request: typeof request; check: Check; error?: string }>();
  const [syncingRepositoryId, setSyncingRepositoryId] = useState<string>();
  const pending = useRef(false);
  const current = result?.request === request ? result : undefined;
  const check = current?.check ?? 'checking';

  useEffect(() => {
    if (!request.repositoryId) return;
    const controller = new AbortController();
    void getSnapshotSyncStatus(request.repositoryId, controller.signal).then(
      ({ up_to_date }) => {
        if (!controller.signal.aborted) {
          setResult({ request, check: up_to_date ? 'up-to-date' : 'behind' });
        }
      },
      () => {
        if (!controller.signal.aborted) setResult({ request, check: 'unavailable' });
      },
    );
    return () => controller.abort();
  }, [request]);

  async function sync() {
    if (!repositoryId || disabled || pending.current || check !== 'behind') return false;
    pending.current = true;
    setSyncingRepositoryId(repositoryId);
    setResult({ request, check });
    try {
      const snapshot = await syncRepositorySnapshot(repositoryId, csrfToken);
      setResult((current) =>
        current?.request === request ? { request, check: 'up-to-date' } : current,
      );
      onSynced(snapshot);
      return true;
    } catch (cause) {
      const error =
        cause instanceof WorkspaceRequestError && cause.detail
          ? cause.detail
          : 'Could not sync the snapshot. Try again.';
      setResult((current) => (current?.request === request ? { request, check, error } : current));
      return false;
    } finally {
      pending.current = false;
      setSyncingRepositoryId(undefined);
    }
  }

  return {
    check,
    error: current?.error,
    syncing: syncingRepositoryId !== undefined && syncingRepositoryId === repositoryId,
    disabled: disabled || syncingRepositoryId !== undefined,
    sync,
    checkAgain: () => setAttempt((value) => value + 1),
  };
}

export function GitHubSync({
  commit,
  previewingHistory = false,
  state: { check, error, syncing, disabled, sync, checkAgain },
}: {
  commit: string;
  previewingHistory?: boolean;
  state: ReturnType<typeof useGitHubSync>;
}) {
  const statusText = useRef<HTMLSpanElement>(null);
  const status = {
    checking: 'Checking GitHub…',
    'up-to-date': 'Up to date',
    behind: 'Behind GitHub',
    unavailable: 'Could not check GitHub',
  }[check];

  return (
    <div className="github-sync">
      <div className="github-sync-controls">
        <span className="snapshot-caption">
          {previewingHistory ? 'Saved snapshot' : 'Snapshot'} {commit.slice(0, 7)} · Read-only
        </span>
        <div className="github-sync-actions">
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
              disabled={disabled}
              onClick={(event) => {
                const button = event.currentTarget;
                void sync().then((synced) => {
                  if (
                    synced &&
                    (document.activeElement === button || document.activeElement === document.body)
                  ) {
                    statusText.current?.focus({ preventScroll: true });
                  }
                });
              }}
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
            onClick={checkAgain}
          >
            <Icon name="sync" />
          </button>
        </div>
      </div>
      {error ? (
        <p className="github-sync-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
