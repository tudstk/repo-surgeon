import Link from 'next/link';

const navigation = [
  { href: '/git-graph-staging', label: 'Git Graph & Staging', icon: '✣' },
  { href: '/agent-traces-stream', label: 'Agent Traces & Stream', icon: '▣' },
  { href: '/', label: 'Staging Chamber', icon: '♟' },
  { href: '/worktrees-locks', label: 'Worktrees & Locks', icon: '◈' },
  { href: '/audit-ledger', label: 'Audit Ledger', icon: '◷' },
] as const;

export default function WorkspacePlaceholder({ title, path }: { title: string; path: string }) {
  return (
    <main className="workspace-shell placeholder-shell">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ⚒
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <span className="branch-context">acme/payments-api · main</span>
        </div>
        <span className="read-only-badge">
          <span className="status-dot" aria-hidden="true" /> READ-ONLY (SAFE SANDBOX)
        </span>
      </header>
      <div className="placeholder-layout">
        <nav className="workspace-rail" aria-label="Workspace map">
          <div className="rail-label">WORKSPACE MAP</div>
          <div className="rail-items">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === path ? 'page' : undefined}
              >
                <span aria-hidden="true">{item.icon}</span> <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
        <section className="placeholder-content" aria-labelledby="placeholder-title">
          <h1 id="placeholder-title">{title}</h1>
        </section>
      </div>
    </main>
  );
}
