import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { CallbackScreen, LoginScreen, ProfileScreen } from './auth-shell';

const replace = vi.fn();
const router = { replace };
let query = '';

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(query),
}));

const browserSession = {
  user: {
    display_name: 'Ada Lovelace',
    github_login: 'ada',
    github_avatar_url: 'https://avatars.example/ada.png',
    github_profile_url: 'https://github.com/ada',
  },
  csrf_token: 'csrf-for-current-session',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('identity journey', () => {
  beforeEach(() => {
    replace.mockReset();
    query = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('shows the logged-out login state and navigates to the configured backend OAuth start', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, 401))),
    );

    render(<LoginScreen />);

    await screen.findByRole('heading', { name: 'Sign in to Repo Surgeon' });
    expect(screen.getByRole('link', { name: /Continue with GitHub/i })).toHaveAttribute(
      'href',
      'http://api.test/api/v1/auth/github/start',
    );
    expect(screen.getByText(/only your public profile identity/i)).toBeInTheDocument();
    expect(screen.getByText(/Repository connections are not available yet/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/api/v1/auth/session',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' }),
    );
  });

  it('redirects an existing session from login without rendering a workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(browserSession))),
    );

    render(<LoginScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/profile'));
    expect(screen.queryByText(/Repositories and evidence context/i)).not.toBeInTheDocument();
  });

  it('renders an accessible provider error without exposing callback values', async () => {
    query = 'error=oauth_state_invalid';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, 401))),
    );

    render(<LoginScreen />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub sign-in could not be completed. Please try again.',
    );
  });

  it('resolves the callback session and replaces browser history with profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(browserSession))),
    );

    render(<CallbackScreen />);

    expect(screen.getByText('Signing you in securely…')).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/profile'));
  });

  it('offers a retry when callback session resolution fails', async () => {
    let shouldFail = true;
    const fetchMock = vi.fn(() =>
      Promise.resolve(shouldFail ? jsonResponse({}, 401) : jsonResponse(browserSession)),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CallbackScreen />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not confirm your sign-in session.',
    );
    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/profile'));
  });

  it('renders only safe profile data and sends the in-memory CSRF token during logout', async () => {
    const fetchMock = vi.fn((_: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(null, { status: 204 })
          : jsonResponse(browserSession),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ProfileScreen />);

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    const githubProfileLink = screen
      .getAllByRole('link', { name: /@ada/i })
      .find((link) => link.getAttribute('href') === 'https://github.com/ada');
    expect(githubProfileLink).toHaveAttribute('href', 'https://github.com/ada');
    expect(screen.getByText('Connections are not available yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?signed_out=1'));
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/logout',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        headers: { 'X-CSRF-Token': 'csrf-for-current-session' },
        method: 'POST',
      }),
    );
  });

  it('redirects unauthenticated profile requests to login and leaves repository data unloaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, 401))),
    );

    render(<ProfileScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(/repository-1|payments-api/i)).not.toBeInTheDocument();
  });

  it('renders a profile without a GitHub profile URL safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            ...browserSession,
            user: { ...browserSession.user, github_profile_url: null },
          }),
        ),
      ),
    );

    render(<ProfileScreen />);

    expect(await screen.findAllByText('@ada')).toHaveLength(2);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/profile',
    ]);
  });

  it('keeps a failed logout honest and retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST' ? jsonResponse({}, 403) : jsonResponse(browserSession),
        ),
      ),
    );

    render(<ProfileScreen />);
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not sign you out. Your session may still be active, so please retry.',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});
