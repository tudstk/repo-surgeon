import Link from 'next/link';

const workspaceSections = [
  { href: '/git-graph-staging', icon: '✣', label: 'Git Graph & Staging' },
  { href: '/agent-traces-stream', icon: '▣', label: 'Agent Traces & Stream' },
  { href: '/', icon: '♟', label: 'Staging Chamber' },
  { href: '/worktrees-locks', icon: '◈', label: 'Worktrees & Locks' },
  { href: '/audit-ledger', icon: '◷', label: 'Audit Ledger' },
] as const;

function StatusDot() {
  return <span className="status-dot" aria-hidden="true" />;
}

function Glyph({ children }: { children: React.ReactNode }) {
  return <span aria-hidden="true">{children}</span>;
}

function PanelHeading({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="panel-heading">
      <span className="panel-number">{number}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * The original local-first workspace composition, retained as a visual, inert
 * preview until repository ownership enforcement reaches the public product.
 * It deliberately has no data source and never makes repository API requests.
 */
export default function WorkspaceMock({ githubLogin }: { githubLogin: string }) {
  return (
    <main className="workspace-shell">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Glyph>⚒</Glyph>
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <span className="branch-context">
            <Glyph>⌁</Glyph> bounded evidence workspace
          </span>
        </div>
        <div className="global-status">
          <span className="read-only-badge">
            <StatusDot /> READ-ONLY PREVIEW
          </span>
          <Link
            className="compact-button"
            href="/profile"
            aria-label={`Open profile for @${githubLogin}`}
          >
            @{githubLogin}
          </Link>
        </div>
      </header>

      <div className="workspace-grid workspace-mock-grid" data-layout="wide">
        <nav className="workspace-rail" aria-label="Workspace map">
          <div className="rail-label">WORKSPACE MAP</div>
          <div className="rail-health" aria-label="Preview status: safe">
            SAFE
          </div>
          <div className="rail-items">
            {workspaceSections.map((section) => (
              <Link
                aria-current={section.href === '/' ? 'page' : undefined}
                href={section.href}
                key={section.href}
              >
                <Glyph>{section.icon}</Glyph> <span>{section.label}</span>
              </Link>
            ))}
          </div>
          <div className="rail-footer">
            <span>ACCESS POLICY</span>
            <strong>NO REPOSITORY DATA</strong>
            <span>This is an inert product preview.</span>
          </div>
        </nav>

        <aside className="repo-panel" aria-label="Repositories and evidence context">
          <PanelHeading number={1}>Repositories</PanelHeading>
          <div className="repo-content">
            <div className="section-kicker">
              CONNECTED REPOS <Glyph>☷</Glyph>
            </div>
            <div className="session-list" role="listbox" aria-label="Connected repositories">
              <span className="empty-state" role="option" aria-selected="false">
                Repository connections are not available yet.
              </span>
              <button className="connect-row" type="button" disabled>
                <Glyph>＋</Glyph> Connect a repo...
              </button>
            </div>
            <div className="section-kicker context-kicker">THIS SESSION CONTEXT</div>
            <div className="context-list" role="listbox" aria-label="Session context">
              <span role="option" aria-selected="false">
                The preview does not load repository or tenant data.
              </span>
            </div>
          </div>
          <div className="repo-summary">
            <h2>Repository summary</h2>
            <p className="empty-state">Available after repository authorization is implemented.</p>
          </div>
        </aside>

        <section className="conversation" aria-labelledby="conversation-title">
          <PanelHeading number={2}>
            <span id="conversation-title">Conversation &amp; agent trace</span>
            <span className="stream-status">PREVIEW</span>
          </PanelHeading>
          <div className="conversation-body">
            <div className="message-meta">YOU</div>
            <div className="user-message">
              Why do users get logged out after their session expires?
            </div>
            <div className="message-meta agent-meta">REPO SURGEON</div>
            <p className="agent-message">
              This is the familiar workspace mock. It shows how bounded evidence will be presented,
              but it does not query repositories or access tenant data.
            </p>
            <div className="activity-list" aria-label="Agent activity preview">
              <div className="activity-row">
                <Glyph>›</Glyph>
                <code>search_code</code>
                <span className="activity-detail">Repository access unavailable</span>
                <strong>SAFE</strong>
              </div>
              <div className="activity-row">
                <Glyph>›</Glyph>
                <code>read_file</code>
                <span className="activity-detail">Evidence panel preview only</span>
                <strong>SAFE</strong>
              </div>
            </div>
            <div className="pending-trace">
              Repository connections are unavailable until tenant authorization is complete.
            </div>
          </div>
          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <div className="slash-hints">
              <span>Workspace actions remain disabled in this safe preview.</span>
            </div>
            <textarea
              aria-label="Agent instruction"
              aria-describedby="composer-note"
              disabled
              placeholder="Ask a question after repository connections are available..."
            />
            <p className="sr-only" id="composer-note">
              Repository actions are unavailable until tenant authorization is implemented.
            </p>
            <div className="composer-controls">
              <button type="button" disabled>
                <Glyph>●</Glyph> Agent unavailable <Glyph>⌄</Glyph>
              </button>
              <button className="abort" type="button" disabled>
                <Glyph>⊘</Glyph> Abort
              </button>
              <button className="send" type="submit" aria-label="Send instruction" disabled>
                <Glyph>↑</Glyph>
              </button>
            </div>
          </form>
        </section>

        <section className="work-panel" aria-labelledby="work-panel-title">
          <h2 className="sr-only" id="work-panel-title">
            Work panel
          </h2>
          <div className="work-toolbar">
            <div className="work-tabs" role="tablist" aria-label="Staging views">
              <button
                className="tab-selected"
                type="button"
                role="tab"
                aria-selected="true"
                disabled
              >
                <Glyph>‹›</Glyph> Code
              </button>
              <button type="button" role="tab" aria-selected="false" disabled>
                <Glyph>◌</Glyph> Evidence
              </button>
            </div>
          </div>
          <div className="file-heading">
            <strong>
              <Glyph>▤</Glyph> workspace-preview.ts
            </strong>
            <span>READ-ONLY</span>
          </div>
          <div className="hunk-label">{'// demonstrative workspace only'}</div>
          <div className="diff-code" aria-label="Workspace preview code">
            <div className="code-line">
              <span>1</span>
              <code>{"const repositoryConnection = 'unavailable';"}</code>
            </div>
            <div className="code-line">
              <span>2</span>
              <code>const tenantData = undefined;</code>
            </div>
            <div className="code-line added">
              <span>3</span>
              <code>showPreviewOnly();</code>
            </div>
          </div>
          <div className="pending-trace">
            No code, repository, or tenant data is loaded in this workspace preview.
          </div>
        </section>
      </div>
      <h1 className="sr-only">Understand the code. Keep people in control.</h1>
    </main>
  );
}
