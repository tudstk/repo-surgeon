export type SafeProfile = {
  display_name: string;
  github_login: string;
  github_avatar_url: string | null;
  github_profile_url: string | null;
};

export type BrowserSession = {
  user: SafeProfile;
  csrf_token: string;
};

export class SessionRequestError extends Error {
  constructor(readonly status: number) {
    super(`Session request failed with status ${status}`);
  }
}

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
}

export function authApiUrl(path: string) {
  return `${apiBaseUrl()}${path}`;
}

export async function getBrowserSession(signal?: AbortSignal): Promise<BrowserSession> {
  const response = await fetch(authApiUrl('/api/v1/auth/session'), {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new SessionRequestError(response.status);
  return (await response.json()) as BrowserSession;
}

export async function logout(csrfToken: string): Promise<void> {
  const response = await fetch(authApiUrl('/api/v1/auth/logout'), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'X-CSRF-Token': csrfToken },
  });
  if (!response.ok) throw new SessionRequestError(response.status);
}
