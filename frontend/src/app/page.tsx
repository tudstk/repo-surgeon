'use client';

import { useEffect, useState } from 'react';

const STACKED_LAYOUT_QUERY = '(max-width: 1024px)';

const sessions = [
  { name: 'payments-api', active: true },
  { name: 'web-dashboard', active: false },
] as const;

const activity = [
  { tool: 'search_code', detail: '"SessionManager"', result: '6 hits', time: '38ms' },
  { tool: 'read_file', detail: 'auth/session.py:40–118', result: '78 LOC', time: '12ms' },
  { tool: 'run_tests', detail: 'pytest tests/test_session.py', result: '14 pass', time: '2.4s' },
] as const;

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'violet' }) {
  return <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />;
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

function useStackedLayout() {
  const [isStacked, setIsStacked] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 1024 : false,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia(STACKED_LAYOUT_QUERY);
    const updateLayout = () => setIsStacked(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  return isStacked;
}

export default function Home() {
  const isStackedLayout = useStackedLayout();

  return (
    <main className="workspace-shell">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Glyph>⚒</Glyph>
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <button className="repo-switcher" type="button" aria-label="Switch repository" disabled>
            <Glyph>▣</Glyph> &nbsp; acme/payments-api⌄
          </button>
          <span className="branch-context">
            <Glyph>⑂</Glyph> &nbsp; main <b>3 behind</b> &nbsp;→&nbsp;{' '}
            <strong>fix/session-token-store</strong>
          </span>
        </div>
        <div className="global-status">
          <span>
            <StatusDot /> DAEMON: ACTIVE (STATIC PREVIEW) <small>pid: 40912 (illustrative)</small>
          </span>
          <span>AIR-GAPPED VFS: ENFORCED (STATIC PREVIEW)</span>
          <span className="churn">STAGING CHURN: +7 / -5 (STATIC PREVIEW)</span>
          <span className="read-only-badge">
            <StatusDot /> READ-ONLY (SAFE SANDBOX) - STATIC PREVIEW
          </span>
          <button className="compact-button" type="button" disabled>
            <Glyph>▣</Glyph> Audit Log&nbsp; <Glyph>⌘K</Glyph>
          </button>
          <button className="avatar" type="button" aria-label="Open account menu" disabled>
            <Glyph>♙</Glyph>
          </button>
        </div>
      </header>
      <div className="workspace-grid" data-layout={isStackedLayout ? 'stacked' : 'wide'}>
        <nav className="workspace-rail" aria-label="Workspace map">
          <div className="rail-label">WORKSPACE MAP</div>
          <div className="rail-health">HEALTHY</div>
          <div className="rail-items">
            <button type="button" disabled>
              <Glyph>✣</Glyph> <span>Git Graph &amp; Staging</span>
            </button>
            <button type="button" disabled>
              <Glyph>▣</Glyph> <span>Agent Traces &amp; Stream</span>
            </button>
            <button className="rail-active" type="button" aria-current="page" disabled>
              <Glyph>♟</Glyph> <span>Staging Chamber</span>
            </button>
            <button type="button" disabled>
              <Glyph>◈</Glyph> <span>Worktrees &amp; Locks</span>
            </button>
            <button type="button" disabled>
              <Glyph>◷</Glyph> <span>Audit Ledger</span>
            </button>
          </div>
          <div className="rail-footer">
            <span>ENGINE DAEMON (STATIC PREVIEW)</span>
            <strong>ONLINE</strong>
            <span>Sandbox HEAD (STATIC PREVIEW)</span>
            <code>9b4ec8f</code>
            <span>
              <Glyph>▣</Glyph> &nbsp; STRICT LOCAL CONFINEMENT (STATIC PREVIEW)
            </span>
          </div>
        </nav>
        <aside className="repo-panel" aria-label="Repositories and Git lineage">
          <PanelHeading number={1}>Repos &amp; lineage</PanelHeading>
          <div className="repo-content">
            <div className="section-kicker">
              CONNECTED REPOS <Glyph>☷</Glyph>
            </div>
            <div className="session-list" role="listbox" aria-label="Connected repositories">
              {sessions.map((session) => (
                <button
                  className={`session-row ${session.active ? 'session-active' : ''}`}
                  key={session.name}
                  type="button"
                  disabled
                  aria-current={session.active ? 'true' : undefined}
                  aria-selected={session.active}
                  role="option"
                >
                  <span aria-hidden="true">{session.active ? '☑' : '□'}</span>
                  <span>{session.name}</span>
                  {session.active && <StatusDot />}
                </button>
              ))}
              <button className="connect-row" type="button" disabled>
                <Glyph>＋</Glyph> Connect a repo...
              </button>
            </div>
            <div className="lineage-title">
              GIT DAG LINEAGE <code>HEAD: 89b21e</code>
            </div>
            <div className="lineage">
              <div className="commit">
                <i />
                <code>a4f81c</code>
                <span>origin/main</span>
                <small>feat: token schema</small>
              </div>
              <div className="commit current">
                <i />
                <code>89b21e</code>
                <em>HEAD</em>
                <small>draft: storage contract</small>
              </div>
            </div>
            <div className="revision-card">
              <b>● &nbsp; REV 1</b>
              <span>SANDBOX</span>
              <strong>TokenStore uncommitted</strong>
            </div>
            <div className="sandbox-card">
              <b>
                <Glyph>♙</Glyph> Sandbox Jail #89b2 (STATIC PREVIEW)
              </b>
              <StatusDot />
              <small>/tmp/surgeon-sandbox-89b2 (illustrative path)</small>
              <span>
                NETWORK: OFF <i /> COW-VFS: RDWR (STATIC PREVIEW)
              </span>
            </div>
            <div className="section-kicker context-kicker">
              THIS SESSION CONTEXT (STATIC PREVIEW)
            </div>
            <div className="context-list" role="listbox" aria-label="Session context">
              <span role="option" aria-selected="false">
                Where is auth handled?
              </span>
              <span role="option" aria-selected="false">
                Why do users get logged out?
              </span>
              <b role="option" aria-selected="true">
                Refactor session module... <StatusDot tone="violet" />
              </b>
            </div>
          </div>
          <section className="repo-summary" aria-labelledby="repo-summary-title">
            <h2 id="repo-summary-title">REPO SUMMARY</h2>
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
                <dd>
                  pytest <StatusDot />
                </dd>
              </div>
              <div>
                <dt>Vector Index</dt>
                <dd>pgvector ✓</dd>
              </div>
            </dl>
          </section>
        </aside>
        <section className="conversation" aria-labelledby="conversation-title">
          <PanelHeading number={2}>
            <span id="conversation-title">Conversation &amp; agent trace</span>
            <span className="stream-status">
              <StatusDot /> STREAM ACTIVE - STATIC PREVIEW
            </span>
          </PanelHeading>
          <div className="conversation-body">
            <div className="message-meta">
              YOU <time>14:28:01</time>
            </div>
            <div className="user-message">
              Refactor the session module to use the new token store, and keep tests green.
            </div>
            <div className="message-meta agent-meta">
              REPO SURGEON <span>sub-agent: refactor-core</span>
              <time>14:28:04</time>
            </div>
            <p className="agent-message">
              I&apos;ll locate the session logic, draft the change in an isolated sandbox, and
              verify tests before proposing it.
            </p>
            <div className="activity-list" aria-label="Agent activity">
              {activity.map((item) => (
                <div className="activity-row" key={item.tool}>
                  <Glyph>▹</Glyph>
                  <code>{item.tool}</code>
                  <span className="activity-detail">{item.detail}</span>
                  <strong>✓ {item.result}</strong>
                  <small>{item.time}</small>
                </div>
              ))}
            </div>
            <p className="agent-message finding">
              Found the coupling in <a href="#diff">auth/session.py:52</a>. Drafted a patch and
              verified test suite in Sandbox #89b2. See the diff in the staging chamber on the right
              →
            </p>
            <div className="pending-trace">
              proposing patch revision 1, awaiting your approval...
            </div>
          </div>
          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <div className="slash-hints">
              <kbd>/explain diff</kbd>
              <kbd>/run-fuzz-tests</kbd>
              <kbd>/revert-sandbox</kbd>
              <kbd>/inspect-memory</kbd>
            </div>
            <textarea
              aria-label="Agent instruction"
              placeholder="Instruct agent or type '/' for surgical tools..."
            />
            <div className="composer-controls">
              <button
                type="button"
                disabled
                aria-label="Model selector unavailable in static preview"
              >
                <Glyph>●</Glyph> Claude 3.7 Sonnet (Local Agent)⌄
              </button>
              <button className="abort" type="button" disabled>
                <Glyph>⊘</Glyph> Abort [Esc]
              </button>
              <button
                className="send"
                type="submit"
                aria-label="Send instruction (preview only)"
                disabled
              >
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
              <button type="button" role="tab" aria-selected="false" disabled>
                <Glyph>‹›</Glyph> Code
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="true"
                className="tab-selected"
                disabled
              >
                <Glyph>▣</Glyph> Diff <span className="pending-pill">PENDING</span>
              </button>
              <button type="button" role="tab" aria-selected="false" disabled>
                <Glyph>▤</Glyph> Tests <span className="pass-pill">14 PASS</span>
              </button>
            </div>
            <span>
              +7 −5 &nbsp; <b>SPLIT</b> &nbsp; UNIFIED
            </span>
          </div>
          <div className="file-heading" id="diff">
            <strong>
              <Glyph>▤</Glyph> &nbsp; auth/session.py
            </strong>
            <span>(+7 −5) &nbsp;&nbsp; INDEX 47b91e...c892fa 100644</span>
          </div>
          <div className="hunk-label">@@ -48,11 +48,13 @@ class SessionManager:</div>
          <div className="diff-code" aria-label="Proposed code diff">
            <div className="code-line">
              <span>48&nbsp;&nbsp; 48</span>
              <code>def __init__(self, ttl_seconds: int = 3600) -&gt; None:</code>
            </div>
            <div className="code-line">
              <span>49&nbsp;&nbsp; 49</span>
              <code> self._ttl = ttl_seconds</code>
            </div>
            <div className="code-line removed">
              <span>50&nbsp;&nbsp; −</span>
              <code> self._sessions = {'{}'}</code>
            </div>
            <div className="code-line added">
              <span>50&nbsp;&nbsp; +</span>
              <code> self._store = TokenStore(default_ttl=ttl_seconds)</code>
            </div>
            <div className="code-line">
              <span>51&nbsp;&nbsp; 51</span>
              <code> self._lock = threading.RLock()</code>
            </div>
            <div className="code-line removed">
              <span>52&nbsp;&nbsp; −</span>
              <code>def resolve(self, token: str) -&gt; Optional[SessionData]:</code>
            </div>
            <div className="code-line added">
              <span>52&nbsp;&nbsp; +</span>
              <code>async def resolve(self, token: str) -&gt; Optional[SessionData]:</code>
            </div>
            <div className="code-line removed">
              <span>53&nbsp;&nbsp; −</span>
              <code> return self._sessions.get(token)</code>
            </div>
            <div className="code-line added">
              <span>53&nbsp;&nbsp; +</span>
              <code> return await self._store.lookup(token)</code>
            </div>
            <div className="code-line">
              <span>54&nbsp;&nbsp; 54</span>
              <code>def invalidate(self, token: str) -&gt; bool:</code>
            </div>
            <div className="code-line removed">
              <span>55&nbsp;&nbsp; −</span>
              <code> return self._sessions.pop(token, None) is not None</code>
            </div>
            <div className="code-line added">
              <span>55&nbsp;&nbsp; +</span>
              <code> return self._store.revoke(token)</code>
            </div>
          </div>
          <div className="test-result">
            <span className="test-dot" /> <strong>Sandbox Tests: 14 passing → 14 passing</strong>
            <span>
              Illustrative static preview: 0 regressions detected &nbsp; runtime: 2.4s &nbsp; mem:
              64MB &nbsp; EXIT: 0
            </span>
          </div>
          <div className="approval-panel">
            <p className="approval-status">
              <Glyph>⚠</Glyph> WRITE PENDING (STATIC PREVIEW) - proposal has NOT touched local
              repository disk. &nbsp; <small>REV 1 · SHA256: 4f8e...9a21</small>
            </p>
            <div className="approval-actions">
              <button type="button" disabled>
                <Glyph>ⓧ</Glyph> Reject
              </button>
              <button type="button" disabled>
                <Glyph>☷</Glyph> Request Changes
              </button>
              <button type="button" disabled>
                <Glyph>↥</Glyph> Apply to Branch <strong>fix/session-token-store</strong>
              </button>
              <button type="button" className="approve-button" disabled>
                <Glyph>⚙</Glyph> Approve &amp; Open PR
              </button>
            </div>
          </div>
        </section>
      </div>
      <h1 className="sr-only">Understand the code. Keep people in control.</h1>
      <p className="sr-only">Apply by approval. Read-only sandbox with explicit human approval.</p>
    </main>
  );
}
