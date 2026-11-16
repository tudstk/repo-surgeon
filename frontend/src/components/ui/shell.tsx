import Link from 'next/link';
import type { SafeProfile } from '@/lib/auth-api';
import { AccountMenu } from './account-menu';
import { Icon } from './icons';
export { Icon } from './icons';

export function Brand({
  href = '/landing',
  iconOnly = false,
}: {
  href?: string;
  iconOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      className={iconOnly ? 'brand icon-button' : 'brand'}
      aria-label={iconOnly ? 'Repo Surgeon' : undefined}
      title={iconOnly ? 'Repo Surgeon' : undefined}
    >
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
      {iconOnly ? null : <span>Repo Surgeon</span>}
    </Link>
  );
}

export function AppHeader({
  active,
  user,
}: {
  active?: 'profile' | 'settings';
  user?: SafeProfile;
}) {
  return (
    <header className="app-header">
      <Brand />
      <nav aria-label="Main navigation">
        <Link href="/">Workspace</Link>
      </nav>
      {user ? (
        <AccountMenu user={user} active={active} />
      ) : (
        <Link className="account-trigger account-link" href="/profile" aria-label="Profile">
          <Icon name="user" />
        </Link>
      )}
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
