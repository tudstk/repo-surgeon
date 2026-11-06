'use client';

import { AppHeader, Icon, ReadOnlyBadge } from '@/components/ui/shell';
import { Drawer } from '@/components/ui/drawer';
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
  WorkspaceRequestError,
} from '@/lib/workspace-api';

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
  if (event.type === 'run.completed') return 'Run completed';
  if (event.type === 'run.failed') return 'Run failed';
  return 'Saved run activity';
}

export default function Workspace({
  githubLogin,
  csrfToken,
}: {
  githubLogin: string;
  csrfToken: string;
}) {
  const [drawer, setDrawer] = useState<'repositories' | 'events' | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const [repositories, setRepositories] = useState<OwnedRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RepositorySummary | null>(null);
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [session, setSession] = useState<ProductSessionDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState('What does this repository contain?');
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<'session' | 'turn' | null>(null);
  const submitting = pendingAction !== null;
  const creatingSession = pendingAction === 'session';
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
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && generation === workspaceRequestGeneration.current) {
          if (
            cause instanceof WorkspaceRequestError &&
            cause.status === 503 &&
            cause.code === 'repository_unavailable'
          ) {
            // Source availability is distinct from authorization. Clear selected content,
            // but retain the already-authorized choices so another repository is reachable.
            workspaceRequestGeneration.current += 1;
            setSummary(null);
            setSessions([]);
            setSession(null);
            setEvents([]);
            setError('This repository is unavailable. Choose another repository or retry later.');
          } else {
            clearPrivateWorkspace();
            setError('Repository workspace state could not be loaded.');
          }
        }
      });
    return () => controller.abort();
  }, [attempt, clearPrivateWorkspace, restoreSession, selectedRepositoryId]);

  const handleStartSession = async () => {
    if (!selectedRepository || !summary || submitting) return;
    const generation = workspaceRequestGeneration.current;
    setPendingAction('session');
    setError(null);
    try {
      const created = await createProductSession(
        selectedRepository.id,
        `${selectedRepository.name} read-only review`,
        csrfToken,
      );
      if (generation !== workspaceRequestGeneration.current) return;
      // A new selection supersedes any older session restore still in flight.
      workspaceRequestGeneration.current += 1;
      setSessions((current) => [created, ...current]);
      setSession({ ...created, turns: [] });
      setEvents([]);
    } catch {
      if (generation === workspaceRequestGeneration.current) {
        clearPrivateWorkspace();
        setError('A read-only product session could not be started.');
      }
    } finally {
      setPendingAction(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!session || submitting || trimmed.length < 3) return;
    const generation = workspaceRequestGeneration.current;
    const sessionId = session.id;
    setPendingAction('turn');
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
      setPendingAction(null);
    }
  };

  const repositoryPane = (
    <>
      <div className="panel-heading">
        <h2>Repositories</h2>
        <span className="count">{repositories.length}</span>
      </div>
      <div className="repo-content">
        {loading ? (
          <div className="loading-state" role="status">
            <span className="skeleton" />
            <span className="skeleton short" />
            Loading repositories…
          </div>
        ) : null}
        {!loading && !error && repositories.length === 0 ? (
          <p className="empty-state">No repositories assigned yet.</p>
        ) : null}
        <div className="selection-list" role="group" aria-label="Repositories">
          {repositories.map((repository) => (
            <button
              aria-pressed={repository.id === selectedRepositoryId}
              className="selection-row"
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
              type="button"
              title={repository.name}
            >
              <Icon name="repo" />
              <span>{repository.name}</span>
            </button>
          ))}
        </div>
        <div className="section-heading">
          <h2>Sessions</h2>
          <button
            className="icon-button"
            aria-label="Start read-only session"
            disabled={!selectedRepository || !summary || submitting}
            onClick={() => void handleStartSession()}
            type="button"
          >
            <Icon name="plus" />
          </button>
        </div>
        <div className="selection-list" role="group" aria-label="Sessions">
          {sessions.map((item) => (
            <button
              aria-pressed={item.id === session?.id}
              className="selection-row"
              key={item.id}
              title={item.title}
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
                closeDrawer();
              }}
              type="button"
            >
              <Icon name="activity" />
              <span>{item.title}</span>
            </button>
          ))}
          {selectedRepository && sessions.length === 0 ? (
            <p className="empty-state">Your read-only sessions will appear here.</p>
          ) : null}
        </div>
      </div>
      <section className="repo-summary" aria-labelledby="repo-summary-title">
        <div className="section-heading">
          <h2 id="repo-summary-title">Repository summary</h2>
          {summary?.truncated ? <span className="status-badge warning">Partial scan</span> : null}
        </div>
        {summary ? (
          <>
            <dl>
              <div>
                <dt>Language</dt>
                <dd>{summary.language ?? 'Not detected'}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{summary.language_confidence ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>{summary.file_count}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatLines(summary.approximate_lines)}</dd>
              </div>
              <div>
                <dt>Tests detected</dt>
                <dd>{summary.test_framework ?? 'Not detected'}</dd>
              </div>
            </dl>
            {summary.test_command ? (
              <code className="test-command">{summary.test_command}</code>
            ) : null}
            <p className="summary-note">
              Test detection is not a test result.
              {summary.truncated ? ' Partial scan: counts cover only inspected files.' : ''}
            </p>
            {summary.detected_at ? (
              <p className="summary-note">
                Scanned{' '}
                <time dateTime={summary.detected_at}>
                  {new Date(summary.detected_at).toISOString().slice(0, 10)}
                </time>
              </p>
            ) : null}
          </>
        ) : (
          <p className="empty-state">Select an assigned repository.</p>
        )}
      </section>
    </>
  );

  const eventPane = (
    <>
      <div className="panel-heading">
        <h2>Run events</h2>
        <span className="count">{events.length}</span>
      </div>
      <div className="evidence-intro">
        <Icon name="activity" />
        <p>
          Saved activity for the latest exchange. Events are persisted to session history; no Git
          commit occurred.
        </p>
      </div>
      <div className="event-ledger" aria-label="Normalized run events">
        {events.length ? (
          events.map((item) => {
            const failed = item.type.endsWith('.failed');
            const completed = item.type.endsWith('.completed');
            return (
              <article className={`event-row ${failed ? 'event-failed' : ''}`} key={item.event_id}>
                <span className="event-sequence">{String(item.sequence).padStart(2, '0')}</span>
                <div className="event-content">
                  <code>{item.type}</code>
                  <p>{eventMessage(item)}</p>
                  <div className="event-metadata">
                    {failed || completed ? (
                      <span className={failed ? 'outcome danger' : 'outcome success'}>
                        <Icon name={failed ? 'error' : 'check'} />
                        {failed ? 'Failed' : 'Completed'}
                      </span>
                    ) : null}
                    <span className="persisted">Persisted</span>
                    <time dateTime={item.occurred_at}>
                      {new Date(item.occurred_at).toISOString().slice(11, 19)} UTC
                    </time>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="workspace-empty compact-empty">
            <Icon name="activity" />
            <h3>No run events yet</h3>
            <p>
              {creatingSession
                ? 'Starting a new session. No inspection has been requested.'
                : submitting
                  ? 'Saved events will appear after this inspection finishes.'
                  : 'Run a demo inspection in a session to see its saved activity here.'}
            </p>
          </div>
        )}
      </div>
      <div className="read-only-footer">
        Proposals and test execution are not available in this release.
      </div>
    </>
  );

  return (
    <main className="workspace-shell">
      <AppHeader active="workspace" profileLabel={`Open profile for @${githubLogin}`}>
        <ReadOnlyBadge />
      </AppHeader>
      <div className="repository-context">
        <Icon name="repo" />
        <span title={selectedRepository?.name}>{selectedRepository?.name ?? 'Your workspace'}</span>
        <span className="context-caption">Repository files stay unchanged</span>
      </div>
      <div className="mobile-pane-controls">
        <button type="button" aria-haspopup="dialog" onClick={() => setDrawer('repositories')}>
          <Icon name="repo" />
          Repositories
        </button>
        <button type="button" aria-haspopup="dialog" onClick={() => setDrawer('events')}>
          <Icon name="activity" />
          Run events<span className="count">{events.length}</span>
        </button>
      </div>
      <div className="workspace-grid">
        <aside className="repo-panel" aria-label="Repositories and sessions">
          {drawer === 'repositories' ? null : repositoryPane}
        </aside>
        <section className="conversation" aria-labelledby="conversation-title">
          <div className="panel-heading">
            <h1 id="conversation-title">Latest exchange</h1>
            <span className={`exchange-state ${submitting ? 'warning' : ''}`} role="status">
              {creatingSession
                ? 'Starting session…'
                : submitting
                  ? 'Inspecting…'
                  : latestTurn
                    ? 'Saved'
                    : session
                      ? 'Ready'
                      : 'Read-only'}
            </span>
          </div>
          <div className="conversation-body">
            {error ? (
              <div className="identity-alert workspace-alert" role="alert">
                <Icon name="error" />
                <div>
                  <strong>Workspace unavailable</strong>
                  <p>{error}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setLoading(true);
                      setError(null);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : null}
            {!error && loading ? (
              <div className="loading-state" role="status">
                <span className="skeleton" />
                <span className="skeleton short" />
                Loading your workspace…
              </div>
            ) : null}
            {!error && !loading && !session ? (
              <div className="workspace-empty">
                <Icon name="repo" />
                <h2>
                  {selectedRepository
                    ? 'Start a read-only session'
                    : 'No repositories in this workspace yet'}
                </h2>
                <p>
                  {selectedRepository
                    ? 'Keep an inspection and its saved activity together in a session.'
                    : 'This release shows repositories already assigned to your account. Connecting or importing a GitHub repository is not available yet.'}
                </p>
                {selectedRepository ? (
                  <button
                    className="primary-button"
                    disabled={!summary || submitting}
                    type="button"
                    onClick={() => void handleStartSession()}
                  >
                    <Icon name="plus" />
                    New session
                  </button>
                ) : null}
              </div>
            ) : null}
            {latestTurn ? (
              <div className="exchange">
                <div className="message-meta">You</div>
                <div className="user-message">{latestTurn.question}</div>
                <div className="message-meta agent-meta">
                  <Icon name="activity" />
                  Repo Surgeon<span className="status-badge">Demo</span>
                </div>
                <p className="agent-message">
                  {latestTurn.answer || 'No answer was returned for this run.'}
                </p>
                <div className="activity-list" aria-label="Persisted agent activity">
                  {events
                    .filter((item) => item.type === 'tool.completed' || item.type === 'tool.failed')
                    .map((item) => (
                      <div className="activity-row" key={item.event_id}>
                        <Icon name={item.type === 'tool.failed' ? 'error' : 'check'} />
                        <code>{typeof item.data.tool === 'string' ? item.data.tool : 'tool'}</code>
                        <span className={item.type === 'tool.failed' ? 'danger' : 'success'}>
                          {item.type === 'tool.completed' ? 'Completed' : 'Failed'}
                        </span>
                      </div>
                    ))}
                </div>
                <p className="read-only-note">
                  <Icon name="shield" />
                  Saved to session history. Repository files are unchanged.
                </p>
                <p
                  className={latestTurn.status === 'failed' ? 'run-outcome danger' : 'run-outcome'}
                >
                  Run outcome: {latestTurn.status}
                </p>
              </div>
            ) : session ? (
              <div className="workspace-empty">
                <Icon name="activity" />
                <h2>Session ready</h2>
                <p>
                  Run a demo inspection to list repository files and save its activity. This view
                  shows the latest exchange in the selected session.
                </p>
              </div>
            ) : null}
          </div>
          <form className="composer" onSubmit={handleSubmit}>
            <div className="demo-disclosure" id="demo-disclosure">
              <strong>Demo inspection</strong>
              <p>
                The current provider lists files and returns a fixed completion message. It does not
                generate tailored answers.
              </p>
            </div>
            <div className="composer-input">
              <label className="sr-only" htmlFor="instruction">
                Agent instruction
              </label>
              <textarea
                id="instruction"
                aria-describedby="demo-disclosure"
                disabled={!session || submitting}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Start a session to run an inspection…"
                value={message}
                maxLength={8000}
              />
              <div className="composer-controls">
                <span>
                  {creatingSession
                    ? 'Starting read-only session…'
                    : submitting
                      ? 'Running read-only inspection…'
                      : 'Bounded, read-only access'}
                </span>
                <button
                  aria-label="Send instruction"
                  className="primary-button send"
                  disabled={!session || submitting || message.trim().length < 3}
                  type="submit"
                >
                  {creatingSession ? 'Starting…' : submitting ? 'Running…' : 'Inspect'}
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </form>
        </section>
        <section className="work-panel" aria-label="Run events">
          {drawer === 'events' ? null : eventPane}
        </section>
      </div>
      {drawer ? (
        <Drawer
          title={drawer === 'repositories' ? 'Repositories and sessions' : 'Run events'}
          onClose={closeDrawer}
        >
          {drawer === 'repositories' ? repositoryPane : eventPane}
        </Drawer>
      ) : null}
    </main>
  );
}
