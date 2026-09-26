import { expect, vi } from 'vitest';

import { authApiUrl, getBrowserSession } from './auth-api';

describe('auth API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses same-origin relative API URLs', () => {
    expect(authApiUrl('/api/v1/auth/session')).toBe('/api/v1/auth/session');
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
      '/api/v1/auth/session',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' }),
    );
  });
});
