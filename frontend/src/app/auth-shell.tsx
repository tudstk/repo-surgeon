'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  authApiUrl,
  getBrowserSession,
  logout,
  type BrowserSession,
  SessionRequestError,
} from '@/lib/auth-api';
import Workspace from './workspace';
import { Avatar } from '@/components/ui/avatar';
import { AppHeader, Brand, Icon, ReadOnlyBadge } from '@/components/ui/shell';

function GitHubMark() {
  return (
    <svg aria-hidden="true" className="github-mark" focusable="false" viewBox="0 0 16 16">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.49c-2.23.49-2.7-1.08-2.7-1.08-.36-.93-.89-1.18-.89-1.18-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.65-.89-3.65-3.96 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.11 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.8a7.7 7.7 0 0 1 2 .27c1.52-1.03 2.19-.82 2.19-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.28.82 2.15 0 3.08-1.88 3.76-3.67 3.95.29.25.54.73.54 1.48v2.19c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

function LoadingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="identity-shell">
      <section className="identity-card identity-loading-card" aria-label="Authentication status">
        <Brand />
        {children}
      </section>
    </main>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getBrowserSession(controller.signal)
      .then(() => router.replace('/profile'))
      .catch(() => {
        if (!controller.signal.aborted) setCheckingSession(false);
      });
    return () => controller.abort();
  }, [router]);

  const providerError = searchParams.get('error');
  const signedOut = searchParams.get('signed_out') === '1';
  if (checkingSession) {
    return (
      <LoadingShell>
        <p aria-live="polite" className="identity-status">
          Checking your session…
        </p>
      </LoadingShell>
    );
  }

  return (
    <main className="identity-shell">
      <section className="identity-card" aria-labelledby="login-title">
        <Brand />
        <div className="identity-copy">
          <h1 id="login-title">Sign in to Repo Surgeon</h1>
          <p>A workspace for inspecting repositories, with you in control.</p>
        </div>
        {signedOut ? (
          <p className="identity-notice" role="status">
            You have been signed out.
          </p>
        ) : null}
        {providerError ? (
          <div className="identity-alert" role="alert">
            GitHub sign-in could not be completed. Please try again.
          </div>
        ) : null}
        <a className="github-button" href={authApiUrl('/api/v1/auth/github/start')}>
          <GitHubMark />
          Continue with GitHub
        </a>
        <p className="identity-footnote">
          We use only your public profile identity to identify your account. Your GitHub access
          token is never stored by Repo Surgeon.
        </p>
        <div className="identity-scope">
          <ReadOnlyBadge />
          <p>
            Sign-in does not import your GitHub repositories. This release shows repositories
            already assigned to your account.
          </p>
        </div>
      </section>
    </main>
  );
}

export function CallbackScreen() {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getBrowserSession(controller.signal)
      .then(() => router.replace('/profile'))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt, router]);

  return (
    <LoadingShell>
      {error ? (
        <>
          <div className="identity-alert" role="alert">
            We could not confirm your sign-in session. Please try again.
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry session check
          </button>
          <Link className="text-link" href="/login">
            Return to sign in
          </Link>
        </>
      ) : (
        <p aria-live="polite" className="identity-status">
          Signing you in securely…
        </p>
      )}
    </LoadingShell>
  );
}

export function ProfileScreen({ view = 'profile' }: { view?: 'profile' | 'settings' }) {
  const router = useRouter();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getBrowserSession(controller.signal)
      .then(setSession)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof SessionRequestError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(true);
      });
    return () => controller.abort();
  }, [attempt, router]);

  const handleLogout = useCallback(async () => {
    if (!session) return;
    setIsLoggingOut(true);
    setLogoutError(false);
    try {
      await logout(session.csrf_token);
      setSession(null);
      router.replace('/login?signed_out=1');
    } catch {
      setLogoutError(true);
      setIsLoggingOut(false);
    }
  }, [router, session]);

  if (loadError) {
    return (
      <LoadingShell>
        <div className="identity-alert" role="alert">
          {view === 'settings'
            ? 'Settings are temporarily unavailable.'
            : 'Your profile is temporarily unavailable.'}{' '}
          No repository data has been loaded.
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setLoadError(false);
            setAttempt((value) => value + 1);
          }}
        >
          {view === 'settings' ? 'Retry settings' : 'Retry profile'}
        </button>
      </LoadingShell>
    );
  }

  if (!session) {
    return (
      <LoadingShell>
        <p aria-live="polite" className="identity-status">
          {view === 'settings' ? 'Loading your settings…' : 'Loading your profile…'}
        </p>
      </LoadingShell>
    );
  }

  const { user } = session;
  if (view === 'settings') {
    return (
      <main className="profile-shell">
        <AppHeader active="settings" user={user} />
        <section className="profile-card" aria-labelledby="settings-title">
          <h1 id="settings-title" className="account-heading">
            Settings
          </h1>
          <div className="profile-details">
            <div>
              <span>Appearance</span>
              <strong>Follows your device</strong>
            </div>
            <div>
              <span>Inspection provider</span>
              <strong>Deterministic demo</strong>
            </div>
          </div>
          <p className="profile-scope">
            There are no configurable settings in this release. Light and dark appearance follow
            your device preference; the inspection provider cannot be changed here.
          </p>
          <Link className="primary-button settings-return" href="/">
            Return to workspace
            <Icon name="arrow" />
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main className="profile-shell">
      <AppHeader active={view} user={user} />
      <section className="profile-card" aria-labelledby="profile-title">
        <h2 className="account-heading">Your account</h2>
        <div className="profile-identity">
          <Avatar user={user} className="profile-avatar" />
          <div>
            <h1 id="profile-title">{user.display_name}</h1>
            {user.github_profile_url ? (
              <a href={user.github_profile_url} rel="noreferrer" target="_blank">
                @{user.github_login} <Icon name="arrow" />
              </a>
            ) : (
              <p className="profile-login">@{user.github_login}</p>
            )}
          </div>
        </div>
        <div className="profile-details">
          <div>
            <span>Identity provider</span>
            <strong>Signed in with GitHub</strong>
          </div>
          <div>
            <span>Workspace access</span>
            <strong>Assigned repositories, read-only</strong>
          </div>
        </div>
        <p className="profile-scope">
          GitHub sign-in identifies your account. Connecting or importing a GitHub repository is not
          available yet.
        </p>
        {logoutError ? (
          <div className="identity-alert" role="alert">
            We could not sign you out. Your session may still be active, so please retry.
          </div>
        ) : null}
        <div className="profile-actions">
          <Link className="continue-button" href="/">
            Continue to workspace
          </Link>
          <button
            className="logout-button"
            disabled={isLoggingOut}
            type="button"
            onClick={handleLogout}
          >
            {isLoggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    </main>
  );
}

export function WorkspaceScreen() {
  const router = useRouter();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getBrowserSession(controller.signal)
      .then(setSession)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof SessionRequestError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(true);
      });
    return () => controller.abort();
  }, [attempt, router]);

  if (loadError) {
    return (
      <LoadingShell>
        <div className="identity-alert" role="alert">
          The workspace is temporarily unavailable. No repository data has been loaded.
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setLoadError(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry workspace
        </button>
      </LoadingShell>
    );
  }

  if (!session) {
    return (
      <LoadingShell>
        <p aria-live="polite" className="identity-status">
          Opening your workspace…
        </p>
      </LoadingShell>
    );
  }

  return <Workspace user={session.user} csrfToken={session.csrf_token} />;
}
