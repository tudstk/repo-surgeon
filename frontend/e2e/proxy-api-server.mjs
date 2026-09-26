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

  if (request.url === '/api/v1/auth/logout' && request.method === 'POST') {
    if (
      request.headers.cookie?.includes(sessionCookie) &&
      request.headers['x-csrf-token'] === session.csrf_token
    ) {
      response.writeHead(204, {
        'cache-control': 'no-store',
        'set-cookie': 'repo_surgeon_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      });
    } else {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end('{"detail":"Forbidden"}');
    }
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(port, '127.0.0.1');
