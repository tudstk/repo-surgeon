import { vi } from 'vitest';
import { streamPullReview } from './review-api';

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('review streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delivers split Unicode frames incrementally and requires a terminal event', async () => {
    let output!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              output = c;
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const events: unknown[] = [];
    const task = streamPullReview(
      'session',
      24,
      'request-id',
      'csrf',
      new AbortController().signal,
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(output).toBeDefined());
    const bytes = new TextEncoder().encode(frame('delta', { text: 'Review ✓\n' }));
    for (const byte of bytes) output.enqueue(Uint8Array.of(byte));
    await vi.waitFor(() => expect(events).toEqual([{ type: 'delta', text: 'Review ✓\n' }]));
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/sessions/session/pull-request-reviews',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' },
        body: JSON.stringify({ number: 24, request_id: 'request-id' }),
      }),
    );
    output.enqueue(new TextEncoder().encode(frame('completed', { run_id: 'run' })));
    output.close();
    await task;
    expect(events).toHaveLength(2);
  });

  it('retains the delivered partial answer when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            frame('delta', { text: 'Partial' }) + frame('failed', { detail: 'GitHub timed out.' }),
          ),
      ),
    );
    const seen: unknown[] = [];
    await expect(
      streamPullReview('session', 24, 'request-id', 'csrf', new AbortController().signal, (item) =>
        seen.push(item),
      ),
    ).rejects.toThrow('GitHub timed out.');
    expect(seen).toEqual([{ type: 'delta', text: 'Partial' }]);
  });
});
