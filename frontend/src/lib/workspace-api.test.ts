import { vi } from 'vitest';

import { createProductSession, getPersistedRunEvents } from './workspace-api';

describe('workspace API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the in-memory CSRF token when starting a product session', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'session-1',
            repository_id: 'repository-1',
            title: 'Read-only review',
            status: 'active',
            created_at: '2026-09-26T00:00:00Z',
            updated_at: '2026-09-26T00:00:00Z',
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createProductSession('repository-1', 'Read-only review', 'csrf-token');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
      }),
    );
  });

  it('parses normalized SSE and resumes with Last-Event-ID', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          ': persisted-event-stream\n\n' +
            'id: event-2\n' +
            'event: run.completed\n' +
            'data: {"event_id":"event-2","run_id":"run-1","sequence":2,"type":"run.completed","occurred_at":"2026-09-26T00:00:00Z","data":{"status":"completed"}}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const events = await getPersistedRunEvents('run-1', 'event-1');

    expect(events).toHaveLength(1);
    expect(events[0]?.sequence).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/agent-runs/run-1/events',
      expect.objectContaining({ headers: { 'Last-Event-ID': 'event-1' } }),
    );
  });
});
