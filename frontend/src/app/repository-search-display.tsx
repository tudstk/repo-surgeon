export type RepositorySummary = {
  language: string | null;
  languageConfidence: 'high' | 'medium' | 'low' | 'unknown';
  fileCount: number;
  approximateLines: number | null;
  testFramework: string | null;
  testCommand: string | null;
  truncated: boolean;
};

export type SearchCitation = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  label: string;
  text: string;
  before: readonly { number: number; text: string }[];
  after: readonly { number: number; text: string }[];
};

export type SearchActivity = {
  tool: 'search_code';
  phase: 'idle' | 'loading' | 'completed' | 'error';
  summary: string;
  matchCount: number | null;
  durationMs: number | null;
  truncated: boolean;
  skippedFiles: number;
  errorCode: string | null;
  citations: readonly SearchCitation[];
};

function formatLines(lines: number | null) {
  if (lines === null) return 'LOC unavailable';
  return `${new Intl.NumberFormat('en', { notation: 'compact' }).format(lines)} LOC`;
}

export function RepositorySummaryCard({ summary }: { summary: RepositorySummary | null }) {
  return (
    <section className="repo-summary" aria-labelledby="repo-summary-title">
      <div className="summary-heading">
        <h2 id="repo-summary-title">REPO SUMMARY</h2>
        {summary?.truncated && <span className="partial-pill">SCAN PARTIAL</span>}
      </div>
      {summary ? (
        <dl>
        <div>
          <dt>Language</dt>
          <dd>
            {summary.language ?? 'Not detected'}
            {summary.language && <small>{summary.languageConfidence}</small>}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            {summary.fileCount} files · {formatLines(summary.approximateLines)}
          </dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd title={summary.testCommand ?? undefined}>
            {summary.testFramework ?? 'Not detected'}
            {summary.testFramework && <span className="status-dot" aria-hidden="true" />}
          </dd>
        </div>
        </dl>
      ) : (
        <p className="summary-unavailable">Repository summary unavailable.</p>
      )}
    </section>
  );
}

function activityResult(activity: SearchActivity) {
  if (activity.phase === 'idle') return 'No repository';
  if (activity.phase === 'loading') return 'Searching...';
  if (activity.phase === 'error') {
    return activity.errorCode === 'search_timed_out' ? 'Timed out' : 'Search failed';
  }
  if (activity.matchCount === 0) return 'No matches';
  return `${activity.matchCount ?? 0} ${activity.matchCount === 1 ? 'hit' : 'hits'}`;
}

export function SearchActivityRow({
  activity,
  onSelectCitation,
}: {
  activity: SearchActivity;
  onSelectCitation: (citation: SearchCitation) => void;
}) {
  return (
    <div className={`activity-row search-activity ${activity.phase}`}>
      <span aria-hidden="true">▹</span>
      <code>{activity.tool}</code>
      <span className="activity-detail">{activity.summary}</span>
      <strong>{activityResult(activity)}</strong>
      <small>{activity.durationMs === null ? 'pending' : `${activity.durationMs}ms`}</small>
      <div className="activity-badges">
        {activity.truncated && <span className="partial-pill">TRUNCATED</span>}
        {activity.skippedFiles > 0 && (
          <span>
            {activity.skippedFiles} {activity.skippedFiles === 1 ? 'file' : 'files'} skipped
          </span>
        )}
      </div>
      {activity.citations.length > 0 && (
        <div className="search-citations" aria-label="Search citations">
          {activity.citations.map((citation) => (
            <a href="#work-panel" key={citation.id} onClick={() => onSelectCitation(citation)}>
              {citation.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
