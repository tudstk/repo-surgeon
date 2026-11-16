export type OwnedRepository = {
  id: string;
  name: string;
  github_commit?: string;
};

export type RepositorySummary = {
  languages?: Record<string, number>;
  language: string | null;
  language_confidence: 'high' | 'medium' | 'low' | 'unknown';
  file_count: number;
  total_bytes: number;
  approximate_lines: number | null;
  test_framework: string | null;
  test_command: string | null;
  test_detection: 'detected' | 'ambiguous' | 'not_found' | 'unsupported';
  detected_at: string;
  truncated: boolean;
};

export type ProductSession = {
  id: string;
  repository_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PersistedTurn = {
  run_id: string;
  status: string;
  question: string;
  answer: string;
  started_at: string;
  completed_at: string | null;
};

export type ProductSessionDetail = ProductSession & {
  turns: PersistedTurn[];
};

export type RunEvent = {
  event_id: string;
  run_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  data: Record<string, unknown>;
};

export class WorkspaceRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(`Workspace request failed with ${status}: ${code}`);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
    throw new WorkspaceRequestError(
      response.status,
      body.code ?? 'workspace_request_failed',
      typeof body.detail === 'string' ? body.detail : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function mutationInit(csrfToken: string, body: object): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(body),
  };
}

export function listOwnedRepositories(signal?: AbortSignal) {
  return requestJson<OwnedRepository[]>('/api/v1/repositories', { signal });
}

export type PublicGitHubRepository = {
  full_name: string;
  owner_avatar_url: string | null;
};

export function searchPublicGitHubRepositories(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  return requestJson<PublicGitHubRepository[]>(`/api/v1/repositories/github/search?${params}`, {
    signal,
  });
}

export function getRepositorySummary(repositoryId: string, signal?: AbortSignal) {
  return requestJson<RepositorySummary>(`/api/v1/repositories/${repositoryId}/summary`, {
    signal,
  });
}

export function listProductSessions(repositoryId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ repository_id: repositoryId });
  return requestJson<ProductSession[]>(`/api/v1/sessions?${query}`, { signal });
}

export function getProductSession(sessionId: string, signal?: AbortSignal) {
  return requestJson<ProductSessionDetail>(`/api/v1/sessions/${sessionId}`, { signal });
}

export function createProductSession(repositoryId: string, csrfToken: string) {
  return requestJson<ProductSession>(
    '/api/v1/sessions',
    mutationInit(csrfToken, { repository_id: repositoryId }),
  );
}

export function createReadOnlyTurn(sessionId: string, message: string, csrfToken: string) {
  return requestJson<PersistedTurn>(
    `/api/v1/sessions/${sessionId}/turns`,
    mutationInit(csrfToken, { message }),
  );
}

export async function getPersistedRunEvents(
  runId: string,
  lastEventId?: string,
  signal?: AbortSignal,
): Promise<RunEvent[]> {
  const response = await fetch(`/api/v1/agent-runs/${runId}/events`, {
    credentials: 'include',
    cache: 'no-store',
    headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined,
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
    throw new WorkspaceRequestError(response.status, body.code ?? 'event_stream_failed');
  }
  const payload = await response.text();
  return payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as RunEvent);
}

export function importGitHubRepository(fullName: string, csrfToken: string) {
  return requestJson<OwnedRepository>(
    '/api/v1/repositories/github/import',
    mutationInit(csrfToken, { full_name: fullName }),
  );
}

export async function recoverRepositorySnapshot(repositoryId: string, csrfToken: string) {
  await requestJson<void>(
    `/api/v1/repositories/${repositoryId}/recover`,
    mutationInit(csrfToken, {}),
  );
}

export async function setRepositoryHidden(
  repositoryId: string,
  hidden: boolean,
  csrfToken: string,
) {
  const response = await fetch(`/api/v1/repositories/${repositoryId}/visibility`, {
    credentials: 'include',
    cache: 'no-store',
    ...mutationInit(csrfToken, { hidden }),
  });
  if (!response.ok)
    throw new WorkspaceRequestError(response.status, 'repository_visibility_failed');
}

export function renameProductSession(sessionId: string, title: string, csrfToken: string) {
  return requestJson<ProductSession>(`/api/v1/sessions/${sessionId}`, {
    ...mutationInit(csrfToken, { title }),
    method: 'PATCH',
  });
}

export async function removeProductSession(sessionId: string, csrfToken: string) {
  const response = await fetch(`/api/v1/sessions/${sessionId}/archive`, {
    credentials: 'include',
    cache: 'no-store',
    ...mutationInit(csrfToken, {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new WorkspaceRequestError(
      response.status,
      'session_removal_failed',
      typeof body.detail === 'string' ? body.detail : undefined,
    );
  }
}
