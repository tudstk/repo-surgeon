import { Fragment, useMemo } from 'react';
import { Icon } from '@/components/ui/icons';
import { highlightedCode } from '@/lib/code-highlight';
import { parsePatch, splitDiffLines, type DiffLine } from '@/lib/pull-request-diff';
import type { PullRequestFile } from '@/lib/workspace-api';
import styles from './repository-pull-requests.module.css';

export type DiffLayout = 'unified' | 'split';

function DiffCode({ line, path }: { line?: DiffLine; path: string }) {
  if (!line) return null;
  const marker = { context: ' ', removed: '−', added: '+' }[line.kind];
  return (
    <>
      <span aria-hidden="true" className={styles.diffMarker}>
        {marker}
      </span>
      {line.kind !== 'context' ? (
        <span className="sr-only">{line.kind === 'added' ? 'Added: ' : 'Removed: '}</span>
      ) : null}
      <code>{line.text.length <= 512 ? highlightedCode(path, line.text) : line.text}</code>
      {line.noNewline ? <span className={styles.noNewline}>No newline at end of file</span> : null}
    </>
  );
}

export function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className={styles.counts}>
      <span className={styles.addText} aria-label={`${additions} additions`}>
        +{additions.toLocaleString()}
      </span>
      <span className={styles.removeText} aria-label={`${deletions} deletions`}>
        −{deletions.toLocaleString()}
      </span>
    </span>
  );
}

export function PullRequestDiff({
  file,
  layout,
  onLayout,
}: {
  file: PullRequestFile;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
}) {
  const patch = useMemo(() => (file.patch ? parsePatch(file.patch) : null), [file.patch]);
  const split = layout === 'split';
  const incomplete =
    patch &&
    (!patch.complete || patch.additions !== file.additions || patch.deletions !== file.deletions);
  const unavailableMessage = {
    available: 'GitHub returned a patch that could not be displayed.',
    unavailable: 'GitHub did not include a text patch for this file.',
    limited: 'This patch exceeds the workspace preview limit.',
    restricted: 'This patch contains protected material.',
  }[file.patch_status];

  return (
    <section className={styles.file} aria-label="File diff">
      <header className={styles.fileHeader}>
        <div className={styles.fileIdentity}>
          <Icon name="file" />
          <h4>
            {file.previous_path ? (
              <>
                <bdi>{file.previous_path}</bdi>
                <span aria-label=" renamed to "> → </span>
              </>
            ) : null}
            <bdi>{file.path}</bdi>
          </h4>
        </div>
        <div className={styles.fileTools}>
          <DiffCounts additions={file.additions} deletions={file.deletions} />
          {patch ? (
            <div className={styles.diffModes} role="group" aria-label="Diff layout">
              <button type="button" aria-pressed={!split} onClick={() => onLayout('unified')}>
                Unified
              </button>
              <button type="button" aria-pressed={split} onClick={() => onLayout('split')}>
                Side by side
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {patch ? (
        <>
          {incomplete ? (
            <p className={styles.notice}>GitHub supplied a partial patch for this file.</p>
          ) : null}
          <div
            className={`${styles.diffScroll} diff-syntax`}
            role="region"
            aria-label={`${split ? 'Side-by-side' : 'Unified'} diff`}
            tabIndex={0}
          >
            <table className={`${styles.diffTable} ${split ? styles.split : styles.unified}`}>
              <colgroup>
                <col className={styles.numberColumn} />
                <col className={split ? undefined : styles.numberColumn} />
                <col className={split ? styles.numberColumn : undefined} />
                {split ? <col /> : null}
              </colgroup>
              <thead>
                {split ? (
                  <tr>
                    <th colSpan={2} scope="colgroup">
                      Before
                    </th>
                    <th colSpan={2} scope="colgroup">
                      After
                    </th>
                  </tr>
                ) : (
                  <tr>
                    <th scope="col">Old</th>
                    <th scope="col">New</th>
                    <th scope="col">Change</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {patch.hunks.map((hunk, index) => (
                  <Fragment key={index}>
                    <tr className={styles.hunk}>
                      <td colSpan={split ? 4 : 3}>{hunk.header}</td>
                    </tr>
                    {split
                      ? splitDiffLines(hunk.lines).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            <td data-change={row.before?.kind ?? 'empty'} className={styles.lineNo}>
                              {row.before?.before}
                            </td>
                            <td
                              data-change={row.before?.kind ?? 'empty'}
                              className={styles.lineCode}
                            >
                              <DiffCode line={row.before} path={file.previous_path ?? file.path} />
                            </td>
                            <td data-change={row.after?.kind ?? 'empty'} className={styles.lineNo}>
                              {row.after?.after}
                            </td>
                            <td
                              data-change={row.after?.kind ?? 'empty'}
                              className={styles.lineCode}
                            >
                              <DiffCode line={row.after} path={file.path} />
                            </td>
                          </tr>
                        ))
                      : hunk.lines.map((line, rowIndex) => (
                          <tr key={rowIndex} data-change={line.kind}>
                            <td className={styles.lineNo}>{line.before}</td>
                            <td className={styles.lineNo}>{line.after}</td>
                            <td className={styles.lineCode}>
                              <DiffCode
                                line={line}
                                path={
                                  line.kind === 'removed'
                                    ? (file.previous_path ?? file.path)
                                    : file.path
                                }
                              />
                            </td>
                          </tr>
                        ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className={styles.notice}>{unavailableMessage}</p>
      )}
    </section>
  );
}
