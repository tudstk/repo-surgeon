'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  RepositorySummaryCard,
  InvestigationPanel,
  type InvestigationEvidence,
  type InvestigationResult,
  SearchActivityRow,
  type RepositorySummary,
  type SearchActivity,
  type SearchCitation,
} from './repository-search-display';

const STACKED_LAYOUT_QUERY = '(max-width: 1024px)';

type RegisteredRepository = {
  id: string;
  name: string;
};

// Module-scoped helpers are intentional in this client component.
// skipcq: JS-0067
function repositoryName(repository: RegisteredRepository | null) {
  if (!repository) return 'No repository connected';
  return repository.name;
}

const initialSearchActivity: SearchActivity = {
  tool: 'search_code',
  phase: 'idle',
  summary: 'No repository selected',
  matchCount: null,
  durationMs: null,
  truncated: false,
  skippedFiles: 0,
  errorCode: null,
  citations: [],
};

const SEPARATOR_SIZE = 8;
const DEFAULT_PANE_WIDTHS = [200, 260, 400, 556];
const DEFAULT_PANE_MINIMUMS = [180, 220, 320, 400];
const PANE_LABELS = [
  'Workspace map',
  'Repositories and Git lineage',
  'Conversation and agent trace',
  'Work panel',
];

// skipcq: JS-0067
function paneMinimums(viewportWidth: number) {
  if (viewportWidth <= 1100) return [150, 210, 270, 340];
  if (viewportWidth <= 1284) return [160, 220, 280, 360];
  // Leave enough surplus at wide desktop sizes for every adjacent pair to
  // resize, while keeping the conversation and diff panes readable.
  return [180, 220, 320, 400];
}

// skipcq: JS-0067, JS-R1005
function fitPaneWidths(widths: number[], availableWidth: number, minimums: number[]) {
  const availablePanes = Math.max(
    minimums.reduce((sum, width) => sum + width, 0),
    availableWidth - SEPARATOR_SIZE * 3,
  );
  const desired = widths.map((width, index) => Math.max(width, minimums[index]));
  const desiredTotal = desired.reduce((sum, width) => sum + width, 0);

  if (desiredTotal <= availablePanes) {
    desired[3] += availablePanes - desiredTotal;
    return desired;
  }

  const reducible = desired.map((width, index) => width - minimums[index]);
  const reduction = desiredTotal - availablePanes;
  const reducibleTotal = reducible.reduce((sum, width) => sum + width, 0);
  return desired.map(
    (width, index) =>
      width - (reducibleTotal ? (reducible[index] / reducibleTotal) * reduction : 0),
  );
}

// skipcq: JS-0067
function StatusDot({ tone = 'green' }: { tone?: 'green' | 'violet' }) {
  return <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />;
}

// skipcq: JS-0067
function Glyph({ children }: { children: React.ReactNode }) {
  return <span aria-hidden="true">{children}</span>;
}

// skipcq: JS-0067
function PanelHeading({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="panel-heading">
      <span className="panel-number">{number}</span>
      <span>{children}</span>
    </div>
  );
}

// skipcq: JS-0067
function useStackedLayout() {
  const [isStacked, setIsStacked] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia(STACKED_LAYOUT_QUERY);
    const updateLayout = () => setIsStacked(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  return isStacked;
}

// skipcq: JS-0067
function PaneSeparator({
  index,
  widths,
  minimums,
  setWidths,
}: {
  index: number;
  widths: number[] | null;
  minimums: number[];
  setWidths: (index: number, delta: number) => void;
}) {
  const dragStart = useRef<{ x: number } | null>(null);
  const stopDraggingRef = useRef<() => void>(() => undefined);
  const label = `Resize ${PANE_LABELS[index]} and ${PANE_LABELS[index + 1]}`;
  const currentWidths = widths ?? DEFAULT_PANE_WIDTHS;
  const available = Math.max(
    minimums[index] + minimums[index + 1],
    currentWidths[index] + currentWidths[index + 1],
  );
  const value = Math.round(currentWidths[index]);
  const min = minimums[index];
  const max = Math.max(min, Math.round(available - minimums[index + 1]));

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragStart.current) return;
      const delta = event.clientX - dragStart.current.x;
      dragStart.current.x = event.clientX;
      setWidths(index, delta);
    },
    [index, setWidths],
  );

  const stopDragging = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDraggingRef.current);
    window.removeEventListener('pointercancel', stopDraggingRef.current);
  }, [onPointerMove]);

  useEffect(() => {
    stopDraggingRef.current = stopDragging;
    return () => {
      dragStart.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [onPointerMove, stopDragging]);

  return (
    <div
      className="pane-separator"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setWidths(index, -16);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setWidths(index, 16);
        } else if (event.key === 'Home') {
          event.preventDefault();
          setWidths(index, min - value);
        } else if (event.key === 'End') {
          event.preventDefault();
          setWidths(index, max - value);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        stopDragging();
        dragStart.current = { x: event.clientX };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopDragging);
        window.addEventListener('pointercancel', stopDragging);
      }}
    />
  );
}

type SearchResponse = {
  match_count: number;
  matches: Array<{
    path: string;
    line: number;
    text: string;
    before: Array<{ number: number; text: string }>;
    after: Array<{ number: number; text: string }>;
  }>;
  truncated: boolean;
  duration_ms: number;
  skipped_files: number;
};

// skipcq: JS-0067, JS-R1005
const searchCitations = (data: SearchResponse, repositoryId: string): SearchCitation[] => {
  // skipcq: JS-R1005
  return data.matches.map((match, index) => {
    const before = match.before ?? [];
    const after = match.after ?? [];
    const startLine = before[0]?.number ?? match.line;
    const endLine = after.at(-1)?.number ?? match.line;
    return {
      id: `search-${repositoryId}-${index}`,
      path: match.path,
      matchLine: match.line,
      startLine,
      endLine,
      label: `${match.path}:${startLine}${endLine === startLine ? '' : `-${endLine}`}`,
      text: match.text,
      before,
      after,
    };
  });
};

// skipcq: JS-0067, JS-0415
const CitedSource = ({ citation }: { citation: SearchCitation }) => {
  const lines = [
    ...citation.before,
    { number: citation.matchLine, text: citation.text },
    ...citation.after,
  ];
  return (
    <div className="citation-code-view" aria-label="Cited source">
      <div className="file-heading">
        <strong>
          <Glyph>‹›</Glyph> &nbsp; {citation.path}
        </strong>
        <span>
          L{citation.startLine}
          {citation.endLine !== citation.startLine && `-${citation.endLine}`}
        </span>
      </div>
      <div className="hunk-label">Exact search evidence · read-only</div>
      <div className="diff-code">
        {lines.map((line) => (
          <div
            className={`code-line ${line.number === citation.matchLine ? 'cited-line' : ''}`}
            key={`${line.number}-${line.text}`}
          >
            <span>{line.number}</span>
            <code>{line.text}</code>
          </div>
        ))}
      </div>
    </div>
  );
};

function evidenceCitation(evidence: InvestigationEvidence): SearchCitation {
  const excerptLines = evidence.excerpt.split('\n').map((text, index) => ({
    number: evidence.start_line + index,
    text,
  }));
  const matchIndex = evidence.match_line - evidence.start_line;
  const matchedLine = excerptLines[matchIndex];
  return {
    id: evidence.citation_id,
    path: evidence.path,
    matchLine: evidence.match_line,
    startLine: evidence.start_line,
    endLine: evidence.end_line,
    label: evidence.label,
    text: matchedLine?.text ?? '',
    before: excerptLines.slice(0, matchIndex),
    after: excerptLines.slice(matchIndex + 1),
  };
}

function ProposedDiff() {
  return (
    <div className="proposed-diff">
      <div className="file-heading" id="diff">
        <strong>
          <Glyph>▤</Glyph> &nbsp; auth/session.py
        </strong>
        <span>(+7 −5) &nbsp;&nbsp; INDEX 47b91e...c892fa 100644</span>
      </div>
      <div className="hunk-label">@@ -48,11 +48,13 @@ class SessionManager:</div>
      <div className="diff-code" aria-label="Proposed code diff">
        <div className="code-line">
          <span>48&nbsp;&nbsp; 48</span>
          <code>def __init__(self, ttl_seconds: int = 3600) -&gt; None:</code>
        </div>
        <div className="code-line">
          <span>49&nbsp;&nbsp; 49</span>
          <code> self._ttl = ttl_seconds</code>
        </div>
        <div className="code-line removed">
          <span>50&nbsp;&nbsp; −</span>
          <code> self._sessions = {'{}'}</code>
        </div>
        <div className="code-line added">
          <span>50&nbsp;&nbsp; +</span>
          <code> self._store = TokenStore(default_ttl=ttl_seconds)</code>
        </div>
        <div className="code-line">
          <span>51&nbsp;&nbsp; 51</span>
          <code> self._lock = threading.RLock()</code>
        </div>
        <div className="code-line removed">
          <span>52&nbsp;&nbsp; −</span>
          <code>def resolve(self, token: str) -&gt; Optional[SessionData]:</code>
        </div>
        <div className="code-line added">
          <span>52&nbsp;&nbsp; +</span>
          <code>async def resolve(self, token: str) -&gt; Optional[SessionData]:</code>
        </div>
        <div className="code-line removed">
          <span>53&nbsp;&nbsp; −</span>
          <code> return self._sessions.get(token)</code>
        </div>
        <div className="code-line added">
          <span>53&nbsp;&nbsp; +</span>
          <code> return await self._store.lookup(token)</code>
        </div>
        <div className="code-line">
          <span>54&nbsp;&nbsp; 54</span>
          <code>def invalidate(self, token: str) -&gt; bool:</code>
        </div>
        <div className="code-line removed">
          <span>55&nbsp;&nbsp; −</span>
          <code> return self._sessions.pop(token, None) is not None</code>
        </div>
        <div className="code-line added">
          <span>55&nbsp;&nbsp; +</span>
          <code> return self._store.revoke(token)</code>
        </div>
      </div>
      <div className="test-result">
        <span className="test-dot" aria-hidden="true" />{' '}
        <strong>
          Sandbox Tests: 14 passing <Glyph>→</Glyph> 14 passing
        </strong>
        <span>0 regressions detected &nbsp; runtime: 2.4s &nbsp; mem: 64MB &nbsp; EXIT: 0</span>
      </div>
      <div className="approval-panel">
        <p className="approval-status">
          <Glyph>⚠</Glyph> WRITE PENDING - proposal has NOT touched local repository disk. &nbsp;{' '}
          <small>REV 1 · SHA256: 4f8e...9a21</small>
        </p>
        <div className="approval-actions">
          <button type="button" disabled>
            <Glyph>ⓧ</Glyph> Reject
          </button>
          <button type="button" disabled>
            <Glyph>☷</Glyph> Request Changes
          </button>
          <button type="button" disabled>
            <Glyph>↥</Glyph> Apply to Branch <strong>fix/session-token-store</strong>
          </button>
          <button type="button" className="approve-button" disabled>
            <Glyph>⚙</Glyph> Approve &amp; Open PR
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyInvestigationState({ loading }: { loading: boolean }) {
  return (
    <div className="investigation-empty" aria-label="Read-only investigation status">
      <span className="read-only-chip">READ-ONLY INVESTIGATION</span>
      <strong>{loading ? 'Retrieving bounded evidence...' : 'Evidence review unavailable'}</strong>
      <p>
        {loading
          ? 'No files will be changed while the bounded repository evidence is retrieved.'
          : 'No proposal was created. Check the local API and try the investigation again.'}
      </p>
    </div>
  );
}

// Bounded effects and the four-pane workspace are intentionally orchestrated here.
// skipcq: JS-0067, JS-R1005, JS-0415
export default function Home() {
  const isStackedLayout = useStackedLayout();
  const gridRef = useRef<HTMLDivElement>(null);
  const [paneWidths, setPaneWidths] = useState<number[] | null>(null);
  const [paneMinimumBands, setPaneMinimumBands] = useState(DEFAULT_PANE_MINIMUMS);
  const [selectedCitation, setSelectedCitation] = useState<SearchCitation | null>(null);
  const [searchActivity, setSearchActivity] = useState<SearchActivity>(initialSearchActivity);
  const [repositories, setRepositories] = useState<RegisteredRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [repositorySummary, setRepositorySummary] = useState<RepositorySummary | null>(null);
  const [investigationQuestion, setInvestigationQuestion] = useState(
    'Why do users get logged out?',
  );
  const [submittedInvestigationQuestion, setSubmittedInvestigationQuestion] = useState<
    string | null
  >(null);
  const [investigation, setInvestigation] = useState<InvestigationResult | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const investigationRequestId = useRef(0);
  const investigationQuestionVersion = useRef(0);

  const investigate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRepositoryId || investigationQuestion.trim().length < 3) return;
    const repositoryId = selectedRepositoryId;
    const question = investigationQuestion.trim();
    const requestId = ++investigationRequestId.current;
    const questionVersion = investigationQuestionVersion.current;
    setSubmittedInvestigationQuestion(question);
    setInvestigationLoading(true);
    setInvestigationError(null);
    setInvestigation(null);
    setSelectedCitation(null);
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
    try {
      const response = await fetch(`${apiBase}/repositories/${repositoryId}/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) throw new Error('investigation_failed');
      const result = (await response.json()) as InvestigationResult;
      if (
        requestId === investigationRequestId.current &&
        questionVersion === investigationQuestionVersion.current
      ) {
        setInvestigation(result);
      }
    } catch {
      if (
        requestId === investigationRequestId.current &&
        questionVersion === investigationQuestionVersion.current
      ) {
        setInvestigationError('Investigation unavailable. Check the local API and try again.');
      }
    } finally {
      if (requestId === investigationRequestId.current) setInvestigationLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
    fetch(`${apiBase}/repositories`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('repository list request failed');
        return response.json() as Promise<RegisteredRepository[]>;
      })
      .then((data) => {
        setRepositories(data);
        if (data.length === 0) {
          setSearchActivity(initialSearchActivity);
        }
        setSelectedRepositoryId((current) => current ?? data[0]?.id ?? null);
      })
      .catch(() => {
        setRepositories([]);
      });
    return () => controller.abort();
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- reset stale view state when selection changes. */
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
    if (!selectedRepositoryId) {
      setRepositorySummary(null);
      return undefined;
    }
    setRepositorySummary(null);
    const controller = new AbortController();
    let requestActive = true;
    fetch(`${apiBase}/repositories/${selectedRepositoryId}/summary`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('summary request failed');
        return response.json() as Promise<{
          language: string | null;
          language_confidence: RepositorySummary['languageConfidence'];
          file_count: number;
          approximate_lines: number | null;
          test_framework: string | null;
          test_command: string | null;
          truncated: boolean;
        }>;
      })
      .then((data) => {
        if (!requestActive) return;
        setRepositorySummary({
          language: data.language,
          languageConfidence: data.language_confidence,
          fileCount: data.file_count,
          approximateLines: data.approximate_lines,
          testFramework: data.test_framework,
          testCommand: data.test_command,
          truncated: data.truncated,
        });
      })
      .catch(() => {
        if (requestActive) setRepositorySummary(null);
      });
    return () => {
      requestActive = false;
      controller.abort();
    };
  }, [selectedRepositoryId]);

  useEffect(() => {
    investigationRequestId.current += 1;
    setInvestigationLoading(false);
    if (!selectedRepositoryId) {
      setSearchActivity(initialSearchActivity);
      setSelectedCitation(null);
      setInvestigation(null);
      setSubmittedInvestigationQuestion(null);
      return undefined;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
    const controller = new AbortController();
    let requestActive = true;
    setSelectedCitation(null);
    setInvestigation(null);
    setInvestigationError(null);
    setSubmittedInvestigationQuestion(null);
    setSearchActivity({
      ...initialSearchActivity,
      phase: 'loading',
      summary: 'Searching for SessionManager',
    });
    fetch(`${apiBase}/repositories/${selectedRepositoryId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query: 'SessionManager',
        mode: 'literal',
        context_before: 2,
        context_after: 2,
        max_matches: 50,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response
            .json()
            .catch(() => null)
            .then((payload) => {
              const code =
                payload && typeof payload.code === 'string' ? payload.code : 'search_failed';
              throw new Error(code);
            });
        }
        return response.json() as Promise<{
          match_count: number;
          matches: Array<{
            path: string;
            line: number;
            text: string;
            before: Array<{ number: number; text: string }>;
            after: Array<{ number: number; text: string }>;
          }>;
          truncated: boolean;
          duration_ms: number;
          skipped_files: number;
        }>;
      })
      .then((data: SearchResponse) => {
        if (!requestActive) return;
        const citations = searchCitations(data, selectedRepositoryId);
        setSearchActivity({
          tool: 'search_code',
          phase: 'completed',
          summary: 'Searching for SessionManager',
          matchCount: data.match_count,
          durationMs: data.duration_ms,
          truncated: data.truncated,
          skippedFiles: data.skipped_files,
          errorCode: null,
          citations,
        });
      })
      .catch((error: unknown) => {
        if (requestActive) {
          setSearchActivity({
            ...initialSearchActivity,
            phase: 'error',
            summary: 'Searching for SessionManager',
            errorCode: error instanceof Error ? error.message : 'search_failed',
          });
        }
      });
    return () => {
      requestActive = false;
      controller.abort();
    };
  }, [selectedRepositoryId]);

  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const syncWidths = () => {
      const nextMinimums = paneMinimums(window.innerWidth);
      setPaneMinimumBands(nextMinimums);
      if (isStackedLayout) {
        setPaneWidths(null);
        return;
      }
      const availableWidth = grid.getBoundingClientRect().width;
      if (!availableWidth) return;
      setPaneWidths((current) =>
        fitPaneWidths(current ?? DEFAULT_PANE_WIDTHS, availableWidth, nextMinimums),
      );
    };

    syncWidths();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncWidths);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [isStackedLayout]);

  const resizePanes = useCallback(
    (index: number, delta: number) => {
      setPaneWidths((current) => {
        const next = [...(current ?? DEFAULT_PANE_WIDTHS)];
        const maxDelta = next[index + 1] - paneMinimumBands[index + 1];
        const minDelta = paneMinimumBands[index] - next[index];
        const boundedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
        next[index] += boundedDelta;
        next[index + 1] -= boundedDelta;
        return next;
      });
    },
    [paneMinimumBands],
  );

  const gridStyle = paneWidths
    ? {
        gridTemplateColumns: paneWidths
          .flatMap((width, index) =>
            index === paneWidths.length - 1
              ? [`${width}px`]
              : [`${width}px`, `${SEPARATOR_SIZE}px`],
          )
          .join(' '),
      }
    : undefined;

  // The workspace shell deliberately keeps the four-pane layout together so
  // its responsive grid and pane separators remain one accessible landmark.
  // skipcq: JS-0415
  return (
    // skipcq: JS-0415
    <main className="workspace-shell">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Glyph>⚒</Glyph>
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <span className="branch-context">
            <Glyph>⑂</Glyph> &nbsp; main <b>3 behind</b> &nbsp;<Glyph>→</Glyph>&nbsp;{' '}
            <strong>fix/session-token-store</strong>
          </span>
        </div>
        <div className="global-status">
          <span>
            <StatusDot /> DAEMON: ACTIVE <small>pid: 40912</small>
          </span>
          <span>AIR-GAPPED VFS: ENFORCED</span>
          <span className="churn">STAGING CHURN: +7 / -5</span>
          <span className="read-only-badge">
            <StatusDot /> READ-ONLY (SAFE SANDBOX)
          </span>
          <button className="compact-button" type="button" disabled>
            <Glyph>▣</Glyph> Audit Log&nbsp; <Glyph>⌘K</Glyph>
          </button>
          <button className="avatar" type="button" aria-label="Open account menu" disabled>
            <Glyph>♙</Glyph>
          </button>
        </div>
      </header>
      <div
        className="workspace-grid"
        data-layout={isStackedLayout ? 'stacked' : 'wide'}
        ref={gridRef}
        style={gridStyle}
      >
        <nav className="workspace-rail" aria-label="Workspace map">
          <div className="rail-label">WORKSPACE MAP</div>
          <div className="rail-health" aria-label="Health: healthy">
            HEALTHY
          </div>
          <div className="rail-items">
            <Link href="/git-graph-staging">
              <Glyph>✣</Glyph> <span>Git Graph &amp; Staging</span>
            </Link>
            <Link href="/agent-traces-stream">
              <Glyph>▣</Glyph> <span>Agent Traces &amp; Stream</span>
            </Link>
            <button className="rail-active" type="button" aria-current="page" disabled>
              <Glyph>♟</Glyph> <span>Staging Chamber</span>
            </button>
            <Link href="/worktrees-locks">
              <Glyph>◈</Glyph> <span>Worktrees &amp; Locks</span>
            </Link>
            <Link href="/audit-ledger">
              <Glyph>◷</Glyph> <span>Audit Ledger</span>
            </Link>
          </div>
          <div className="rail-footer">
            <span>ENGINE DAEMON</span>
            <strong aria-label="Engine daemon status: online">ONLINE</strong>
            <span>Sandbox HEAD</span>
            <code aria-label="Sandbox HEAD">9b4ec8f</code>
            <span>
              <Glyph>▣</Glyph> &nbsp; STRICT LOCAL CONFINEMENT
            </span>
          </div>
        </nav>
        {!isStackedLayout && (
          <PaneSeparator
            index={0}
            widths={paneWidths}
            minimums={paneMinimumBands}
            setWidths={resizePanes}
          />
        )}
        <aside className="repo-panel" aria-label="Repositories and Git lineage">
          <PanelHeading number={1}>Repos &amp; lineage</PanelHeading>
          <div className="repo-content">
            <div className="section-kicker">
              CONNECTED REPOS <Glyph>☷</Glyph>
            </div>
            <div className="session-list" role="listbox" aria-label="Connected repositories">
              {repositories.map((repository) => {
                const active = repository.id === selectedRepositoryId;
                return (
                  <button
                    className={`session-row ${active ? 'session-active' : ''}`}
                    key={repository.id}
                    type="button"
                    aria-selected={active}
                    role="option"
                    onClick={() => setSelectedRepositoryId(repository.id)}
                  >
                    <span aria-hidden="true">{active ? '☑' : '□'}</span>
                    <span>{repositoryName(repository)}</span>
                    {active && <StatusDot />}
                  </button>
                );
              })}
              {repositories.length === 0 && (
                <span className="empty-state">No repositories connected.</span>
              )}
              <button className="connect-row" type="button" disabled>
                <Glyph>＋</Glyph> Connect a repo...
              </button>
            </div>
            <div className="lineage-title">
              GIT DAG LINEAGE <code>HEAD: 89b21e</code>
            </div>
            <div className="lineage">
              <div className="commit">
                <i aria-hidden="true" />
                <code>a4f81c</code>
                <span>origin/main</span>
                <small>feat: token schema</small>
              </div>
              <div className="commit current">
                <i aria-hidden="true" />
                <code>89b21e</code>
                <em>HEAD</em>
                <small>draft: storage contract</small>
              </div>
            </div>
            <div className="revision-card">
              <b>
                <Glyph>●</Glyph> &nbsp; REV 1
              </b>
              <span>SANDBOX</span>
              <strong>TokenStore uncommitted</strong>
            </div>
            <div className="sandbox-card">
              <b>
                <Glyph>♙</Glyph> Sandbox Jail #89b2
              </b>
              <StatusDot />
              <small>/tmp/surgeon-sandbox-89b2 (illustrative path)</small>
              <span>
                NETWORK: OFF <i aria-hidden="true" /> COW-VFS: RDWR
              </span>
            </div>
            <div className="section-kicker context-kicker">THIS SESSION CONTEXT</div>
            <div className="context-list" role="listbox" aria-label="Session context">
              <span role="option" aria-selected="false">
                Where is auth handled?
              </span>
              <span role="option" aria-selected="false">
                Why do users get logged out?
              </span>
              <b role="option" aria-selected="true">
                Refactor session module... <StatusDot tone="violet" />
              </b>
            </div>
          </div>
          <RepositorySummaryCard summary={repositorySummary} />
        </aside>
        {!isStackedLayout && (
          <PaneSeparator
            index={1}
            widths={paneWidths}
            minimums={paneMinimumBands}
            setWidths={resizePanes}
          />
        )}
        <section className="conversation" aria-labelledby="conversation-title">
          <PanelHeading number={2}>
            <span id="conversation-title">Conversation &amp; agent trace</span>
            <span className="stream-status">
              <StatusDot /> STREAM ACTIVE
            </span>
          </PanelHeading>
          <div className="conversation-body">
            <div className="message-meta">
              YOU <time>14:28:01</time>
            </div>
            <div className="user-message">
              {submittedInvestigationQuestion ?? investigationQuestion}
            </div>
            <div className="message-meta agent-meta">
              REPO SURGEON <span>sub-agent: refactor-core</span>
              <time>14:28:04</time>
            </div>
            <p className="agent-message">
              I&apos;ll inspect bounded repository evidence, rank likely causes, and suggest a
              focused verification step. This investigation cannot modify files.
            </p>
            <div className="activity-list" aria-label="Agent activity">
              <SearchActivityRow activity={searchActivity} onSelectCitation={setSelectedCitation} />
            </div>
            {selectedCitation && (
              <p className="agent-message finding">
                Found bounded evidence in <a href="#work-panel">{selectedCitation.label}</a>. See
                the read-only evidence in the staging chamber on the right <Glyph>→</Glyph>
              </p>
            )}
            {!submittedInvestigationQuestion && (
              <div className="pending-trace">
                proposing patch revision 1, awaiting your approval...
              </div>
            )}
          </div>
          <form className="composer" onSubmit={investigate}>
            <div className="slash-hints">
              <kbd>/explain diff</kbd>
              <kbd>/run-fuzz-tests</kbd>
              <kbd>/revert-sandbox</kbd>
              <kbd>/inspect-memory</kbd>
            </div>
            <textarea
              aria-label="Agent instruction"
              aria-describedby="composer-note"
              value={investigationQuestion}
              onChange={(event) => {
                investigationQuestionVersion.current += 1;
                setInvestigationQuestion(event.target.value);
              }}
              placeholder="Ask why the seeded bug occurs..."
            />
            <p className="sr-only" id="composer-note">
              Investigation is read-only and cannot modify the connected repository.
            </p>
            <div className="composer-controls">
              <button type="button" disabled aria-label="Model selector unavailable">
                <Glyph>●</Glyph> Claude 3.7 Sonnet (Local Agent) <Glyph>⌄</Glyph>
              </button>
              <button className="abort" type="button" disabled>
                <Glyph>⊘</Glyph> Abort [Esc]
              </button>
              <button
                className="send"
                type="submit"
                aria-label="Send instruction"
                disabled={investigationLoading || !selectedRepositoryId}
              >
                <Glyph>↑</Glyph>
              </button>
            </div>
            {investigationError && <p className="composer-error">{investigationError}</p>}
          </form>
        </section>
        {!isStackedLayout && (
          <PaneSeparator
            index={2}
            widths={paneWidths}
            minimums={paneMinimumBands}
            setWidths={resizePanes}
          />
        )}
        <section className="work-panel" id="work-panel" aria-labelledby="work-panel-title">
          <h2 className="sr-only" id="work-panel-title">
            Work panel
          </h2>
          <div className="work-toolbar">
            <div className="work-tabs" role="tablist" aria-label="Staging views">
              <button
                type="button"
                role="tab"
                aria-selected={selectedCitation !== null}
                className={selectedCitation ? 'tab-selected' : undefined}
                disabled
              >
                <Glyph>‹›</Glyph> Code
              </button>
              {submittedInvestigationQuestion ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCitation === null}
                  className={selectedCitation ? undefined : 'tab-selected'}
                  disabled
                >
                  <Glyph>◌</Glyph> Evidence
                </button>
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCitation === null}
                  className={selectedCitation ? undefined : 'tab-selected'}
                  disabled
                >
                  <Glyph>▣</Glyph> Diff <span className="pending-pill">PENDING</span>
                </button>
              )}
              {!submittedInvestigationQuestion && (
                <button type="button" role="tab" aria-selected="false" disabled>
                  <Glyph>▤</Glyph> Tests <span className="pass-pill">14 PASS</span>
                </button>
              )}
            </div>
            {!submittedInvestigationQuestion && (
              <span>
                +7 −5 &nbsp; <b>SPLIT</b> &nbsp; UNIFIED
              </span>
            )}
          </div>
          {selectedCitation ? (
            <CitedSource citation={selectedCitation} />
          ) : investigation ? (
            <InvestigationPanel
              result={investigation}
              onSelectEvidence={(evidence) => setSelectedCitation(evidenceCitation(evidence))}
            />
          ) : submittedInvestigationQuestion ? (
            <ReadOnlyInvestigationState loading={investigationLoading} />
          ) : (
            <ProposedDiff />
          )}
          {investigationLoading && (
            <div className="investigation-loading">Retrieving bounded evidence...</div>
          )}
        </section>
      </div>
      <h1 className="sr-only">Understand the code. Keep people in control.</h1>
    </main>
  );
}
