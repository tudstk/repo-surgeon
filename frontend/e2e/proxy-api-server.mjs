import { createServer } from 'node:http';

const port = Number(process.env.PROXY_API_PORT ?? 8010);
const frontendOrigin = process.env.PROXY_FRONTEND_ORIGIN ?? 'http://127.0.0.1:3001';
const sessionCookie = 'repo_surgeon_session=proxy-session';
const session = {
  user: {
    display_name: 'Ada Lovelace',
    github_login: 'ada',
    github_avatar_url: null,
    github_profile_url: 'https://github.com/ada',
  },
  csrf_token: 'proxy-csrf-token',
};
const productSession = {
  id: 'session-1',
  repository_id: 'repository-1',
  title: 'payments-api read-only review',
  status: 'active',
  created_at: '2026-09-26T00:00:00Z',
  updated_at: '2026-09-26T00:00:02Z',
};
const persistedTurn = {
  run_id: 'run-1',
  status: 'completed',
  question: 'What does this repository contain?',
  answer: 'I completed a bounded read-only inspection of the selected repository.',
  started_at: '2026-09-26T00:00:01Z',
  completed_at: '2026-09-26T00:00:02Z',
};

function json(response, status, body) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.url?.startsWith('/health')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }

  if (request.url?.startsWith('/api/v1/auth/github/callback')) {
    response.writeHead(303, {
      'cache-control': 'no-store',
      location: `${frontendOrigin}/auth/callback`,
      'set-cookie': `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`,
    });
    response.end();
    return;
  }

  if (request.url === '/api/v1/auth/session') {
    if (request.headers.cookie?.includes(sessionCookie)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(session));
    } else {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"detail":"Not authenticated"}');
    }
    return;
  }

  if (request.url === '/api/v1/repositories' && request.method === 'GET') {
    json(response, 200, [{ id: 'repository-1', name: 'payments-api' }]);
    return;
  }

  if (request.url === '/api/v1/repositories/repository-1/summary') {
    json(response, 200, {
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
    });
    return;
  }

  if (request.url?.startsWith('/api/v1/sessions?') && request.method === 'GET') {
    json(response, 200, [productSession]);
    return;
  }

  if (request.url === '/api/v1/sessions/session-1' && request.method === 'GET') {
    json(response, 200, { ...productSession, turns: [persistedTurn] });
    return;
  }

  if (request.url === '/api/v1/sessions/session-1/turns' && request.method === 'POST') {
    request.on('data', () => {});
    request.on('end', () => {
      if (request.headers['x-csrf-token'] !== session.csrf_token) {
        json(response, 403, { code: 'request_forbidden' });
        return;
      }
      json(response, 201, persistedTurn);
    });
    return;
  }

  if (request.url === '/api/v1/agent-runs/run-1/events' && request.method === 'GET') {
    const events = [
      {
        event_id: 'event-1',
        run_id: 'run-1',
        sequence: 1,
        type: 'run.started',
        occurred_at: '2026-09-26T00:00:01Z',
        data: { session_id: 'session-1', repository_id: 'repository-1' },
      },
      {
        event_id: 'event-2',
        run_id: 'run-1',
        sequence: 2,
        type: 'tool.completed',
        occurred_at: '2026-09-26T00:00:02Z',
        data: { tool: 'list_files', status: 'success' },
      },
      {
        event_id: 'event-3',
        run_id: 'run-1',
        sequence: 3,
        type: 'answer.completed',
        occurred_at: '2026-09-26T00:00:02Z',
        data: { content: persistedTurn.answer },
      },
      {
        event_id: 'event-4',
        run_id: 'run-1',
        sequence: 4,
        type: 'run.completed',
        occurred_at: '2026-09-26T00:00:02Z',
        data: { status: 'completed' },
      },
    ];
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/event-stream',
    });
    response.end(
      `: persisted-event-stream\n\n${events.map((item) => `id: ${item.event_id}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join('')}`,
    );
    return;
  }

  if (request.url === '/api/v1/auth/logout' && request.method === 'POST') {
    request.on('data', () => {});
    request.on('end', () => {
      if (
        request.headers.cookie?.includes(sessionCookie) &&
        request.headers['x-csrf-token'] === session.csrf_token
      ) {
        response.writeHead(204, {
          'cache-control': 'no-store',
          'set-cookie': 'repo_surgeon_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        });
        response.end();
      } else {
        json(response, 403, { detail: 'Forbidden' });
      }
    });
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(port, '127.0.0.1');
