'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import {
  getPullRequestChanges,
  listPullRequests,
  WorkspaceRequestError,
  type GitHubPullRequest,
  type PullRequestChanges,
  type PullRequestState,
} from '@/lib/workspace-api';
import { DiffCounts, PullRequestDiff, type DiffLayout } from './pull-request-diff';
import styles from './repository-pull-requests.module.css';

type LoadResult<T> = { value: T } | { error: string };

const pullDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const statusLabels = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' };

function usePullRequestData<T>(
  load: (signal: AbortSignal) => Promise<T>,
  active: boolean,
  fallbackError: string,
) {
  const [settled, setSettled] = useState<{ load: typeof load; result: LoadResult<T> }>();
  const result = settled?.load === load ? settled.result : undefined;
  useEffect(() => {
    if (!active || result) return;
    const controller = new AbortController();
    void load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setSettled({ load, result: { value } });
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        const error = reason instanceof WorkspaceRequestError ? reason.detail : undefined;
        setSettled({ load, result: { error: error || fallbackError } });
      },
    );
    return () => controller.abort();
  }, [active, fallbackError, load, result]);
  return {
    result,
    lastValue: settled && 'value' in settled.result ? settled.result.value : undefined,
    retry: () => setSettled(undefined),
  };
}

function LoadFailure({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className={styles.message}>
      <p role="alert">{text}</p>
      <button type="button" className="secondary-button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

function Pagination({
  page,
  nextPage,
  onPage,
  subject,
}: {
  page: number;
  nextPage: number | null;
  onPage: (page: number) => void;
  subject: string;
}) {
  if (page === 1 && nextPage === null) return null;
  return (
    <nav className={styles.pagination} aria-label={`${subject} pages`}>
      <button
        type="button"
        className="secondary-button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>Page {page}</span>
      <button
        type="button"
        className="secondary-button"
        disabled={nextPage === null}
        onClick={() => nextPage !== null && onPage(nextPage)}
      >
        Next
      </button>
    </nav>
  );
}

function PullList({
  repositoryId,
  active,
  category,
  page,
  onPage,
  onSelect,
}: {
  repositoryId: string;
  active: boolean;
  category: PullRequestState;
  page: number;
  onPage: (page: number) => void;
  onSelect: (pull: GitHubPullRequest, trigger: HTMLButtonElement) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => listPullRequests(repositoryId, category, page, signal),
    [repositoryId, category, page],
  );
  const { result, retry } = usePullRequestData(load, active, 'Could not load pull requests.');
  if (!result)
    return (
      <p className={styles.message} role="status">
        Loading pull requests…
      </p>
    );
  if ('error' in result) return <LoadFailure text={result.error} retry={retry} />;
  return (
    <>
      {result.value.pulls.length ? (
        <ul className={styles.pullList}>
          {result.value.pulls.map((pull) => (
            <li key={pull.number}>
              <button
                type="button"
                className={styles.pullRow}
                onClick={(event) => onSelect(pull, event.currentTarget)}
              >
                <Icon name="pull-request" className={styles.pullIcon} />
                <span className={styles.rowBody}>
                  <strong>
                    <bdi>{pull.title}</bdi>
                  </strong>
                  <span className={styles.rowMeta}>
                    <span>
                      #{pull.number}
                      {pull.author ? (
                        <>
                          {' '}
                          · <bdi>{pull.author}</bdi>
                        </>
                      ) : null}
                    </span>
                    <PullStatus pull={pull} />
                    <time dateTime={pull.updated_at}>
                      {pullDate.format(new Date(pull.updated_at))}
                    </time>
                  </span>
                </span>
                <Icon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.message}>
          <Icon name="pull-request" />
          <h3>No {category} pull requests</h3>
          {category === 'closed' ? <p>Merged pull requests appear here too.</p> : null}
        </div>
      )}
      <Pagination
        page={page}
        nextPage={result.value.next_page}
        onPage={onPage}
        subject="Pull request"
      />
    </>
  );
}

function PullStatus({ pull }: { pull: GitHubPullRequest }) {
  return (
    <span className={styles.pullStatus} data-status={pull.status}>
      {statusLabels[pull.status]}
    </span>
  );
}

function FileChanges({
  changes,
  layout,
  onLayout,
}: {
  changes: PullRequestChanges;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
}) {
  const [fileIndex, setFileIndex] = useState(0);
  const file = changes.files[fileIndex];
  return (
    <>
      {changes.files.length ? (
        <label className={styles.filePicker}>
          <span>Changed files on this page</span>
          <select value={fileIndex} onChange={(event) => setFileIndex(Number(event.target.value))}>
            {changes.files.map((entry, index) => (
              <option key={entry.path} value={index}>
                {entry.path} · {entry.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {changes.restricted_files !== 0 ? (
        <p className={styles.notice}>
          {changes.restricted_files}{' '}
          {changes.restricted_files === 1 ? 'file hidden' : 'files hidden'} by repository safety
          rules.
        </p>
      ) : null}
      {file ? (
        <PullRequestDiff key={file.path} file={file} layout={layout} onLayout={onLayout} />
      ) : null}
      {!file && !changes.restricted_files ? (
        <p className={styles.message}>No changed files on this page.</p>
      ) : null}
      {changes.file_limit_reached ? (
        <p className={styles.notice}>
          GitHub returns at most 3,000 changed files. Open the pull request on GitHub to see more.
        </p>
      ) : null}
    </>
  );
}

function PullDetails({
  repositoryId,
  selection,
  active,
  layout,
  onLayout,
  onBack,
}: {
  repositoryId: string;
  selection: GitHubPullRequest;
  active: boolean;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(1);
  const reviewNote = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const load = useCallback(
    (signal: AbortSignal) => getPullRequestChanges(repositoryId, selection.number, page, signal),
    [repositoryId, selection.number, page],
  );
  const { result, lastValue, retry } = usePullRequestData(
    load,
    active,
    'Could not load changed files.',
  );
  return (
    <div className={styles.view}>
      <header className={styles.detailHeader}>
        <div className={styles.detailNav}>
          <button type="button" className={styles.back} onClick={onBack}>
            <Icon name="chevron" /> All pull requests
          </button>
          <a href={selection.url} target="_blank" rel="noreferrer">
            GitHub <Icon name="external" />
          </a>
        </div>
        <div className={styles.detailTitle}>
          <h3 ref={heading} tabIndex={-1}>
            <bdi>{selection.title}</bdi> <span>#{selection.number}</span>
          </h3>
          {lastValue ? (
            <div className={styles.changesSummary} role="group" aria-label="Pull request totals">
              <span>
                {lastValue.changed_files.toLocaleString()}{' '}
                {lastValue.changed_files === 1 ? 'file' : 'files'} changed
              </span>
              <DiffCounts additions={lastValue.additions} deletions={lastValue.deletions} />
            </div>
          ) : null}
        </div>
        <div className={styles.detailMeta}>
          <PullStatus pull={selection} />
          {selection.author ? <bdi>{selection.author}</bdi> : null}
          <span className={styles.branchPair}>
            <bdi>{selection.head_ref}</bdi>
            <Icon name="arrow" />
            <bdi>{selection.base_ref}</bdi>
          </span>
        </div>
        <div className={styles.review}>
          <button type="button" className="secondary-button" disabled aria-describedby={reviewNote}>
            <Icon name="check" /> Code Review this PR
          </button>
          <span id={reviewNote}>Code review is coming in a later release.</span>
        </div>
      </header>
      {!result ? (
        <p className={styles.message} role="status">
          Loading changed files…
        </p>
      ) : 'error' in result ? (
        <LoadFailure text={result.error} retry={retry} />
      ) : (
        <>
          <Pagination
            page={page}
            nextPage={result.value.next_page}
            onPage={setPage}
            subject="Changed file"
          />
          <FileChanges key={page} changes={result.value} layout={layout} onLayout={onLayout} />
        </>
      )}
    </div>
  );
}

export function RepositoryPullRequests({
  repositoryId,
  active,
}: {
  repositoryId?: string;
  active: boolean;
}) {
  const [category, setCategory] = useState<PullRequestState>('open');
  const [listPage, setListPage] = useState(1);
  const [selection, setSelection] = useState<GitHubPullRequest>();
  const [layout, setLayout] = useState<DiffLayout>('unified');
  const lastRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) lastRow.current?.focus({ preventScroll: true });
  }, [selection]);

  if (!repositoryId) {
    return (
      <p className={styles.message}>
        Select an imported GitHub repository to browse its pull requests.
      </p>
    );
  }

  return (
    <>
      <div className={styles.view} hidden={Boolean(selection)}>
        <div className={styles.listHeader} role="group" aria-label="Pull request status">
          {(['open', 'closed'] as const).map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={state === category}
              onClick={() => {
                if (state === category) return;
                setCategory(state);
                setListPage(1);
              }}
            >
              {state === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
        <PullList
          key={`${category}-${listPage}`}
          repositoryId={repositoryId}
          active={active && !selection}
          category={category}
          page={listPage}
          onPage={setListPage}
          onSelect={(pull, trigger) => {
            lastRow.current = trigger;
            setSelection(pull);
          }}
        />
      </div>
      {selection ? (
        <PullDetails
          key={selection.number}
          repositoryId={repositoryId}
          selection={selection}
          active={active}
          layout={layout}
          onLayout={setLayout}
          onBack={() => setSelection(undefined)}
        />
      ) : null}
    </>
  );
}
