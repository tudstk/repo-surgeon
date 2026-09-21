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
  matchLine: number;
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

export type InvestigationEvidence = {
  citation_id: string;
  path: string;
  start_line: number;
  end_line: number;
  label: string;
  excerpt: string;
};

export type InvestigationHypothesis = {
  rank: number;
  title: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: InvestigationEvidence[];
  verification_suggestions: string[];
};

export type InvestigationResult = {
  status: 'complete' | 'partial';
  question: string;
  summary: string;
  hypotheses: InvestigationHypothesis[];
  tool_calls: number;
  returned_bytes: number;
  stop_reason: string | null;
};

export function InvestigationPanel({
  result,
  onSelectEvidence,
}: {
  result: InvestigationResult | null;
  onSelectEvidence: (evidence: InvestigationEvidence) => void;
}) {
  if (!result) {
    return (
      <p className="investigation-empty">Ask why the seeded bug occurs to see ranked leads.</p>
    );
  }
  return (
    <div className="investigation-panel" aria-label="Bug investigation results">
      <div className="investigation-summary">
        <span className="read-only-chip">READ-ONLY INVESTIGATION</span>
        <strong>
          {result.status === 'complete' ? 'Evidence review complete' : 'Evidence review partial'}
        </strong>
        <p>{result.summary}</p>
      </div>
      <div className="hypothesis-list">
        {result.hypotheses.map((hypothesis) => (
          <article className="hypothesis-card" key={`${hypothesis.rank}-${hypothesis.title}`}>
            <div className="hypothesis-topline">
              <span className="hypothesis-rank">#{hypothesis.rank}</span>
              <h3>{hypothesis.title}</h3>
              <span className={`confidence-pill confidence-${hypothesis.confidence}`}>
                {hypothesis.confidence} confidence
              </span>
            </div>
            <p>{hypothesis.explanation}</p>
            <div className="evidence-label">SUPPORTING EVIDENCE</div>
            <div className="evidence-list">
              {hypothesis.evidence.map((evidence) => (
                <a
                  href="#work-panel"
                  key={evidence.citation_id}
                  onClick={() => onSelectEvidence(evidence)}
                >
                  <code>{evidence.label}</code>
                  <span>{evidence.excerpt}</span>
                </a>
              ))}
            </div>
            <div className="evidence-label">VERIFY NEXT</div>
            <ul>
              {hypothesis.verification_suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <small className="investigation-budget">
        Bounded trace · {result.tool_calls} read tool calls · {result.returned_bytes} bytes · no
        writes permitted
      </small>
    </div>
  );
}

// Module-scoped helpers are intentional in this client component.
// skipcq: JS-0067
function formatLines(lines: number | null) {
  if (lines === null) return 'LOC unavailable';
  return `${new Intl.NumberFormat('en', { notation: 'compact' }).format(lines)} LOC`;
}

// skipcq: JS-0067, JS-R1005, JS-0415
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

// skipcq: JS-0067, JS-R1005
function activityResult(activity: SearchActivity) {
  if (activity.phase === 'idle') return 'No repository';
  if (activity.phase === 'loading') return 'Searching...';
  if (activity.phase === 'error') {
    return activity.errorCode === 'search_timed_out' ? 'Timed out' : 'Search failed';
  }
  if (activity.matchCount === 0) return 'No matches';
  return `${activity.matchCount ?? 0} ${activity.matchCount === 1 ? 'hit' : 'hits'}`;
}

// skipcq: JS-0067, JS-R1005
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
