'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
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
  selected: string | null;
  onSelect: (path: string, trigger: HTMLButtonElement) => void;
};

function DirectoryContents({
  repositoryId,
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
    void getRepositoryTree(repositoryId, directory, offset, controller.signal).then(
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
  }, [attempt, directory, offset, repositoryId]);

  return (
    <ul className="source-tree-list">
      {page?.entries.map((entry) => (
        <TreeRow key={entry.path} {...{ repositoryId, selected, onSelect, entry }} />
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

const highlighter = createLowlight(common);
const languageAliases: Record<string, string> = {
  tsx: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  svg: 'xml',
  cs: 'csharp',
  yml: 'yaml',
  dockerfile: 'dockerfile',
};

function highlightedCode(path: string, text: string): ReactNode {
  const name = path.split('/').at(-1)?.toLowerCase() ?? '';
  const extension = name.split('.').at(-1) ?? '';
  const language = Object.hasOwn(languageAliases, extension)
    ? languageAliases[extension]
    : extension;
  if (!highlighter.registered(language)) return text;
  // Lowlight returns text and styled spans. Render only those as React nodes.
  const tree = highlighter.highlight(language, text);
  type Token = (typeof tree.children)[number];
  function render(token: Token, index: number): ReactNode {
    if (token.type === 'text') return token.value;
    if (token.type !== 'element') return null;
    const classes = token.properties.className;
    return (
      <span key={index} className={Array.isArray(classes) ? classes.join(' ') : undefined}>
        {token.children.map(render)}
      </span>
    );
  }
  return tree.children.map(render);
}

function FilePreview({ repositoryId, path }: { repositoryId: string; path: string }) {
  const [start, setStart] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    start: number;
    file?: RepositoryFilePreview;
    error?: string;
  }>();
  const current = result?.start === start ? result : undefined;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getRepositoryFile(repositoryId, path, start, controller.signal).then(
      (file) => {
        if (!controller.signal.aborted) {
          setResult({ start, file });
          scroll.current?.scrollTo(0, 0);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setResult({ start, error: errorMessage(cause, 'Could not open this file.') });
      },
    );
    return () => controller.abort();
  }, [attempt, path, repositoryId, start]);
  const file = current?.file;
  const code = useMemo(
    () => (file ? highlightedCode(path, file.lines.join('\n')) : null),
    [file, path],
  );

  if (!current)
    return (
      <p className="source-preview-message" role="status">
        Opening file…
      </p>
    );
  if (current.error)
    return (
      <div className="source-preview-message">
        <p role="alert">{current.error}</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setResult(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          Retry file
        </button>
      </div>
    );
  if (!file || file.lines.length === 0)
    return <p className="source-preview-message">This file has no previewable lines.</p>;
  return (
    <>
      <div
        className="source-code-scroll"
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-label="File contents"
      >
        <div className="source-code-lines" aria-hidden="true">
          {file.lines.map((_, index) => (
            <div key={index}>{file.start_line + index}</div>
          ))}
        </div>
        <pre>
          <code>
            {code}
            {'\n'}
          </code>
        </pre>
      </div>
      {start > 1 || file.has_more ? (
        <div className="source-code-pages">
          <button
            type="button"
            className="secondary-button"
            disabled={start === 1}
            onClick={() => setStart(Math.max(1, start - 200))}
          >
            Previous
          </button>
          <span>
            Lines {file.start_line}–{file.end_line}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={!file.has_more}
            onClick={() => setStart(file.end_line + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

export function RepositoryCode({ repositoryId }: { repositoryId: string | undefined }) {
  const [path, setPath] = useState<string | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const previous = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef<'preview' | 'tree' | null>(null);

  useEffect(() => {
    if (moveFocus.current === 'preview') heading.current?.focus();
    if (moveFocus.current === 'tree') previous.current?.focus();
    moveFocus.current = null;
  }, [mobilePreview, path]);

  if (!repositoryId)
    return <p className="source-preview-message">Select a repository to browse its files.</p>;
  return (
    <div className="source-browser" data-mobile-preview={mobilePreview}>
      <nav className="source-tree" aria-label="Repository files">
        <h3>Files</h3>
        <DirectoryContents
          repositoryId={repositoryId}
          directory="."
          selected={path}
          onSelect={(next, trigger) => {
            previous.current = trigger;
            if (window.matchMedia('(max-width: 1100px)').matches) moveFocus.current = 'preview';
            setPath(next);
            setMobilePreview(true);
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
                  setMobilePreview(false);
                }}
              >
                Files
              </button>
              <h3 ref={heading} tabIndex={-1} title={path}>
                <Icon name="file" />
                <bdi>{path}</bdi>
              </h3>
            </div>
            <FilePreview key={path} repositoryId={repositoryId} path={path} />
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
