import Link from 'next/link';

export function Icon({
  name,
  className = '',
}: {
  name: 'repo' | 'activity' | 'shield' | 'arrow' | 'plus' | 'close' | 'check' | 'error';
  className?: string;
}) {
  const paths = {
    repo: 'M4 3h13v16H4a2 2 0 0 1 0-4h13M4 3a2 2 0 0 0-2 2v12M7 7h6M7 10h4',
    activity: 'M3 12h4l3-7 4 14 3-7h4',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M6 18 18 6',
    check: 'm5 12 4 4L19 6',
    error: 'M12 8v5m0 3h.01M12 3 2 20h20L12 3Z',
  };
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="brand">
      <svg
        viewBox="0 0 24 24"
        className="brand-symbol"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M8 4H4v16h4m8-16h4v16h-4M8 12h8m-4-4v8" />
      </svg>
      <span>Repo Surgeon</span>
    </Link>
  );
}

export function AppHeader({
  active,
  children,
  profileLabel = 'Profile',
}: {
  active?: 'workspace' | 'profile';
  children?: React.ReactNode;
  profileLabel?: string;
}) {
  return (
    <header className="app-header">
      <Brand />
      <nav aria-label="Main navigation">
        <Link href="/" aria-current={active === 'workspace' ? 'page' : undefined}>
          Workspace
        </Link>
        <Link
          href="/profile"
          aria-label={profileLabel}
          aria-current={active === 'profile' ? 'page' : undefined}
        >
          Profile
        </Link>
      </nav>
      {children}
    </header>
  );
}

export function ReadOnlyBadge() {
  return (
    <span className="status-badge success">
      <Icon name="shield" />
      Read-only
    </span>
  );
}
