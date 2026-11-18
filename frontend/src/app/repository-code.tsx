'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { highlightedCodeLines } from '@/lib/code-highlight';
import { Icon } from '@/components/ui/icons';
import {
  getRepositoryFile,
  getRepositoryTree,
  WorkspaceRequestError,
  type RepositoryFilePreview,
  type RepositoryTreeEntry,
  type RepositoryTreePage,
} from '@/lib/workspace-api';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof WorkspaceRequestError && error.detail ? error.detail : fallback;
}

type TreeProps = {
  repositoryId: string;
  revision?: string;
  selected: string | null;
  onSelect: (path: string, trigger: HTMLButtonElement) => void;
};

function DirectoryContents({
  repositoryId,
  revision,
  directory,
  selected,
  onSelect,
}: TreeProps & { directory: string }) {
  const [page, setPage] = useState<RepositoryTreePage>();
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [settledOffset, setSettledOffset] = useState<number>();
  const loading = settledOffset !== offset && !error;

  useEffect(() => {
    const controller = new AbortController();
    void getRepositoryTree(repositoryId, directory, offset, controller.signal, revision).then(
      (result) => {
        if (controller.signal.aborted) return;
        setPage((previous) => ({
          ...result,
          entries: offset && previous ? [...previous.entries, ...result.entries] : result.entries,
        }));
        setSettledOffset(offset);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, 'Could not load this folder.'));
      },
    );
    return () => controller.abort();
  }, [attempt, directory, offset, repositoryId, revision]);

  return (
    <ul className="source-tree-list">
      {page?.entries.map((entry) => (
        <TreeRow key={entry.path} {...{ repositoryId, revision, selected, onSelect, entry }} />
      ))}
      {loading ? (
        <li className="source-tree-note" role="status">
          Loading files…
        </li>
      ) : null}
      {error ? (
        <li className="source-tree-note">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Retry folder
          </button>
        </li>
      ) : null}
      {!loading && !error && page ? (
        <>
          {page.entries.length === 0 ? (
            <li className="source-tree-note">No browsable files here.</li>
          ) : null}
          {page.next_offset !== null ? (
            <li className="source-tree-note">
              <button type="button" onClick={() => setOffset(page.next_offset ?? 0)}>
                More files
              </button>
            </li>
          ) : page.scan_limit_reached ? (
            <li className="source-tree-note">Folder listing limit reached.</li>
          ) : null}
        </>
      ) : null}
    </ul>
  );
}

function TreeRow({ entry, ...props }: TreeProps & { entry: RepositoryTreeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (entry.kind === 'directory') {
    return (
      <li>
        <button
          type="button"
          className="source-tree-row"
          title={entry.path}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="chevron" className="source-tree-chevron" />
          <Icon name="folder" />
          <span>{entry.name}</span>
        </button>
        <div id={id} className="source-tree-branch" hidden={!expanded}>
          {expanded ? <DirectoryContents {...props} directory={entry.path} /> : null}
        </div>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className="source-tree-row source-tree-file"
        title={entry.path}
        aria-current={props.selected === entry.path ? 'true' : undefined}
        onClick={(event) => props.onSelect(entry.path, event.currentTarget)}
      >
        <Icon name="file" />
        <span>{entry.name}</span>
      </button>
    </li>
  );
}

function FilePreview({
  repositoryId,
  revision,
  path,
}: {
  repositoryId: string;
  revision?: string;
  path: string;
}) {
  const [start, setStart] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<RepositoryFilePreview>();
  const [error, setError] = useState<string>();
  const scroll = useRef<HTMLDivElement>(null);
  const pendingMore = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getRepositoryFile(repositoryId, path, start, controller.signal, revision).then(
      (next) => {
        if (controller.signal.aborted) return;
        setFile((previous) =>
          previous && start > 1
            ? {
                ...previous,
                end_line: next.end_line,
                has_more: next.has_more,
                lines: [...previous.lines, ...next.lines],
              }
            : next,
        );
        pendingMore.current = false;
        setLoadingMore(false);
        setError(undefined);
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        pendingMore.current = false;
        setLoadingMore(false);
        setError(errorMessage(cause, 'Could not open this file.'));
      },
    );
    return () => controller.abort();
  }, [attempt, path, repositoryId, revision, start]);
  const code = useMemo(
    () => (file ? highlightedCodeLines(path, file.lines.join('\n')) : null),
    [file, path],
  );
  const retry = () => {
    setError(undefined);
    setAttempt((value) => value + 1);
  };

  if (!file) {
    return error ? (
      <div className="source-preview-message">
        <p role="alert">{error}</p>
        <button type="button" className="secondary-button" onClick={retry}>
          Retry file
        </button>
      </div>
    ) : (
      <p className="source-preview-message" role="status">
        Opening file…
      </p>
    );
  }
  if (file.lines.length === 0) {
    return <p className="source-preview-message">This file has no previewable lines.</p>;
  }
  return (
    <div
      className="source-code-scroll"
      ref={scroll}
      tabIndex={0}
      role="region"
      aria-label="File contents"
    >
      {file.lines.map((_, index) => (
        <div className="source-code-row" key={index}>
          <span className="source-line-number" aria-hidden="true">
            {file.start_line + index}
          </span>
          <pre>
            <code>{code?.[index]}</code>
          </pre>
        </div>
      ))}
      {file.has_more ? (
        <div className="source-code-more">
          {error ? <p role="alert">{error}</p> : null}
          {loadingMore ? (
            <span role="status">Loading lines…</span>
          ) : (
            <button
              type="button"
              className="source-more-link"
              onClick={() => {
                if (pendingMore.current) return;
                pendingMore.current = true;
                setLoadingMore(true);
                scroll.current?.focus({ preventScroll: true });
                if (error) setAttempt((value) => value + 1);
                else setStart(file.end_line + 1);
              }}
            >
              View more
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RepositoryCode({
  repositoryId,
  revision,
}: {
  repositoryId: string | undefined;
  revision?: string;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [compactPreview, setCompactPreview] = useState(false);
  const browser = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef<'preview' | 'tree' | null>(null);

  useEffect(() => {
    if (moveFocus.current === 'preview') heading.current?.focus();
    if (moveFocus.current === 'tree') previous.current?.focus();
    moveFocus.current = null;
  }, [compactPreview, path]);

  if (!repositoryId)
    return <p className="source-preview-message">Select a repository to browse its files.</p>;
  return (
    <div ref={browser} className="source-browser" data-compact-preview={compactPreview}>
      <nav className="source-tree" aria-label="Repository files">
        <h3>Files</h3>
        <DirectoryContents
          repositoryId={repositoryId}
          revision={revision}
          directory="."
          selected={path}
          onSelect={(next, trigger) => {
            previous.current = trigger;
            if (
              window.matchMedia('(max-width: 1100px)').matches ||
              (browser.current && browser.current.getBoundingClientRect().width <= 380)
            )
              moveFocus.current = 'preview';
            setPath(next);
            setCompactPreview(true);
          }}
        />
      </nav>
      <section className="source-preview" aria-label="Code preview">
        {path ? (
          <>
            <div className="source-file-header">
              <button
                type="button"
                className="secondary-button source-back"
                onClick={() => {
                  moveFocus.current = 'tree';
                  setCompactPreview(false);
                }}
              >
                Files
              </button>
              <h3 ref={heading} tabIndex={-1} title={path}>
                <Icon name="file" />
                <bdi>{path}</bdi>
              </h3>
            </div>
            <FilePreview key={path} repositoryId={repositoryId} revision={revision} path={path} />
          </>
        ) : (
          <div className="source-preview-message source-preview-empty">
            <Icon name="code" />
            <h3>Select a file</h3>
            <p>Open a folder to browse source from the selected repository.</p>
          </div>
        )}
      </section>
    </div>
  );
}
