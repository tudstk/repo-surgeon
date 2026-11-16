import Image from 'next/image';
import { Icon } from '@/components/ui/icons';
import type { RepositorySummary } from '@/lib/workspace-api';

const languageIcons: Record<string, string> = {
  Python: 'python',
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  Go: 'go',
  Rust: 'rust',
  Java: 'java',
  CSS: 'css3',
  HTML: 'html5',
  Shell: 'bash',
  Ruby: 'ruby',
  PHP: 'php',
  C: 'c',
  'C++': 'cplusplus',
  'C#': 'csharp',
};

const fileCount = new Intl.NumberFormat('en');
const lineCount = new Intl.NumberFormat('en', { notation: 'compact' });

export function RepositorySummaryPanel({
  summary,
  placeholder,
}: {
  summary: RepositorySummary | null;
  placeholder: string;
}) {
  const languages = Object.entries(summary?.languages ?? {}).sort(
    ([, left], [, right]) => right - left,
  );

  return (
    <section className="repo-summary" aria-labelledby="repo-summary-title">
      <h2 id="repo-summary-title">Repository summary</h2>
      {summary ? (
        <>
          <dl className="repo-summary-metrics">
            <div>
              <dt>Files scanned</dt>
              <dd>{fileCount.format(summary.file_count)}</dd>
            </div>
            <div>
              <dt>Approx. LOC</dt>
              <dd>
                {summary.approximate_lines === null
                  ? 'Unavailable'
                  : lineCount.format(summary.approximate_lines)}
              </dd>
            </div>
            <div className="repo-summary-tests">
              <dt>Tests detected</dt>
              <dd>{summary.test_framework ?? 'Not detected'}</dd>
            </div>
          </dl>
          <div className="repo-summary-languages">
            <div className="repo-summary-language-heading">
              <h3>Languages</h3>
              {languages.length > 0 ? <span>By source bytes</span> : null}
            </div>
            {languages.length > 0 ? (
              <ul className="language-list" role="list" aria-label="Language shares">
                {languages.map(([name, percent]) => (
                  <li className="language-share" key={name}>
                    {Object.hasOwn(languageIcons, name) ? (
                      <Image
                        className="language-icon"
                        src={`/languages/${languageIcons[name]}.svg`}
                        alt=""
                        width={18}
                        height={18}
                        unoptimized
                      />
                    ) : (
                      <Icon name="repo" />
                    )}
                    <span>{name}</span>
                    <span className="language-percent">{percent.toFixed(1)}%</span>
                    <span className="language-track" aria-hidden="true">
                      <span style={{ inlineSize: `${percent}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="repo-summary-muted">{summary.language ?? 'Not detected'}</p>
            )}
          </div>
          <details className="repo-scan-details">
            <summary>
              <Icon name="chevron" />
              Scan details
            </summary>
            <div className="repo-scan-details-body">
              <dl>
                <div>
                  <dt>Language confidence</dt>
                  <dd className="repo-scan-confidence">
                    {summary.language_confidence ?? 'Unknown'}
                  </dd>
                </div>
                {summary.detected_at ? (
                  <div>
                    <dt>Scan date (UTC)</dt>
                    <dd>
                      <time dateTime={summary.detected_at}>
                        {new Date(summary.detected_at).toISOString().slice(0, 10)}
                      </time>
                    </dd>
                  </div>
                ) : null}
                {summary.test_command ? (
                  <div>
                    <dt>Detected test command</dt>
                    <dd>
                      <code>{summary.test_command}</code>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p>Test detection identifies frameworks from repository files.</p>
              {summary.truncated ? <p>Scan limits may omit some files or lines.</p> : null}
            </div>
          </details>
        </>
      ) : (
        <p className="repo-summary-muted" role="status">
          {placeholder}
        </p>
      )}
    </section>
  );
}
