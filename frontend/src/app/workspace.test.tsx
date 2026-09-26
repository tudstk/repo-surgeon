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
