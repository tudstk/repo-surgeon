'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createProductSession,
  createReadOnlyTurn,
  getPersistedRunEvents,
  getProductSession,
  getRepositorySummary,
  listOwnedRepositories,
  listProductSessions,
  type OwnedRepository,
  type ProductSession,
  type ProductSessionDetail,
  type RepositorySummary,
  type RunEvent,
} from '@/lib/workspace-api';

function PanelHeading({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="panel-heading">
      <span className="panel-number">{number}</span>
      <span>{children}</span>
    </div>
  );
}

function formatLines(lines: number | null) {
  return lines === null
    ? 'LOC unavailable'
    : `${new Intl.NumberFormat('en', { notation: 'compact' }).format(lines)} LOC`;
}

function eventMessage(event: RunEvent) {
  if (event.type === 'progress.updated' && typeof event.data.message === 'string') {
    return event.data.message;
  }
  if (event.type.startsWith('tool.') && typeof event.data.tool === 'string') {
    return event.data.tool;
  }
  if (event.type === 'answer.completed') return 'Visible answer persisted';
  if (event.type === 'run.completed') return 'Run completed and durable';
  return 'Persisted normalized event';
}

export default function Workspace({
  githubLogin,
  csrfToken,
}: {
  githubLogin: string;
  csrfToken: string;
}) {
  const [repositories, setRepositories] = useState<OwnedRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RepositorySummary | null>(null);
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [session, setSession] = useState<ProductSessionDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState('What does this repository contain?');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const workspaceRequestGeneration = useRef(0);
  const selectedRepositoryIdRef = useRef<string | null>(null);

  const clearPrivateWorkspace = useCallback(() => {
    workspaceRequestGeneration.current += 1;
    selectedRepositoryIdRef.current = null;
    setRepositories([]);
    setSelectedRepositoryId(null);
    setSummary(null);
    setSessions([]);
    setSession(null);
    setEvents([]);
  }, []);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );
  const latestTurn = session?.turns.at(-1) ?? null;

  const restoreSession = useCallback(
    async (
      sessionId: string,
      signal?: AbortSignal,
      generation = ++workspaceRequestGeneration.current,
    ) => {
      const detail = await getProductSession(sessionId, signal);
      if (signal?.aborted || generation !== workspaceRequestGeneration.current) return;
      const latest = detail.turns.at(-1);
      const persistedEvents = latest
        ? await getPersistedRunEvents(latest.run_id, undefined, signal)
        : [];
      if (signal?.aborted || generation !== workspaceRequestGeneration.current) return;
      setSession(detail);
      setEvents(persistedEvents);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    listOwnedRepositories(controller.signal)
      .then((owned) => {
        const currentSelection = selectedRepositoryIdRef.current;
        const nextSelection =
          currentSelection && owned.some((repository) => repository.id === currentSelection)
            ? currentSelection
            : (owned[0]?.id ?? null);
        if (nextSelection !== currentSelection) {
          workspaceRequestGeneration.current += 1;
          setSummary(null);
          setSessions([]);
          setSession(null);
          setEvents([]);
          setError(null);
        }
        selectedRepositoryIdRef.current = nextSelection;
        setRepositories(owned);
        setSelectedRepositoryId(nextSelection);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          clearPrivateWorkspace();
          setError('Owned repositories could not be loaded.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, clearPrivateWorkspace]);

  useEffect(() => {
    if (!selectedRepositoryId) return;
    const controller = new AbortController();
    const generation = ++workspaceRequestGeneration.current;
    Promise.all([
      getRepositorySummary(selectedRepositoryId, controller.signal),
      listProductSessions(selectedRepositoryId, controller.signal),
    ])
      .then(async ([repositorySummary, availableSessions]) => {
        if (controller.signal.aborted || generation !== workspaceRequestGeneration.current) return;
        setSummary(repositorySummary);
        setSessions(availableSessions);
        if (availableSessions[0]) {
          await restoreSession(availableSessions[0].id, controller.signal, generation);
        } else if (
          !controller.signal.aborted &&
          generation === workspaceRequestGeneration.current
        ) {
          setSession(null);
          setEvents([]);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && generation === workspaceRequestGeneration.current) {
          clearPrivateWorkspace();
          setError('Repository workspace state could not be loaded.');
        }
      });
    return () => controller.abort();
  }, [attempt, clearPrivateWorkspace, restoreSession, selectedRepositoryId]);

  const handleStartSession = async () => {
    if (!selectedRepository) return;
    const generation = workspaceRequestGeneration.current;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createProductSession(
        selectedRepository.id,
        `${selectedRepository.name} read-only review`,
        csrfToken,
      );
      if (generation !== workspaceRequestGeneration.current) return;
      setSessions((current) => [created, ...current]);
      setSession({ ...created, turns: [] });
      setEvents([]);
    } catch {
      if (generation === workspaceRequestGeneration.current) {
        clearPrivateWorkspace();
        setError('A read-only product session could not be started.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!session || trimmed.length < 3) return;
    const generation = workspaceRequestGeneration.current;
    const sessionId = session.id;
    setSubmitting(true);
    setError(null);
    try {
      const turn = await createReadOnlyTurn(sessionId, trimmed, csrfToken);
      if (generation !== workspaceRequestGeneration.current) return;
      const persistedEvents = await getPersistedRunEvents(turn.run_id);
      if (generation !== workspaceRequestGeneration.current) return;
      const detail = await getProductSession(sessionId);
      if (generation !== workspaceRequestGeneration.current) return;
      setSession(detail);
      setEvents(persistedEvents);
    } catch {
      if (generation === workspaceRequestGeneration.current) {
        clearPrivateWorkspace();
        setError('The bounded read-only turn could not be completed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="workspace-shell">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ⚒
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <span className="branch-context">
            {selectedRepository?.name ?? 'Select a repository'} · tenant workspace
          </span>
        </div>
        <div className="global-status">
          <span className="read-only-badge">
            <span className="status-dot" aria-hidden="true" /> READ-ONLY
          </span>
          <Link
            className="compact-button"
            href="/profile"
            aria-label={`Open profile for @${githubLogin}`}
          >
            @{githubLogin}
          </Link>
        </div>
      </header>

      <div className="workspace-grid live-workspace-grid" data-layout="wide">
        <aside className="repo-panel" aria-label="Repositories and sessions">
          <PanelHeading number={1}>Repositories &amp; sessions</PanelHeading>
          <div className="repo-content">
            <div className="section-kicker">OWNED REPOSITORIES</div>
            {loading ? <p className="empty-state">Loading owned repositories…</p> : null}
            {!loading && repositories.length === 0 ? (
              <p className="empty-state">No owned repositories are available.</p>
            ) : null}
            <div className="session-list" role="listbox" aria-label="Owned repositories">
              {repositories.map((repository) => (
                <button
                  aria-selected={repository.id === selectedRepositoryId}
                  className={`session-row ${repository.id === selectedRepositoryId ? 'session-active' : ''}`}
                  key={repository.id}
                  onClick={() => {
                    if (repository.id === selectedRepositoryId) return;
                    workspaceRequestGeneration.current += 1;
                    selectedRepositoryIdRef.current = repository.id;
                    setSelectedRepositoryId(repository.id);
                    setSummary(null);
                    setSessions([]);
                    setSession(null);
                    setEvents([]);
                    setError(null);
                  }}
                  role="option"
                  type="button"
                >
                  <span aria-hidden="true">▣</span>
                  <span>{repository.name}</span>
                  {repository.id === selectedRepositoryId ? (
                    <span className="status-dot" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>

            <div className="section-kicker context-kicker">PRODUCT SESSIONS</div>
            <div className="session-list" aria-label="Product sessions">
              {sessions.map((item) => (
                <button
                  aria-pressed={item.id === session?.id}
                  className={`session-row ${item.id === session?.id ? 'session-active' : ''}`}
                  key={item.id}
                  onClick={() => {
                    const generation = workspaceRequestGeneration.current + 1;
                    setSession(null);
                    setEvents([]);
                    void restoreSession(item.id).catch(() => {
                      if (generation === workspaceRequestGeneration.current) {
                        clearPrivateWorkspace();
                        setError('Repository workspace state could not be loaded.');
                      }
                    });
                  }}
                  type="button"
                >
                  <span aria-hidden="true">◌</span>
                  <span>{item.title}</span>
                </button>
              ))}
              <button
                className="connect-row"
                disabled={!selectedRepository || submitting}
                onClick={() => void handleStartSession()}
                type="button"
              >
                <span aria-hidden="true">＋</span> Start read-only session
              </button>
            </div>
          </div>
          <section className="repo-summary" aria-labelledby="repo-summary-title">
            <div className="summary-heading">
              <h2 id="repo-summary-title">REPOSITORY SUMMARY</h2>
              {summary?.truncated ? <span className="partial-pill">SCAN PARTIAL</span> : null}
            </div>
            {summary ? (
              <dl>
                <div>
                  <dt>Language</dt>
                  <dd>{summary.language ?? 'Not detected'}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {summary.file_count} files · {formatLines(summary.approximate_lines)}
                  </dd>
                </div>
                <div>
                  <dt>Tests</dt>
                  <dd>{summary.test_framework ?? 'Not detected'}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty-state">Select an owned repository.</p>
            )}
          </section>
        </aside>

        <div className="pane-separator" aria-hidden="true" />

        <section className="conversation" aria-labelledby="conversation-title">
          <PanelHeading number={2}>
            <span id="conversation-title">Conversation &amp; agent trace</span>
            <span className="stream-status">PERSISTED</span>
          </PanelHeading>
          <div className="conversation-body">
            {error ? (
              <div className="identity-alert workspace-alert" role="alert">
                {error}
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {!session ? (
              <div className="workspace-empty">
                <strong>Start a tenant-scoped product session</strong>
                <p>
                  Select an owned repository, then start a read-only session to ask one bounded
                  question.
                </p>
              </div>
            ) : null}
            {latestTurn ? (
              <>
                <div className="message-meta">YOU</div>
                <div className="user-message">{latestTurn.question}</div>
                <div className="message-meta agent-meta">REPO SURGEON</div>
                <p className="agent-message">{latestTurn.answer}</p>
                <div className="activity-list" aria-label="Persisted agent activity">
                  {events
                    .filter((item) => item.type === 'tool.completed' || item.type === 'tool.failed')
                    .map((item) => (
                      <div className="activity-row" key={item.event_id}>
                        <span aria-hidden="true">›</span>
                        <code>{typeof item.data.tool === 'string' ? item.data.tool : 'tool'}</code>
                        <span className="activity-detail">Persisted normalized result</span>
                        <strong>{item.type === 'tool.completed' ? 'DONE' : 'FAILED'}</strong>
                      </div>
                    ))}
                </div>
                <div className="read-only-note">
                  <span aria-hidden="true">✓</span>
                  Persisted turn restored from normalized events. No repository write capability was
                  available.
                </div>
              </>
            ) : session ? (
              <div className="workspace-empty">
                <strong>Session ready</strong>
                <p>
                  Submit one question. The deterministic provider can use only bounded read tools.
                </p>
              </div>
            ) : null}
          </div>
          <form className="composer" onSubmit={handleSubmit}>
            <div className="slash-hints">
              <span>Bounded list, read, and exact-search tools only.</span>
            </div>
            <textarea
              aria-label="Agent instruction"
              disabled={!session || submitting}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Start a session to ask a repository question…"
              value={message}
            />
            <div className="composer-controls">
              <span className="composer-policy">
                <span className="status-dot" aria-hidden="true" /> Deterministic fake provider
              </span>
              <button
                aria-label="Send instruction"
                className="send"
                disabled={!session || submitting || message.trim().length < 3}
                type="submit"
              >
                {submitting ? '…' : '↑'}
                <span className="sr-only">Send instruction</span>
              </button>
            </div>
          </form>
        </section>

        <div className="pane-separator" aria-hidden="true" />

        <section className="work-panel" aria-labelledby="work-panel-title">
          <h2 className="sr-only" id="work-panel-title">
            Work panel
          </h2>
          <div className="work-toolbar">
            <div className="work-tabs" role="tablist" aria-label="Work views">
              <button className="tab-selected" role="tab" aria-selected="true" type="button">
                Run events
              </button>
              <button role="tab" aria-selected="false" disabled type="button">
                Diff unavailable
              </button>
            </div>
          </div>
          <div className="file-heading">
            <strong>Normalized persisted trace</strong>
            <span>READ-ONLY</span>
          </div>
          <div className="event-ledger" aria-label="Normalized run events">
            {events.length ? (
              events.map((item) => (
                <article className="event-row" key={item.event_id}>
                  <span className="event-sequence">{String(item.sequence).padStart(2, '0')}</span>
                  <div>
                    <code>{item.type}</code>
                    <p>{eventMessage(item)}</p>
                  </div>
                  <span className="event-state">COMMITTED</span>
                </article>
              ))
            ) : (
              <div className="workspace-empty compact-empty">
                <strong>No run selected</strong>
                <p>Persisted normalized events appear here after a bounded turn.</p>
              </div>
            )}
          </div>
          <div className="read-only-footer">
            <span className="status-dot" aria-hidden="true" />
            Read-only repository access · proposal and write actions are out of scope
          </div>
        </section>
      </div>
      <h1 className="sr-only">Authenticated read-only repository workspace</h1>
    </main>
  );
}
