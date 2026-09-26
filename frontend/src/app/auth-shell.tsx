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

function Brand() {
  return (
    <div className="identity-brand">
      <span aria-hidden="true" className="brand-mark">
        ⚒
      </span>
      <span>Repo Surgeon</span>
    </div>
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
          <p className="eyebrow">IDENTITY</p>
          <h1 id="login-title">Sign in to Repo Surgeon</h1>
          <p>
            Continue with GitHub to create or access your Repo Surgeon identity. We request only
            your public profile identity.
          </p>
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
          <span aria-hidden="true">◖◗</span> Continue with GitHub
        </a>
        <p className="identity-footnote">
          Repository connections are not available yet. Your GitHub access token is never stored by
          Repo Surgeon.
        </p>
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

function ProfileAvatar({ session }: { session: BrowserSession }) {
  const { user } = session;
  if (user.github_avatar_url) {
    // GitHub supplies this safe profile field. Rendering it directly avoids proxying an
    // externally controlled URL through the Next.js image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="profile-avatar" src={user.github_avatar_url} alt="" />;
  }
  return (
    <div className="profile-avatar profile-avatar-fallback" aria-hidden="true">
      {user.display_name[0]}
    </div>
  );
}

export function ProfileScreen() {
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
          Your profile is temporarily unavailable. No repository data has been loaded.
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setLoadError(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry profile
        </button>
      </LoadingShell>
    );
  }

  if (!session) {
    return (
      <LoadingShell>
        <p aria-live="polite" className="identity-status">
          Loading your profile…
        </p>
      </LoadingShell>
    );
  }

  const { user } = session;
  return (
    <main className="identity-shell">
      <section className="profile-card" aria-labelledby="profile-title">
        <header className="profile-header">
          <Brand />
          <Link className="account-control" href="/profile" aria-current="page">
            <span aria-hidden="true" className="account-dot" /> @{user.github_login}
          </Link>
        </header>
        <div className="profile-identity">
          <ProfileAvatar session={session} />
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h1 id="profile-title">{user.display_name}</h1>
            {user.github_profile_url ? (
              <a href={user.github_profile_url} rel="noreferrer" target="_blank">
                @{user.github_login} <span aria-hidden="true">↗</span>
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
            <span>Repository access</span>
            <strong>Connections are not available yet</strong>
          </div>
        </div>
        {logoutError ? (
          <div className="identity-alert" role="alert">
            We could not sign you out. Your session may still be active, so please retry.
          </div>
        ) : null}
        <button
          className="logout-button"
          disabled={isLoggingOut}
          type="button"
          onClick={handleLogout}
        >
          {isLoggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </main>
  );
}
