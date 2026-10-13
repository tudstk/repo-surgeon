import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import Workspace from './workspace';

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

const persistedSession = {
  id: 'session-1',
  repository_id: 'repository-1',
  title: 'payments-api read-only review',
  status: 'active',
  created_at: '2026-09-26T00:00:00Z',
  updated_at: '2026-09-26T00:00:01Z',
};

describe('authenticated workspace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not apply a session response from a repository selected earlier', async () => {
    let resolveRepositoryOneDetail: ((response: Response) => void) | undefined;
    const repositoryOneDetail = new Promise<Response>((resolve) => {
      resolveRepositoryOneDetail = resolve;
    });
    const fetchMock = vi.fn((input: string) => {
      if (input === '/api/v1/repositories') {
        return Promise.resolve(
          json([
            { id: 'repository-1', name: 'payments-api' },
            { id: 'repository-2', name: 'web-dashboard' },
          ]),
        );
      }
      if (input.includes('/summary')) {
        return Promise.resolve(
          json({
            language: input.includes('repository-1') ? 'Python' : 'TypeScript',
            file_count: 1,
            approximate_lines: 1,
          }),
        );
      }
      if (input === '/api/v1/sessions?repository_id=repository-1') {
        return Promise.resolve(json([{ ...persistedSession, title: 'payments session' }]));
      }
      if (input === '/api/v1/sessions?repository_id=repository-2') {
        return Promise.resolve(json([]));
      }
      if (input === '/api/v1/sessions/session-1') return repositoryOneDetail;
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Workspace githubLogin="ada" csrfToken="session-csrf" />);

    await screen.findByRole('option', { name: 'web-dashboard' });
    fireEvent.click(screen.getByRole('option', { name: 'web-dashboard' }));
    resolveRepositoryOneDetail?.(
      json({ ...persistedSession, title: 'payments session', turns: [] }),
    );

    await waitFor(() => expect(screen.getByText('Start a tenant-scoped product session')).toBeInTheDocument());
    expect(screen.queryByText('payments session')).not.toBeInTheDocument();
  });

  it('does not apply a newly created session after switching repositories', async () => {
    let resolveCreateSession: ((response: Response) => void) | undefined;
    const createSessionResponse = new Promise<Response>((resolve) => {
      resolveCreateSession = resolve;
    });
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === '/api/v1/repositories') {
        return Promise.resolve(
          json([
            { id: 'repository-1', name: 'payments-api' },
            { id: 'repository-2', name: 'web-dashboard' },
          ]),
        );
      }
      if (input.includes('/summary')) {
        return Promise.resolve(json({ language: 'Python', file_count: 1, approximate_lines: 1 }));
      }
      if (input.startsWith('/api/v1/sessions?')) return Promise.resolve(json([]));
      if (input === '/api/v1/sessions' && init?.method === 'POST') return createSessionResponse;
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Workspace githubLogin="ada" csrfToken="session-csrf" />);

    await screen.findByRole('button', { name: 'Start read-only session' });
    fireEvent.click(screen.getByRole('button', { name: 'Start read-only session' }));
    fireEvent.click(await screen.findByRole('option', { name: 'web-dashboard' }));
    resolveCreateSession?.(json({ ...persistedSession, repository_id: 'repository-1' }));

    await waitFor(() => expect(screen.getByText('Start a tenant-scoped product session')).toBeInTheDocument());
    expect(screen.queryByText('payments-api read-only review')).not.toBeInTheDocument();
  });

  it('retries workspace state loading after a repository-state failure', async () => {
    let summaryAttempts = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input === '/api/v1/repositories') {
        return Promise.resolve(json([{ id: 'repository-1', name: 'payments-api' }]));
      }
      if (input === '/api/v1/repositories/repository-1/summary') {
        summaryAttempts += 1;
        return summaryAttempts === 1
          ? Promise.reject(new Error('summary unavailable'))
          : Promise.resolve(
              json({ language: 'Python', file_count: 12, approximate_lines: 420 }),
            );
      }
      if (input === '/api/v1/sessions?repository_id=repository-1') {
        return Promise.resolve(json([]));
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Workspace githubLogin="ada" csrfToken="session-csrf" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Repository workspace state could not be loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Python')).toBeInTheDocument());
    expect(summaryAttempts).toBe(2);
  });

  it('clears private workspace state when repository discovery fails', async () => {
    let discoveryAttempts = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input === '/api/v1/repositories') {
        discoveryAttempts += 1;
        return discoveryAttempts === 1
          ? Promise.reject(new Error('session expired'))
          : Promise.resolve(json([{ id: 'repository-1', name: 'payments-api' }]));
      }
      if (input === '/api/v1/repositories/repository-1/summary') {
        return Promise.resolve(json({ language: 'Python', file_count: 1, approximate_lines: 1 }));
      }
      if (input === '/api/v1/sessions?repository_id=repository-1') {
        return Promise.resolve(json([{ ...persistedSession, turns: [] }]));
      }
      if (input === '/api/v1/sessions/session-1') {
        return Promise.resolve(json({ ...persistedSession, turns: [] }));
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Workspace githubLogin="ada" csrfToken="session-csrf" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Owned repositories could not be loaded.',
    );
    expect(screen.getByText('Select an owned repository.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Start a tenant-scoped product session')).toBeInTheDocument());
  });

  it('restores persisted normalized events and submits a CSRF-protected turn', async () => {
    let turnCreated = false;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === '/api/v1/repositories') {
        return Promise.resolve(json([{ id: 'repository-1', name: 'payments-api' }]));
      }
      if (input === '/api/v1/repositories/repository-1/summary') {
        return Promise.resolve(
          json({
            language: 'Python',
            language_confidence: 'high',
            file_count: 12,
            total_bytes: 2000,
            approximate_lines: 420,
            test_framework: 'pytest',
            test_command: 'uv run pytest',
            test_detection: 'detected',
            detected_at: '2026-09-26T00:00:00Z',
            truncated: false,
          }),
        );
      }
      if (input.startsWith('/api/v1/sessions?')) {
        return Promise.resolve(json([persistedSession]));
      }
      if (input === '/api/v1/sessions/session-1' && init?.method !== 'POST') {
        return Promise.resolve(
          json({
            ...persistedSession,
            turns: [
              {
                run_id: turnCreated ? 'run-2' : 'run-1',
                status: 'completed',
                question: 'What does this repository contain?',
                answer: 'I completed a bounded read-only inspection of the selected repository.',
                started_at: '2026-09-26T00:00:01Z',
                completed_at: '2026-09-26T00:00:02Z',
              },
            ],
          }),
        );
      }
      if (input.startsWith('/api/v1/agent-runs/')) {
        const runId = turnCreated ? 'run-2' : 'run-1';
        return Promise.resolve(
          new Response(
            `data: {"event_id":"event-1","run_id":"${runId}","sequence":1,"type":"run.started","occurred_at":"2026-09-26T00:00:01Z","data":{}}\n\n` +
              `data: {"event_id":"event-2","run_id":"${runId}","sequence":2,"type":"run.completed","occurred_at":"2026-09-26T00:00:02Z","data":{"status":"completed"}}\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        );
      }
      if (input === '/api/v1/sessions/session-1/turns' && init?.method === 'POST') {
        turnCreated = true;
        return Promise.resolve(
          json({
            run_id: 'run-2',
            status: 'completed',
            question: 'What does this repository contain?',
            answer: 'I completed a bounded read-only inspection of the selected repository.',
            started_at: '2026-09-26T00:00:01Z',
            completed_at: '2026-09-26T00:00:02Z',
          }),
        );
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Workspace githubLogin="ada" csrfToken="session-csrf" />);

    expect(await screen.findByText(/bounded read-only inspection/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Work panel' })).toHaveTextContent('run.completed');
    expect(screen.getByRole('tab', { name: 'Diff unavailable' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Send instruction' }));

    await waitFor(() => expect(turnCreated).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions/session-1/turns',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'session-csrf',
        },
      }),
    );
  });
});
