import { expect, vi } from 'vitest';

import { authApiUrl, getBrowserSession } from './auth-api';

describe('auth API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the configurable split-origin API base without a duplicate slash', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://127.0.0.1:8000/');

    expect(authApiUrl('/api/v1/auth/session')).toBe('http://127.0.0.1:8000/api/v1/auth/session');
  });

  it('requests the session with browser credentials and no HTTP cache', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: {}, csrf_token: 'csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getBrowserSession();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/session',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' }),
    );
  });
});
