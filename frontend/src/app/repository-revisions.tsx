'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import {
  getRepositoryBranches,
  getRepositoryCommits,
  prepareRepositoryRevision,
  WorkspaceRequestError,
  type GitHubBranches,
  type GitHubCommit,
} from '@/lib/workspace-api';

export type RepositoryRevision = GitHubCommit & { branch: string };

type Choice = 'branch' | 'commit';
type CommitOption = GitHubCommit & { page: number };
type CommitOptions = { branch: string; commits: CommitOption[]; nextPage: number | null };

function subject(message: string) {
  const line = message.split('\n', 1)[0]?.trim() || 'No commit message';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

export function RepositoryRevisions({
  repositoryId,
  savedSha,
  revision,
  csrfToken,
  onRevision,
}: {
  repositoryId: string;
  savedSha: string;
  revision: RepositoryRevision | null;
  csrfToken: string;
  onRevision: (revision: RepositoryRevision | null) => void;
}) {
  const [open, setOpen] = useState<Choice | null>(null);
  const [branches, setBranches] = useState<GitHubBranches>();
  const [commitOptions, setCommitOptions] = useState<CommitOptions>();
  const [pending, setPending] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const operation = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const commitTrigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const id = useId();
  const branch = revision?.branch ?? branches?.default_branch;
  const sha = revision?.sha ?? savedSha;

  useEffect(() => {
    const controller = new AbortController();
    void getRepositoryBranches(repositoryId, 1, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setBranches((current) => current ?? result);
      },
      () => {
        // Opening the picker can retry and display the server's error detail.
      },
    );
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [repositoryId]);

  useEffect(() => {
    if (!open) return;
    options.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function close(choice: Choice) {
    setOpen(null);
    (choice === 'branch' ? branchTrigger : commitTrigger).current?.focus();
  }

  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setFailure(undefined);
    setPending(label);
    try {
      await task(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(
          error instanceof WorkspaceRequestError && error.detail
            ? error.detail
            : 'Could not load GitHub history. Try again.',
        );
      }
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setPending(undefined);
    }
  }

  async function loadBranches(page: number, signal: AbortSignal) {
    const next = await getRepositoryBranches(repositoryId, page, signal);
    if (!signal.aborted) {
      setBranches((previous) =>
        page > 1 && previous
          ? { ...next, branches: [...new Set([...previous.branches, ...next.branches])] }
          : next,
      );
    }
    return next;
  }

  async function loadCommits(name: string, page: number, signal: AbortSignal) {
    const next = await getRepositoryCommits(repositoryId, name, page, signal);
    const rows = next.commits.map((commit) => ({ ...commit, page }));
    if (!signal.aborted) {
      setCommitOptions((previous) => ({
        branch: name,
        commits:
          page > 1 && previous?.branch === name
            ? [...new Map([...previous.commits, ...rows].map((row) => [row.sha, row])).values()]
            : rows,
        nextPage: next.next_page,
      }));
    }
    return rows;
  }

  async function preview(name: string, commit: CommitOption, signal: AbortSignal) {
    try {
      await prepareRepositoryRevision(
        repositoryId,
        { branch: name, page: commit.page, sha: commit.sha },
        csrfToken,
        signal,
      );
    } catch (error) {
      if (!signal.aborted) setCommitOptions(undefined);
      throw error;
    }
    if (!signal.aborted) onRevision({ branch: name, sha: commit.sha, message: commit.message });
  }

  function toggle(choice: Choice) {
    if (open === choice) {
      close(choice);
      return;
    }
    setFailure(undefined);
    setOpen(choice);
    if (choice === 'branch' && !branches) {
      void run('Loading branches…', (signal) => loadBranches(1, signal).then(() => undefined));
    }
    if (choice === 'commit' && (!branch || commitOptions?.branch !== branch)) {
      void run('Loading commits…', async (signal) => {
        const name = branch ?? (await loadBranches(1, signal)).default_branch;
        await loadCommits(name, 1, signal);
      });
    }
  }

  function selectBranch(name: string) {
    close('branch');
    void run('Opening branch…', async (signal) => {
      const [latest] = await loadCommits(name, 1, signal);
      if (!latest)
        throw new WorkspaceRequestError(404, 'no_commits', 'This branch has no commits.');
      await preview(name, latest, signal);
    });
  }

  const branchChoices = branches
    ? [...new Set([branches.default_branch, ...branches.branches])]
    : [];
  const commits = commitOptions?.branch === branch ? commitOptions : undefined;
  const notice = pending ? (
    <p className="revision-notice" role="status">
      {pending}
    </p>
  ) : failure ? (
    <p className="revision-notice danger" role="alert">
      {failure}
    </p>
  ) : null;

  return (
    <div
      className="revision-browser"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(null);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close(open);
      }}
    >
      <div className="revision-picker">
        <div className="revision-controls">
          <button
            className="revision-trigger"
            type="button"
            ref={branchTrigger}
            title={branch}
            aria-label={`Choose branch, ${branch ?? 'default branch'}`}
            aria-expanded={open === 'branch'}
            aria-controls={open === 'branch' ? id : undefined}
            aria-disabled={Boolean(pending)}
            onClick={() => {
              if (!operation.current) toggle('branch');
            }}
          >
            <Icon name="branch" />
            <bdi>{branch ?? 'Default branch'}</bdi>
            <Icon name="chevron" className="revision-chevron" />
          </button>
          <button
            className="revision-trigger revision-commit-trigger"
            type="button"
            ref={commitTrigger}
            title={sha}
            aria-label={`Choose commit, ${sha.slice(0, 7)}, ${revision ? subject(revision.message) : 'saved snapshot'}`}
            aria-expanded={open === 'commit'}
            aria-controls={open === 'commit' ? id : undefined}
            aria-disabled={Boolean(pending)}
            onClick={() => {
              if (!operation.current) toggle('commit');
            }}
          >
            <Icon name="commit" />
            <code>{sha.slice(0, 7)}</code>
            <bdi>{revision ? subject(revision.message) : 'Saved snapshot'}</bdi>
            <Icon name="chevron" className="revision-chevron" />
          </button>
        </div>
        {open ? (
          <div
            className="revision-options"
            id={id}
            ref={options}
            tabIndex={-1}
            role="group"
            aria-label={open === 'branch' ? 'Branches' : 'Commits'}
          >
            {notice}
            {open === 'branch' ? (
              <>
                {branchChoices.map((name) => (
                  <button
                    type="button"
                    key={name}
                    aria-current={name === branch ? 'true' : undefined}
                    disabled={Boolean(pending)}
                    onClick={() => selectBranch(name)}
                  >
                    <Icon name="branch" />
                    <bdi>{name}</bdi>
                    {name === branch ? <Icon name="check" /> : null}
                  </button>
                ))}
                {branches?.next_page ? (
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() => {
                      options.current?.focus();
                      const page = branches.next_page;
                      if (page)
                        void run('Loading branches…', (signal) =>
                          loadBranches(page, signal).then(() => undefined),
                        );
                    }}
                  >
                    More branches
                  </button>
                ) : null}
              </>
            ) : (
              <>
                {revision ? (
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() => {
                      close('commit');
                      onRevision(null);
                    }}
                  >
                    <Icon name="repo" />
                    Saved snapshot
                  </button>
                ) : null}
                {commits?.commits.map((commit) => (
                  <button
                    type="button"
                    key={commit.sha}
                    aria-current={commit.sha === sha ? 'true' : undefined}
                    title={subject(commit.message)}
                    disabled={Boolean(pending)}
                    onClick={() => {
                      if (!branch) return;
                      close('commit');
                      void run('Opening commit…', (signal) => preview(branch, commit, signal));
                    }}
                  >
                    <code>{commit.sha.slice(0, 7)}</code>
                    <bdi>{subject(commit.message)}</bdi>
                    {commit.sha === sha ? <Icon name="check" /> : null}
                  </button>
                ))}
                {commits && commits.commits.length === 0 ? (
                  <p className="revision-notice">No commits found on this branch.</p>
                ) : null}
                {commits?.nextPage && branch ? (
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() => {
                      options.current?.focus();
                      const page = commits.nextPage;
                      if (page)
                        void run('Loading commits…', (signal) =>
                          loadCommits(branch, page, signal).then(() => undefined),
                        );
                    }}
                  >
                    Older commits
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      {!open ? notice : null}
      {revision ? (
        <p className="revision-message" tabIndex={0}>
          {revision.message || 'No commit message'}
        </p>
      ) : null}
    </div>
  );
}
