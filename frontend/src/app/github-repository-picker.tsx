'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icons';
import {
  searchPublicGitHubRepositories,
  type PublicGitHubRepository,
  WorkspaceRequestError,
} from '@/lib/workspace-api';
import styles from './github-repository-picker.module.css';

const queryPattern = /^(?:[a-z0-9._-]+(?: +[a-z0-9._-]+)*|[a-z0-9-]+\/[a-z0-9._-]+)$/i;

type SearchResult = {
  query: string;
  attempt: number;
  repositories: PublicGitHubRepository[];
  error?: string;
};

export function GitHubRepositoryPicker({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [input, setInput] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SearchResult>();
  const query = input.trim();
  const valid = query.length >= 3 && queryPattern.test(query);
  const current = valid && result?.query === query && result.attempt === attempt ? result : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    searchRef.current?.focus();
    return () => {
      dialog.close();
      trigger?.focus();
    };
  }, []);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      void searchPublicGitHubRepositories(query, controller.signal)
        .then((repositories) => {
          if (!controller.signal.aborted) setResult({ query, attempt, repositories });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof WorkspaceRequestError && error.status === 429
              ? 'GitHub search is rate-limited. Try again in a minute.'
              : 'GitHub search is unavailable. Try again.';
          setResult({ query, attempt, repositories: [], error: message });
        });
    }, 500);
    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [attempt, query, valid]);

  let status = 'Enter at least three characters.';
  if (query.length >= 3 && !valid) status = 'Search by repository name or owner/repository.';
  if (valid && !current) status = 'Searching GitHub…';
  if (current) {
    const count = current.repositories.length;
    status =
      current.error ??
      (count
        ? `${count} public ${count === 1 ? 'result' : 'results'}`
        : 'No public repositories found.');
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div>
            <h2 id={`${id}-title`}>Find a GitHub repository</h2>
            <p id={`${id}-intro`}>Search public repositories by name or owner/repository.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close repository search"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className={styles.search}>
          <label htmlFor={`${id}-search`}>Search GitHub</label>
          <input
            ref={searchRef}
            id={`${id}-search`}
            type="search"
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. pallets/flask"
            value={input}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next.trim() !== query) setResult(undefined);
              setInput(next);
            }}
          />
        </div>
        <div className={styles.results}>
          <p className={styles.status} role="status">
            {status}
          </p>
          {current?.error ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                searchRef.current?.focus();
                setAttempt((value) => value + 1);
              }}
            >
              Retry search
            </button>
          ) : null}
          {current?.repositories.length ? (
            <ul aria-label="Public GitHub repositories">
              {current.repositories.map(({ full_name, owner_avatar_url }) => (
                <li key={full_name}>
                  <a href={`https://github.com/${full_name}`} target="_blank" rel="noreferrer">
                    <Avatar className={styles.avatar} name={full_name} url={owner_avatar_url} />
                    <span>{full_name}</span>
                    <Icon name="arrow" />
                    <span className="sr-only"> (opens GitHub in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className={styles.footer}>
          Repository import and private access are still in development.
        </p>
      </div>
    </dialog>
  );
}
