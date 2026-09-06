'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

const SEPARATOR_SIZE = 8;
const DEFAULT_PANE_WIDTHS = [200, 260, 400, 556];
const PANE_LABELS = [
  'Workspace map',
  'Repositories and Git lineage',
  'Conversation and agent trace',
  'Work panel',
];

function paneMinimums(viewportWidth: number) {
  if (viewportWidth <= 1100) return [150, 210, 270, 340];
  if (viewportWidth <= 1284) return [160, 220, 280, 360];
  return [200, 260, 360, 440];
}

function fitPaneWidths(widths: number[], availableWidth: number) {
  const minimums = paneMinimums(availableWidth);
  const availablePanes = Math.max(
    minimums.reduce((sum, width) => sum + width, 0),
    availableWidth - SEPARATOR_SIZE * 3,
  );
  const desired = widths.map((width, index) => Math.max(width, minimums[index]));
  const desiredTotal = desired.reduce((sum, width) => sum + width, 0);

  if (desiredTotal <= availablePanes) {
    desired[3] += availablePanes - desiredTotal;
    return desired;
  }

  const reducible = desired.map((width, index) => width - minimums[index]);
  const reduction = desiredTotal - availablePanes;
  const reducibleTotal = reducible.reduce((sum, width) => sum + width, 0);
  return desired.map(
    (width, index) =>
      width - (reducibleTotal ? (reducible[index] / reducibleTotal) * reduction : 0),
  );
}

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
  const [isStacked, setIsStacked] = useState(false);

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

function PaneSeparator({
  index,
  widths,
  setWidths,
}: {
  index: number;
  widths: number[] | null;
  setWidths: (index: number, delta: number) => void;
}) {
  const dragStart = useRef<{ x: number } | null>(null);
  const label = `Resize ${PANE_LABELS[index]} and ${PANE_LABELS[index + 1]}`;
  const currentWidths = widths ?? DEFAULT_PANE_WIDTHS;
  const minimums = paneMinimums(typeof window === 'undefined' ? 1440 : window.innerWidth);
  const available = Math.max(
    minimums[index] + minimums[index + 1],
    currentWidths[index] + currentWidths[index + 1],
  );
  const value = Math.round(currentWidths[index]);
  const min = minimums[index];
  const max = Math.max(min, Math.round(available - minimums[index + 1]));

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragStart.current) return;
      const delta = event.clientX - dragStart.current.x;
      dragStart.current.x = event.clientX;
      setWidths(index, delta);
    },
    [index, setWidths],
  );

  return (
    <div
      className="pane-separator"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setWidths(index, -16);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setWidths(index, 16);
        } else if (event.key === 'Home') {
          event.preventDefault();
          setWidths(index, min - value);
        } else if (event.key === 'End') {
          event.preventDefault();
          setWidths(index, max - value);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        dragStart.current = { x: event.clientX };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener(
          'pointerup',
          () => {
            dragStart.current = null;
            window.removeEventListener('pointermove', onPointerMove);
          },
          { once: true },
        );
      }}
    />
  );
}

export default function Home() {
  const isStackedLayout = useStackedLayout();
  const gridRef = useRef<HTMLDivElement>(null);
  const [paneWidths, setPaneWidths] = useState<number[] | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const syncWidths = () => {
      const availableWidth = grid.getBoundingClientRect().width;
      if (!availableWidth || isStackedLayout) return;
      setPaneWidths((current) => fitPaneWidths(current ?? DEFAULT_PANE_WIDTHS, availableWidth));
    };

    syncWidths();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncWidths);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [isStackedLayout]);

  const resizePanes = useCallback((index: number, delta: number) => {
    setPaneWidths((current) => {
      const next = [...(current ?? DEFAULT_PANE_WIDTHS)];
      const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
      const minimums = paneMinimums(viewportWidth);
      const maxDelta = next[index + 1] - minimums[index + 1];
      const minDelta = minimums[index] - next[index];
      const boundedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
      next[index] += boundedDelta;
      next[index + 1] -= boundedDelta;
      return next;
    });
  }, []);

  const gridStyle = paneWidths
    ? {
        gridTemplateColumns: paneWidths
          .flatMap((width, index) =>
            index === paneWidths.length - 1
              ? [`${width}px`]
              : [`${width}px`, `${SEPARATOR_SIZE}px`],
          )
          .join(' '),
      }
    : undefined;

  return (
    <main className="workspace-shell" aria-describedby="workspace-preview-description">
      <header className="global-bar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Glyph>⚒</Glyph>
          </span>
          <span className="brand-name">Repo Surgeon</span>
          <span className="bar-divider" />
          <button className="repo-switcher" type="button" aria-label="Switch repository" disabled>
            <Glyph>▣</Glyph> &nbsp; acme/payments-api <Glyph>⌄</Glyph>
          </button>
          <span className="branch-context">
            <Glyph>⑂</Glyph> &nbsp; main <b>3 behind (PREVIEW)</b> &nbsp;<Glyph>→</Glyph>&nbsp;{' '}
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
      <div
        className="workspace-grid"
        data-layout={isStackedLayout ? 'stacked' : 'wide'}
        ref={gridRef}
        style={gridStyle}
      >
        <nav className="workspace-rail" aria-label="Workspace map">
          <div className="rail-label">WORKSPACE MAP</div>
          <div className="rail-health" aria-label="Health: illustrative static preview">
            HEALTHY (PREVIEW)
          </div>
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
            <strong aria-label="Engine daemon status: illustrative static preview">ONLINE</strong>
            <span>Sandbox HEAD (STATIC PREVIEW)</span>
            <code aria-label="Sandbox HEAD: illustrative static preview">9b4ec8f (PREVIEW)</code>
            <span>
              <Glyph>▣</Glyph> &nbsp; STRICT LOCAL CONFINEMENT (STATIC PREVIEW)
            </span>
          </div>
        </nav>
        {!isStackedLayout && (
          <PaneSeparator index={0} widths={paneWidths} setWidths={resizePanes} />
        )}
        <aside className="repo-panel" aria-label="Repositories and Git lineage">
          <PanelHeading number={1}>Repos &amp; lineage</PanelHeading>
          <div className="repo-content">
            <div className="section-kicker">
              CONNECTED REPOS (STATIC PREVIEW) <Glyph>☷</Glyph>
            </div>
            <div className="session-list" role="listbox" aria-label="Connected repositories">
              {sessions.map((session) => (
                <button
                  className={`session-row ${session.active ? 'session-active' : ''}`}
                  key={session.name}
                  type="button"
                  disabled
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
              GIT DAG LINEAGE (STATIC PREVIEW) <code>HEAD: 89b21e (PREVIEW)</code>
            </div>
            <div className="lineage">
              <div className="commit">
                <i aria-hidden="true" />
                <code>a4f81c (PREVIEW)</code>
                <span>origin/main (PREVIEW)</span>
                <small>feat: token schema (PREVIEW)</small>
              </div>
              <div className="commit current">
                <i aria-hidden="true" />
                <code>89b21e (PREVIEW)</code>
                <em>HEAD (PREVIEW)</em>
                <small>draft: storage contract (PREVIEW)</small>
              </div>
            </div>
            <div className="revision-card">
              <b>
                <Glyph>●</Glyph> &nbsp; REV 1 (PREVIEW)
              </b>
              <span>SANDBOX (PREVIEW)</span>
              <strong>TokenStore uncommitted (PREVIEW)</strong>
            </div>
            <div className="sandbox-card">
              <b>
                <Glyph>♙</Glyph> Sandbox Jail #89b2 (STATIC PREVIEW)
              </b>
              <StatusDot />
              <small>/tmp/surgeon-sandbox-89b2 (illustrative path)</small>
              <span>
                NETWORK: OFF <i aria-hidden="true" /> COW-VFS: RDWR (STATIC PREVIEW)
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
                  pytest <StatusDot /> (PREVIEW)
                </dd>
              </div>
              <div>
                <dt>Vector Index</dt>
                <dd>
                  pgvector <Glyph>✓</Glyph> (PREVIEW)
                </dd>
              </div>
            </dl>
          </section>
        </aside>
        {!isStackedLayout && (
          <PaneSeparator index={1} widths={paneWidths} setWidths={resizePanes} />
        )}
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
                  <strong>
                    <Glyph>✓</Glyph> {item.result} (PREVIEW)
                  </strong>
                  <small>{item.time}</small>
                </div>
              ))}
            </div>
            <p className="agent-message finding">
              Found the coupling in <a href="#diff">auth/session.py:52</a>. Drafted a patch and
              verified test suite in Sandbox #89b2 (static preview). See the diff in the staging
              chamber on the right <Glyph>→</Glyph>
            </p>
            <div className="pending-trace">
              proposing patch revision 1, awaiting your approval (STATIC PREVIEW)...
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
              aria-describedby="composer-preview-note"
              readOnly
              placeholder="Instruct agent or type '/' for surgical tools..."
            />
            <p className="sr-only" id="composer-preview-note">
              Preview only. This field is read-only and cannot send instructions.
            </p>
            <div className="composer-controls">
              <button
                type="button"
                disabled
                aria-label="Model selector unavailable in static preview"
              >
                <Glyph>●</Glyph> Claude 3.7 Sonnet (Local Agent) <Glyph>⌄</Glyph>
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
        {!isStackedLayout && (
          <PaneSeparator index={2} widths={paneWidths} setWidths={resizePanes} />
        )}
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
                <Glyph>▣</Glyph> Diff <span className="pending-pill">PENDING (PREVIEW)</span>
              </button>
              <button type="button" role="tab" aria-selected="false" disabled>
                <Glyph>▤</Glyph> Tests <span className="pass-pill">14 PASS (PREVIEW)</span>
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
            <span>(+7 −5) &nbsp;&nbsp; INDEX 47b91e...c892fa 100644 (STATIC PREVIEW)</span>
          </div>
          <div className="hunk-label">@@ -48,11 +48,13 @@ class SessionManager:</div>
          <div className="diff-code" aria-label="Proposed code diff, illustrative static preview">
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
            <span className="test-dot" aria-hidden="true" />{' '}
            <strong>
              Sandbox Tests: 14 passing <Glyph>→</Glyph> 14 passing (STATIC PREVIEW)
            </strong>
            <span>
              Illustrative static preview: 0 regressions detected &nbsp; runtime: 2.4s &nbsp; mem:
              64MB &nbsp; EXIT: 0
            </span>
          </div>
          <div className="approval-panel">
            <p className="approval-status">
              <Glyph>⚠</Glyph> WRITE PENDING (STATIC PREVIEW) - proposal has NOT touched local
              repository disk. &nbsp; <small>REV 1 · SHA256: 4f8e...9a21 (STATIC PREVIEW)</small>
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
      <p className="sr-only" id="workspace-preview-description">
        This entire workspace is an illustrative static preview. Repository, session, Git, sandbox,
        telemetry, test, and approval values are representative only; disabled controls, timestamps,
        and toolbar status do not describe live system state. The composer is read-only and cannot
        send instructions.
      </p>
    </main>
  );
}
