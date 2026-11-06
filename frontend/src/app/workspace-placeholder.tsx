import Link from 'next/link';
import { AppHeader, Icon } from '@/components/ui/shell';

export default function WorkspacePlaceholder({ title, path }: { title: string; path: string }) {
  const activity = path === '/agent-traces-stream';
  return (
    <main className="profile-shell">
      <AppHeader />
      <section className="unavailable-page" aria-labelledby="placeholder-title">
        <Icon name="activity" />
        <h1 id="placeholder-title">{title}</h1>
        <p>
          {activity
            ? 'Run activity is available in the workspace.'
            : `${title} is not available in this release.`}
        </p>
        <p>
          {path === '/audit-ledger'
            ? 'Workspace run events provide a partial trace of the latest exchange, not a complete audit log.'
            : activity
              ? 'Select a session in the workspace to review the saved events from its latest exchange.'
              : 'The current workspace supports read-only demo inspections and saved sessions.'}
        </p>
        <Link className="primary-button" href="/">
          Return to workspace
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
