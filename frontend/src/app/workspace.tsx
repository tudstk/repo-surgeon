'use client';

import { Brand, Icon } from '@/components/ui/shell';
import { AccountMenu } from '@/components/ui/account-menu';
import type { SafeProfile } from '@/lib/auth-api';
import { Drawer } from '@/components/ui/drawer';
import { RowActions } from '@/components/ui/row-actions';
import { SessionActionDialog } from '@/components/ui/session-action-dialog';
import { RepositoryRemovalDialog } from '@/components/ui/repository-removal-dialog';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ReviewAnswer } from './review-answer';
import { streamPullReview, getReviewProvider } from '@/lib/review-api';
import { RepositoryCode } from './repository-code';
import { RepositoryPullRequests } from './repository-pull-requests';
import { RepositoryRevisions, type RepositoryRevision } from './repository-revisions';
import { RepositorySummaryPanel } from './repository-summary-panel';
import { GitHubSync, useGitHubSync } from './github-sync';
import { GitHubRepositoryPicker } from './github-repository-picker';

import {
  createProductSession,
  recoverRepositorySnapshot,
  renameProductSession,
  removeProductSession,
  setRepositoryHidden,
  createReadOnlyTurn,
  getPersistedRunEvents,
  getProductSession,
  getRepositorySummary,
  listOwnedRepositories,
  listProductSessions,
  type OwnedRepository,
  type GitHubPullRequest,
  type PersistedTurn,
  type ProductSession,
  type ProductSessionDetail,
  type RepositorySummary,
  type RunEvent,
  WorkspaceRequestError,
} from '@/lib/workspace-api';

const unavailableRepositoryMessage =
  'This repository is unavailable. Choose another repository or retry later.';

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

const minWorkWidth = 20;
const maxWorkWidth = 50;
const workTabs = [
  { id: 'code', label: 'Code' },
  { id: 'pull-request', label: 'Pull Request' },
  { id: 'activity', label: 'Activity' },
] as const;
type WorkTab = (typeof workTabs)[number]['id'];

function clampWorkWidth(width: number) {
  return Math.min(maxWorkWidth, Math.max(minWorkWidth, width));
}

export default function Workspace({ user, csrfToken }: { user: SafeProfile; csrfToken: string }) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const visibilityPending = useRef(false);
  const [sessionAction, setSessionAction] = useState<{
    action: 'rename' | 'remove';
    session: ProductSession;
  } | null>(null);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const sessionMutationPending = useRef(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const repositoryToggle = useRef<HTMLButtonElement>(null);
  const [removalTarget, setRemovalTarget] = useState<OwnedRepository | null>(null);
  const [removedRepository, setRemovedRepository] = useState<OwnedRepository | null>(null);
  const [repositoryActionError, setRepositoryActionError] = useState<string | null>(null);
  const [repositoriesExpanded, setRepositoriesExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [drawer, setDrawer] = useState<'repositories' | 'work' | null>(null);
  const [historySelection, setHistorySelection] = useState<{
    repositoryId: string;
    revision: RepositoryRevision;
  } | null>(null);
  const [workTab, setWorkTab] = useState<WorkTab>('code');
  const [workWidth, setWorkWidth] = useState(40);
  const [resizingWork, setResizingWork] = useState(false);
  const workDrag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const workTabsId = useId();
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const [showRepositoryPicker, setShowRepositoryPicker] = useState(false);
  const [repositories, setRepositories] = useState<OwnedRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RepositorySummary | null>(null);
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [session, setSession] = useState<ProductSessionDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState('What does this repository contain?');
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<'session' | 'turn' | 'review' | null>(null);
  const reviewRequest = useRef<AbortController | null>(null);
  const [reviewTurn, setReviewTurn] = useState<PersistedTurn | null>(null);
  const [reviewProgress, setReviewProgress] = useState('Preparing review…');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewProvider, setReviewProvider] = useState<{
    available: boolean;
    simulation: boolean;
    model: string;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    void getReviewProvider(controller.signal).then(setReviewProvider, () => undefined);
    return () => {
      controller.abort();
      reviewRequest.current?.abort();
    };
  }, []);
  const submitting = pendingAction !== null;
  const creatingSession = pendingAction === 'session';
  const [error, setError] = useState<string | null>(null);
  const [unavailableRepositoryId, setUnavailableRepositoryId] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const workspaceRequestGeneration = useRef(0);
  const selectedRepositoryIdRef = useRef<string | null>(null);
  const sessionToRestoreAfterSync = useRef<{ repositoryId: string; sessionId: string } | null>(
    null,
  );

  const clearPrivateWorkspace = useCallback(() => {
    workspaceRequestGeneration.current += 1;
    selectedRepositoryIdRef.current = null;
    reviewRequest.current?.abort();
    setReviewTurn(null);
    setReviewError(null);
    setRepositories([]);
    setHistorySelection(null);
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
  // Code previews do not change the selected repository or its saved sessions.
  const historyRevision =
    historySelection && historySelection.repositoryId === selectedRepositoryId
      ? historySelection.revision
      : null;
  const githubSync = useGitHubSync(
    selectedRepository?.github_commit ? selectedRepository.id : undefined,
    csrfToken,
    submitting || removingId !== null,
    (snapshot) => {
      if (
        selectedRepositoryIdRef.current !== snapshot.id ||
        selectedRepository?.github_commit === snapshot.github_commit
      )
        return;
      workspaceRequestGeneration.current += 1;
      sessionToRestoreAfterSync.current = session
        ? { repositoryId: snapshot.id, sessionId: session.id }
        : null;
      setRepositories((current) =>
        current.map((item) => (item.id === snapshot.id ? snapshot : item)),
      );
      setSummary(null);
      setError(null);
      setUnavailableRepositoryId(null);
      setAttempt((value) => value + 1);
    },
  );

  function openSnapshot(repository: OwnedRepository) {
    setReviewTurn(null);
    setReviewError(null);
    workspaceRequestGeneration.current += 1;
    selectedRepositoryIdRef.current = repository.id;
    setRepositories((current) => [
      ...current.filter((entry) => entry.id !== repository.id),
      repository,
    ]);
    setSelectedRepositoryId(repository.id);
    setSummary(null);
    setSessions([]);
    setSession(null);
    setEvents([]);
    setError(null);
    setUnavailableRepositoryId(null);
    setRepositoriesExpanded(true);
    setAttempt((current) => current + 1);
  }

  const latestTurn = reviewTurn ?? session?.turns.at(-1) ?? null;
  const reviewing = pendingAction === 'review';

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
        if (controller.signal.aborted) return;
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
        setUnavailableRepositoryId(null);
        setSummary(repositorySummary);
        setSessions(availableSessions);
        const savedSelection = sessionToRestoreAfterSync.current;
        sessionToRestoreAfterSync.current = null;
        const preferred =
          savedSelection?.repositoryId === selectedRepositoryId
            ? availableSessions.find((item) => item.id === savedSelection.sessionId)
            : undefined;
        const sessionToRestore = preferred ?? availableSessions[0];
        if (sessionToRestore) {
          await restoreSession(sessionToRestore.id, controller.signal, generation);
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
            setUnavailableRepositoryId(selectedRepositoryId);
            setError(unavailableRepositoryMessage);
          } else {
            clearPrivateWorkspace();
            setError('Repository workspace state could not be loaded.');
          }
        }
      });
    return () => controller.abort();
  }, [attempt, clearPrivateWorkspace, restoreSession, selectedRepositoryId]);

  const canRecover = Boolean(
    selectedRepository?.github_commit && selectedRepository.id === unavailableRepositoryId,
  );

  const retryWorkspace = () => {
    setLoading(true);
    setError(null);
    setUnavailableRepositoryId(null);
    setAttempt((value) => value + 1);
  };

  const handleRecoverSnapshot = async () => {
    if (!selectedRepository || recovering) return;
    const generation = workspaceRequestGeneration.current;
    setRecovering(true);
    try {
      await recoverRepositorySnapshot(selectedRepository.id, csrfToken);
      if (generation === workspaceRequestGeneration.current) retryWorkspace();
    } catch (cause) {
      if (generation === workspaceRequestGeneration.current) {
        setError(
          cause instanceof WorkspaceRequestError && cause.detail
            ? cause.detail
            : 'Snapshot recovery failed. Please try again.',
        );
      }
    } finally {
      setRecovering(false);
    }
  };

  const handleStartSession = async () => {
    setSessionsExpanded(true);
    if (!selectedRepository || !summary || submitting) return;
    setReviewTurn(null);
    setReviewError(null);
    const generation = workspaceRequestGeneration.current;
    setPendingAction('session');
    setError(null);
    try {
      const created = await createProductSession(selectedRepository.id, csrfToken);
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
    setReviewTurn(null);
    setReviewError(null);
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

  const handleReview = async (pull: GitHubPullRequest) => {
    if (!selectedRepository || submitting || reviewRequest.current) return;
    const controller = new AbortController();
    reviewRequest.current = controller;
    const generation = workspaceRequestGeneration.current;
    setPendingAction('review');
    setReviewError(null);
    setReviewProgress('Preparing the pull request review…');
    setError(null);
    setEvents([]);
    setReviewTurn({
      run_id: '',
      status: 'running',
      question: 'Code Review this PR',
      answer: '',
      started_at: new Date().toISOString(),
      completed_at: null,
      review: {
        number: pull.number,
        repository: selectedRepository.name,
        title: pull.title,
        model: reviewProvider?.model || 'Review',
        simulation: reviewProvider?.simulation ?? false,
      },
    });
    closeDrawer();
    try {
      let targetSession = session;
      if (!targetSession) {
        const created = await createProductSession(selectedRepository.id, csrfToken);
        if (generation !== workspaceRequestGeneration.current || controller.signal.aborted) return;
        targetSession = { ...created, turns: [] };
        setSessions((current) => [created, ...current]);
        setSession(targetSession);
      }
      await streamPullReview(
        targetSession.id,
        pull.number,
        crypto.randomUUID(),
        csrfToken,
        controller.signal,
        (item) => {
          if (generation !== workspaceRequestGeneration.current || controller.signal.aborted)
            return;
          if (item.type === 'started' || item.type === 'completed') setReviewTurn(item.turn);
          else if (item.type === 'delta')
            setReviewTurn((current) =>
              current
                ? {
                    ...current,
                    answer: current.answer + item.text,
                  }
                : current,
            );
          else if (item.type === 'progress') setReviewProgress(item.message);
          else if (item.type === 'context')
            setReviewTurn((current) =>
              current
                ? {
                    ...current,
                    review: item.context,
                  }
                : current,
            );
        },
      );
      if (generation !== workspaceRequestGeneration.current) return;
      const detail = await getProductSession(targetSession.id);
      if (generation !== workspaceRequestGeneration.current) return;
      setSession(detail);
      const latest = detail.turns.at(-1);
      if (latest) {
        const savedEvents = await getPersistedRunEvents(latest.run_id);
        if (generation === workspaceRequestGeneration.current) setEvents(savedEvents);
      }
    } catch (cause) {
      if (generation !== workspaceRequestGeneration.current) return;
      const detail = controller.signal.aborted
        ? 'Review stopped. Any partial answer remains in this session.'
        : cause instanceof WorkspaceRequestError && cause.detail
          ? cause.detail
          : cause instanceof Error
            ? cause.message
            : 'The review could not be completed.';
      setReviewError(detail);
      setReviewTurn((current) =>
        current
          ? {
              ...current,
              status: 'failed',
            }
          : current,
      );
    } finally {
      if (reviewRequest.current === controller) {
        reviewRequest.current = null;
        setPendingAction(null);
      }
    }
  };

  const changeRepositoryVisibility = async (repository: OwnedRepository, hidden: boolean) => {
    if (visibilityPending.current) return;
    visibilityPending.current = true;
    setRemovingId(repository.id);
    setRepositoryActionError(null);
    try {
      await setRepositoryHidden(repository.id, hidden, csrfToken);
      setRemovedRepository(hidden ? repository : null);
      setRemovalTarget(null);
      if (hidden) {
        setRepositories((current) => current.filter((item) => item.id !== repository.id));
        if (selectedRepositoryIdRef.current === repository.id) {
          workspaceRequestGeneration.current += 1;
          selectedRepositoryIdRef.current = null;
          setSelectedRepositoryId(null);
          setSummary(null);
          setSessions([]);
          setSession(null);
          setEvents([]);
        }
      }
      setAttempt((value) => value + 1);
    } catch {
      setRepositoryActionError(
        hidden
          ? 'Could not remove this repository. Please retry.'
          : 'Could not restore this repository. Please retry.',
      );
    } finally {
      visibilityPending.current = false;
      setRemovingId(null);
    }
  };

  const sessionDisplayName = (title: string) => {
    const name = selectedRepository?.name;
    const prefix = name?.includes('/') ? name.split('/')[0] + '/' : null;
    return prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
  };

  const handleSessionAction = async (title: string) => {
    if (!sessionAction || sessionMutationPending.current) return;
    sessionMutationPending.current = true;
    setSessionActionPending(true);
    setSessionActionError(null);
    const target = sessionAction.session;
    try {
      if (sessionAction.action === 'rename') {
        const renamed = await renameProductSession(target.id, title, csrfToken);
        if (selectedRepositoryIdRef.current === target.repository_id) {
          setSessions((current) => current.map((item) => (item.id === target.id ? renamed : item)));
          setSession((current) =>
            current?.id === target.id ? { ...current, ...renamed } : current,
          );
        }
      } else {
        await removeProductSession(target.id, csrfToken);
        if (selectedRepositoryIdRef.current === target.repository_id) {
          const remaining = sessions.filter((item) => item.id !== target.id);
          setSessions(remaining);
          const generation = ++workspaceRequestGeneration.current;
          if (!session || session.id === target.id) {
            setSession(null);
            setEvents([]);
            if (remaining[0])
              void restoreSession(remaining[0].id, undefined, generation).catch(() => {
                if (generation === workspaceRequestGeneration.current)
                  setError('The next session could not be loaded. Please reload the workspace.');
              });
          }
        }
      }
      setSessionAction(null);
    } catch (cause) {
      setSessionActionError(
        cause instanceof WorkspaceRequestError && cause.detail
          ? cause.detail
          : 'The session could not be updated. Please retry.',
      );
    } finally {
      sessionMutationPending.current = false;
      setSessionActionPending(false);
    }
  };

  const repositoryPane = (
    <>
      <div className="panel-heading sidebar-section-heading">
        <h2>
          <button
            type="button"
            ref={repositoryToggle}
            className="section-toggle"
            aria-expanded={repositoriesExpanded}
            aria-controls="repository-choices"
            onClick={() => setRepositoriesExpanded((value) => !value)}
          >
            <Icon name="chevron" />
            <span>Repositories</span>
            <span className="count">{repositories.length}</span>
          </button>
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Add repository"
          title="Add repository"
          aria-haspopup="dialog"
          onClick={(event) => {
            event.currentTarget.focus();
            setShowRepositoryPicker(true);
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="repo-panel-body">
        <div className="repo-content">
          <div id="repository-choices" className="disclosure-body" hidden={!repositoriesExpanded}>
            {loading ? (
              <div className="loading-state" role="status">
                <span className="skeleton" />
                <span className="skeleton short" />
                Loading repositories…
              </div>
            ) : null}
            {!loading && !error && repositories.length === 0 ? (
              <p className="empty-state">No repositories added yet.</p>
            ) : null}
            <div className="selection-list" role="group" aria-label="Repositories">
              {repositories.map((repository) => (
                <div
                  className="repository-selection"
                  data-selected={repository.id === selectedRepositoryId}
                  key={repository.id}
                >
                  <button
                    disabled={reviewing}
                    aria-pressed={repository.id === selectedRepositoryId}
                    className="selection-row"
                    onClick={() => {
                      if (repository.id === selectedRepositoryId) return;
                      workspaceRequestGeneration.current += 1;
                      setReviewTurn(null);
                      setReviewError(null);
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
                  <RowActions
                    name={repository.name}
                    disabled={submitting || removingId !== null}
                    onRemove={() => {
                      setRepositoryActionError(null);
                      setRemovalTarget(repository);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {repositoryActionError && !removalTarget ? (
            <p role="alert" className="summary-note">
              {repositoryActionError}
            </p>
          ) : null}
          {removedRepository ? (
            <div className="repository-undo">
              <button
                type="button"
                className="icon-button dismiss-removal-notice"
                aria-label="Dismiss removal notice"
                title="Dismiss removal notice"
                disabled={removingId !== null}
                onClick={() => {
                  setRemovedRepository(null);
                  repositoryToggle.current?.focus();
                }}
              >
                <Icon name="close" />
              </button>
              <p role="status">
                Removed {removedRepository.name} from the list. Saved sessions are kept.
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={removingId !== null}
                onClick={() => void changeRepositoryVisibility(removedRepository, false)}
              >
                Undo removal
              </button>
            </div>
          ) : null}
          <div className="section-heading sidebar-section-heading">
            <h2>
              <button
                type="button"
                className="section-toggle"
                aria-expanded={sessionsExpanded}
                aria-controls="session-choices"
                onClick={() => setSessionsExpanded((value) => !value)}
              >
                <Icon name="chevron" />
                <span>Sessions</span>
                <span className="count">{sessions.length}</span>
              </button>
            </h2>
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
          <div
            id="session-choices"
            hidden={!sessionsExpanded}
            className="selection-list"
            role="group"
            aria-label="Sessions"
          >
            {sessions.map((item) => (
              <div
                className="repository-selection"
                data-selected={item.id === session?.id}
                key={item.id}
              >
                <button
                  disabled={reviewing}
                  aria-pressed={item.id === session?.id}
                  className="selection-row"
                  title={sessionDisplayName(item.title)}
                  onClick={() => {
                    const generation = workspaceRequestGeneration.current + 1;
                    setSession(null);
                    setReviewTurn(null);
                    setReviewError(null);
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
                  <span className="session-title">{sessionDisplayName(item.title)}</span>
                </button>
                <RowActions
                  name={`session ${sessionDisplayName(item.title)}`}
                  disabled={submitting || sessionActionPending}
                  onRename={() => {
                    setSessionActionError(null);
                    setSessionAction({ action: 'rename', session: item });
                  }}
                  onRemove={() => {
                    setSessionActionError(null);
                    setSessionAction({ action: 'remove', session: item });
                  }}
                />
              </div>
            ))}
            {selectedRepository && sessions.length === 0 ? (
              <p className="empty-state">Your read-only sessions will appear here.</p>
            ) : null}
          </div>
        </div>
        <RepositorySummaryPanel
          summary={summary}
          placeholder={
            loading || (selectedRepository && !error)
              ? 'Loading repository summary…'
              : selectedRepository
                ? 'Repository summary unavailable.'
                : 'Select a repository.'
          }
        />
      </div>
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

  const workPane = (
    <>
      <div className="work-toolbar">
        <div className="work-tabs" role="tablist" aria-label="Repository work panel">
          {workTabs.map(({ id: tab, label }, index) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${workTabsId}-${tab}`}
              aria-controls={`${workTabsId}-${tab}-panel`}
              aria-selected={workTab === tab}
              tabIndex={workTab === tab ? 0 : -1}
              onClick={() => setWorkTab(tab)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? workTabs.length - 1
                      : (index + direction + workTabs.length) % workTabs.length;
                const next = workTabs[nextIndex].id;
                setWorkTab(next);
                document.getElementById(`${workTabsId}-${next}`)?.focus();
              }}
            >
              <Icon name={tab} />
              {label}
              {tab === 'activity' && events.length ? (
                <span className="count" aria-hidden="true">
                  {events.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {workTab === 'code' && selectedRepository ? (
          selectedRepository.github_commit ? (
            <GitHubSync
              commit={selectedRepository.github_commit}
              previewingHistory={historyRevision !== null}
              state={githubSync}
            />
          ) : (
            <span className="snapshot-caption">Repository files stay unchanged</span>
          )
        ) : null}
      </div>
      <div
        className="work-tab-panel"
        role="tabpanel"
        id={`${workTabsId}-code-panel`}
        aria-labelledby={`${workTabsId}-code`}
        hidden={workTab !== 'code'}
      >
        {selectedRepository?.github_commit ? (
          <RepositoryRevisions
            key={selectedRepository.id}
            repositoryId={selectedRepository.id}
            savedSha={selectedRepository.github_commit}
            revision={historyRevision}
            csrfToken={csrfToken}
            onRevision={(revision) =>
              setHistorySelection(
                revision ? { repositoryId: selectedRepository.id, revision } : null,
              )
            }
          />
        ) : null}
        <RepositoryCode
          key={`${selectedRepositoryId ?? ''}-${attempt}-${historyRevision?.sha ?? 'saved'}`}
          repositoryId={selectedRepositoryId ?? undefined}
          revision={historyRevision?.sha}
        />
      </div>
      <div
        className="work-tab-panel"
        role="tabpanel"
        id={`${workTabsId}-pull-request-panel`}
        aria-labelledby={`${workTabsId}-pull-request`}
        hidden={workTab !== 'pull-request'}
      >
        <RepositoryPullRequests
          key={selectedRepository?.id}
          repositoryId={selectedRepository?.github_commit ? selectedRepository.id : undefined}
          active={workTab === 'pull-request'}
          onReview={(pull) => void handleReview(pull)}
          reviewPending={submitting}
        />
      </div>
      <div
        className="work-tab-panel"
        role="tabpanel"
        id={`${workTabsId}-activity-panel`}
        aria-labelledby={`${workTabsId}-activity`}
        hidden={workTab !== 'activity'}
      >
        {eventPane}
      </div>
    </>
  );

  return (
    <main className="workspace-shell">
      <header className="repository-context">
        <Brand iconOnly />
        <span className="context-name">{selectedRepository?.name ?? 'Your workspace'}</span>
        <button
          className="secondary-button add-repository"
          type="button"
          aria-label="Add repository"
          title="Add repository"
          aria-haspopup="dialog"
          onClick={(event) => {
            event.currentTarget.focus();
            setShowRepositoryPicker(true);
          }}
        >
          <Icon name="plus" />
          <span>Add repository</span>
        </button>
        <AccountMenu user={user} showUsername />
      </header>
      <div className="mobile-pane-controls">
        <button type="button" aria-haspopup="dialog" onClick={() => setDrawer('repositories')}>
          <Icon name="repo" />
          Repositories
        </button>
        <button type="button" aria-haspopup="dialog" onClick={() => setDrawer('work')}>
          <Icon name="code" />
          Repository tools
        </button>
      </div>
      <div
        className="workspace-grid"
        style={{ '--work-width': `${workWidth}vw` } as React.CSSProperties}
        data-resizing-work={resizingWork}
      >
        <aside className="repo-panel" aria-label="Repositories and sessions">
          {drawer === 'repositories' ? null : repositoryPane}
        </aside>
        <section className="conversation" aria-labelledby="conversation-title">
          <div className="panel-heading">
            <h1 id="conversation-title">Latest exchange</h1>
            <span className={`exchange-state ${submitting ? 'warning' : ''}`} role="status">
              {reviewing
                ? 'Reviewing…'
                : creatingSession
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
                  <p>
                    {canRecover && error === unavailableRepositoryMessage
                      ? 'This snapshot could not be opened. Verify its files against the saved GitHub revision to recover it.'
                      : error}
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={recovering}
                    onClick={canRecover ? () => void handleRecoverSnapshot() : retryWorkspace}
                  >
                    {canRecover ? (recovering ? 'Verifying…' : 'Recover snapshot') : 'Retry'}
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
                    : 'Use Add repository to import a public GitHub source snapshot.'}
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
                <div className="assistant-message">
                  <span className="agent-avatar" aria-hidden="true">
                    <Icon name="activity" />
                  </span>
                  <div className="assistant-content">
                    <div className="message-meta agent-meta">
                      Repo Surgeon
                      <span className="status-badge">
                        {latestTurn.review
                          ? latestTurn.review.simulation
                            ? 'Simulation'
                            : latestTurn.review.model
                          : 'Demo'}
                      </span>
                    </div>
                    {latestTurn.review ? (
                      <div className="review-context-note">
                        <strong>
                          PR #{latestTurn.review.number} · {latestTurn.review.title}
                        </strong>
                        {latestTurn.review.head_sha ? (
                          <span>
                            PR revision <code>{latestTurn.review.head_sha.slice(0, 7)}</code>
                          </span>
                        ) : null}
                        {latestTurn.review.limited ? (
                          <span>Some context was omitted by review limits.</span>
                        ) : null}
                      </div>
                    ) : null}
                    {reviewing ? (
                      <div className="review-processing" role="status">
                        <span className="review-processing-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span>{reviewProgress}</span>
                        <button type="button" onClick={() => reviewRequest.current?.abort()}>
                          Stop review
                        </button>
                      </div>
                    ) : null}
                    {latestTurn.review ? (
                      latestTurn.answer ? (
                        <ReviewAnswer text={latestTurn.answer} />
                      ) : null
                    ) : (
                      <p className="agent-message">
                        {latestTurn.answer || 'No answer was returned for this run.'}
                      </p>
                    )}
                    {reviewError || latestTurn.review?.error ? (
                      <p className="review-error" role="alert">
                        {reviewError || latestTurn.review?.error}
                      </p>
                    ) : null}
                    <div className="activity-list" aria-label="Persisted agent activity">
                      {events
                        .filter(
                          (item) => item.type === 'tool.completed' || item.type === 'tool.failed',
                        )
                        .map((item) => (
                          <div className="activity-row" key={item.event_id}>
                            <Icon name={item.type === 'tool.failed' ? 'error' : 'check'} />
                            <code>
                              {typeof item.data.tool === 'string' ? item.data.tool : 'tool'}
                            </code>
                            <span className={item.type === 'tool.failed' ? 'danger' : 'success'}>
                              {item.type === 'tool.completed' ? 'Completed' : 'Failed'}
                            </span>
                          </div>
                        ))}
                    </div>
                    {latestTurn.status !== 'running' && latestTurn.run_id ? (
                      <p className="read-only-note">
                        <Icon name="shield" />
                        Saved to session history. Repository files are unchanged.
                      </p>
                    ) : null}
                    <p
                      className={
                        latestTurn.status === 'failed' ? 'run-outcome danger' : 'run-outcome'
                      }
                    >
                      Run outcome: {latestTurn.status}
                    </p>
                  </div>
                </div>
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
                Demo inspections list files and return a fixed completion message. Use the Pull
                Request tab to request a code review.
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
        <section className="work-panel" aria-label="Repository tools" id={`${workTabsId}-pane`}>
          <div
            className="work-resize"
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            aria-label="Resize repository tools"
            aria-controls={`${workTabsId}-pane`}
            aria-valuemin={minWorkWidth}
            aria-valuemax={maxWorkWidth}
            aria-valuenow={Math.round(workWidth)}
            aria-valuetext={`${Math.round(workWidth)}% of viewport`}
            onPointerDown={(event) => {
              if (event.button !== 0 || workDrag.current) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.focus({ preventScroll: true });
              workDrag.current = { pointerId: event.pointerId, x: event.clientX, width: workWidth };
              setResizingWork(true);
            }}
            onPointerMove={(event) => {
              const drag = workDrag.current;
              if (drag?.pointerId !== event.pointerId) return;
              setWorkWidth(
                clampWorkWidth(drag.width + ((drag.x - event.clientX) / window.innerWidth) * 100),
              );
            }}
            onLostPointerCapture={(event) => {
              if (workDrag.current?.pointerId !== event.pointerId) return;
              workDrag.current = null;
              setResizingWork(false);
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              setWorkWidth((width) => {
                if (event.key === 'Home') return minWorkWidth;
                if (event.key === 'End') return maxWorkWidth;
                return clampWorkWidth(width + (event.key === 'ArrowLeft' ? 2 : -2));
              });
            }}
          />
          {drawer === 'work' ? null : workPane}
        </section>
      </div>
      {drawer ? (
        <Drawer
          title={drawer === 'repositories' ? 'Repositories and sessions' : 'Repository tools'}
          onClose={closeDrawer}
        >
          {drawer === 'repositories' ? repositoryPane : workPane}
        </Drawer>
      ) : null}
      {sessionAction ? (
        <SessionActionDialog
          key={`${sessionAction.session.id}-${sessionAction.action}`}
          name={sessionDisplayName(sessionAction.session.title)}
          action={sessionAction.action}
          pending={sessionActionPending}
          error={sessionActionError}
          onCancel={() => {
            if (!sessionMutationPending.current) setSessionAction(null);
          }}
          onConfirm={(title) => void handleSessionAction(title)}
        />
      ) : null}
      {removalTarget ? (
        <RepositoryRemovalDialog
          name={removalTarget.name}
          pending={removingId !== null}
          error={repositoryActionError}
          onCancel={() => {
            if (visibilityPending.current) return;
            setRemovalTarget(null);
            setRepositoryActionError(null);
          }}
          onConfirm={() => void changeRepositoryVisibility(removalTarget, true)}
        />
      ) : null}
      {showRepositoryPicker ? (
        <GitHubRepositoryPicker
          csrfToken={csrfToken}
          onClose={() => setShowRepositoryPicker(false)}
          onImported={(repository) => {
            openSnapshot(repository);
            setShowRepositoryPicker(false);
            closeDrawer();
          }}
        />
      ) : null}
    </main>
  );
}
