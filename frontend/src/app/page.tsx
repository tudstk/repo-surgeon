const sessions = [
  { name: 'payments-api', active: true },
  { name: 'web-dashboard', active: false },
] as const;

const questions = [
  'Where is auth handled?',
  'Why do users get logged out?',
  'Refactor session module...',
] as const;

const activity = [
  { tool: 'search_code', detail: '"SessionManage...', result: '6 hits' },
  { tool: 'read_file', detail: 'auth/session.py:40–118', result: 'done' },
  { tool: 'run_tests', detail: 'pytest tests/auth...', result: '14 pass' },
] as const;

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'violet' }) {
  return <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />;
}

function PanelHeading({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="panel-heading">
      <span className="panel-number">{number}</span>
      <span>{children}</span>
    </div>
  );
}

export default function Home() {
  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="brand-lockup">
          <StatusDot tone="violet" />
          <span className="brand-name">Repo Surgeon</span>
          <span className="repo-name">acme/payments-api</span>
          <span className="header-separator">·</span>
          <span className="branch-name">
            branch <strong>fix/session-token-store</strong>
          </span>
        </div>
        <div className="header-actions">
          <span className="read-only-badge">
            <StatusDot />
            Read-only
          </span>
          <button className="audit-button" type="button" aria-label="Open audit log">
            <span aria-hidden="true">⇱</span> Audit log
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar" aria-label="Repositories and sessions">
          <PanelHeading number={1}>Repos &amp; sessions</PanelHeading>
          <div className="sidebar-content">
            <p className="eyebrow">Connected</p>
            <nav aria-label="Connected repositories" className="session-list">
              {sessions.map((session) => (
                <button
                  className={`session-row ${session.active ? 'session-active' : ''}`}
                  key={session.name}
                  type="button"
                >
                  <span
                    className={`repo-icon ${session.active ? 'repo-icon-active' : ''}`}
                    aria-hidden="true"
                  >
                    □
                  </span>
                  <span>{session.name}</span>
                </button>
              ))}
              <button className="session-row connect-row" type="button">
                <span aria-hidden="true">＋</span> Connect a repo...
              </button>
            </nav>
            <p className="eyebrow session-eyebrow">This session</p>
            <nav aria-label="Session questions" className="question-list">
              {questions.map((question, index) => (
                <button
                  className={`question-row ${index === 2 ? 'question-active' : ''}`}
                  key={question}
                  type="button"
                >
                  {question}
                </button>
              ))}
            </nav>
            <section className="repo-summary" aria-labelledby="repo-summary-title">
              <h2 id="repo-summary-title">Repo summary</h2>
              <dl>
                <div>
                  <dt>Language</dt>
                  <dd>Python 3.11</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>342 files · 28k LOC</dd>
                </div>
                <div>
                  <dt>Tests</dt>
                  <dd>pytest</dd>
                </div>
                <div>
                  <dt>Index</dt>
                  <dd>pgvector ✓</dd>
                </div>
              </dl>
            </section>
          </div>
        </aside>

        <section className="conversation" aria-labelledby="conversation-title">
          <PanelHeading number={2}>
            <span id="conversation-title">Conversation &amp; agent trace</span>
          </PanelHeading>
          <div className="conversation-content">
            <p className="speaker-label">You</p>
            <div className="user-message">
              Refactor the session module to use the new token store, and keep tests green.
            </div>
            <p className="speaker-label agent-label">Repo Surgeon</p>
            <p className="agent-message">
              I&apos;ll locate the session logic, draft the change, and verify tests before
              proposing it.
            </p>
            <div className="activity-list" aria-label="Agent activity">
              {activity.map((item) => (
                <div className="activity-row" key={item.tool}>
                  <span className="activity-caret" aria-hidden="true">
                    ›
                  </span>
                  <code>{item.tool}</code>
                  <span className="activity-detail">{item.detail}</span>
                  <span className="activity-result">✓ {item.result}</span>
                </div>
              ))}
            </div>
            <p className="agent-message finding">
              Found the coupling in <a href="#diff">auth/session.py:52</a>. Drafted a patch and
              re-ran the suite. See the diff on the right <span aria-hidden="true">→</span>
            </p>
            <div className="pending-trace">
              <span className="trace-caret" aria-hidden="true" /> proposing patch, awaiting your
              approval...
            </div>
          </div>
        </section>

        <section className="work-panel" aria-labelledby="work-panel-title">
          <PanelHeading number={3}>
            <span id="work-panel-title">Work panel</span>
          </PanelHeading>
          <div className="work-tabs" role="tablist" aria-label="Work views">
            <button type="button" role="tab" aria-selected="false">
              Code
            </button>
            <button type="button" role="tab" aria-selected="true" className="tab-selected">
              Diff <span className="pending-pill">Pending</span>
            </button>
            <button type="button" role="tab" aria-selected="false">
              Tests
            </button>
          </div>
          <div className="diff-summary" id="diff">
            <strong>Proposed change.</strong> Replace in-memory session dict with{' '}
            <code>TokenStore</code> in <code>auth/session.py</code> · 1 file, +7 −5.
          </div>
          <div className="file-label">auth/session.py</div>
          <div className="diff-code" aria-label="Proposed code diff">
            <div className="code-line context">
              <span>51</span>
              <code> def __init__(self):</code>
            </div>
            <div className="code-line removed">
              <span>52 −</span>
              <code> self._sessions = {'{}'}</code>
            </div>
            <div className="code-line added">
              <span>52 +</span>
              <code> self._store = TokenStore()</code>
            </div>
            <div className="code-line context">
              <span>54</span>
              <code> def get(self, token):</code>
            </div>
            <div className="code-line removed">
              <span>55 −</span>
              <code> return self._sessions.get(token)</code>
            </div>
            <div className="code-line added">
              <span>55 +</span>
              <code> return self._store.lookup(token)</code>
            </div>
            <div className="code-line added">
              <span>56 +</span>
              <code> def expire(self, token):</code>
            </div>
            <div className="code-line added">
              <span>57 +</span>
              <code> self._store.revoke(token)</code>
            </div>
          </div>
          <div className="test-result">
            <span className="test-dot" aria-hidden="true" />{' '}
            <strong>Tests: 14 passing → 14 passing</strong>
            <span> sandbox · 2.4s</span>
          </div>
          <div className="approval-panel">
            <p className="approval-status">
              <span aria-hidden="true">⚠</span> Write pending - nothing applied yet
            </p>
            <div className="approval-actions">
              <button type="button">Reject</button>
              <button type="button">Request changes</button>
              <button type="button">Apply to branch</button>
              <button type="button" className="approve-button">
                Approve &amp; open PR
              </button>
            </div>
          </div>
        </section>
      </div>
      <h1 className="sr-only">Understand the code. Keep people in control.</h1>
      <p className="sr-only">
        <span>Apply by approval</span> Foundation under construction. Repository connections, agent
        runs, and write approvals are not available yet.
      </p>
    </main>
  );
}
