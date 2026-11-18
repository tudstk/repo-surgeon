import { WorkspaceRequestError, type PersistedTurn } from './workspace-api';

export type ReviewModel = { id: string; name: string; description: string };
export type ReviewProvider = {
  available: boolean;
  simulation: boolean;
  model: string;
  default_model?: string;
  models?: ReviewModel[];
};

export type ReviewMetadata = {
  number: number;
  repository: string;
  simulation: boolean;
  model: string;
  title?: string;
  head_sha?: string;
  base_sha?: string;
  limited?: boolean;
  error?: string;
  file_count?: number;
  source_count?: number;
  excerpt_count?: number;
};

export type ReviewEvent =
  | { type: 'started' | 'completed'; turn: PersistedTurn }
  | { type: 'progress'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'context'; context: ReviewMetadata };

export async function getReviewProvider(signal: AbortSignal) {
  return fetch('/api/v1/review-provider', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error('Review provider unavailable');
    return (await response.json()) as ReviewProvider;
  });
}

export async function streamPullReview(
  sessionId: string,
  number: number,
  requestId: string,
  csrfToken: string,
  signal: AbortSignal,
  onEvent: (event: ReviewEvent) => void,
  model?: string,
) {
  const response = await fetch(`/api/v1/sessions/${sessionId}/pull-request-reviews`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ number, request_id: requestId, ...(model ? { model } : {}) }),
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string; code?: string };
    throw new WorkspaceRequestError(response.status, body.code || 'review_failed', body.detail);
  }
  if (!response.body) throw new Error('Review streaming is unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r\n/g, '\n');
      if (buffer.length > 160_000) throw new Error('The review stream exceeded its size limit.');
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split('\n');
        const kind = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const json = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (json) {
          const data = JSON.parse(json);
          if (kind === 'started' || kind === 'completed') {
            onEvent({ type: kind, turn: data as PersistedTurn });
            completed ||= kind === 'completed';
          } else if (kind === 'context')
            onEvent({ type: 'context', context: data as ReviewMetadata });
          else if (kind === 'progress')
            onEvent({ type: 'progress', message: String(data.message) });
          else if (kind === 'delta') onEvent({ type: 'delta', text: String(data.text) });
          else if (kind === 'failed') throw new Error(String(data.detail || 'The review failed.'));
        }
        end = buffer.indexOf('\n\n');
      }
      if (chunk.done) break;
    }
    if (!completed)
      throw new Error(
        'The review connection ended before completion. Its partial answer may be saved.',
      );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
