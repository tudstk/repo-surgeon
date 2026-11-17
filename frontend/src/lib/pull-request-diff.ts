const hunkHeader = /^@@ -(\d{1,10})(?:,(\d{1,10}))? \+(\d{1,10})(?:,(\d{1,10}))? @@/;

export type DiffLine = {
  kind: 'context' | 'removed' | 'added';
  before: number | null;
  after: number | null;
  text: string;
  noNewline?: boolean;
};

type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export function parsePatch(patch: string) {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | undefined;
  let before = 0;
  let after = 0;
  let beforeEnd = 0;
  let afterEnd = 0;
  let additions = 0;
  let deletions = 0;
  let complete = true;

  for (const line of patch.replace(/\r?\n$/, '').split('\n')) {
    const header = hunkHeader.exec(line);
    if (header) {
      if (hunk && (before !== beforeEnd || after !== afterEnd)) complete = false;
      before = Number(header[1]);
      beforeEnd = before + Number(header[2] ?? 1);
      after = Number(header[3]);
      afterEnd = after + Number(header[4] ?? 1);
      hunk = { header: line, lines: [] };
      hunks.push(hunk);
      continue;
    }

    if (!hunk) return null;
    if (line === '\\ No newline at end of file') {
      const previous = hunk.lines.at(-1);
      if (!previous) return null;
      previous.noNewline = true;
      continue;
    }

    const text = line.slice(1);
    if (line[0] === ' ' && before < beforeEnd && after < afterEnd) {
      hunk.lines.push({ kind: 'context', before: before++, after: after++, text });
    } else if (line[0] === '-' && before < beforeEnd) {
      hunk.lines.push({ kind: 'removed', before: before++, after: null, text });
      deletions += 1;
    } else if (line[0] === '+' && after < afterEnd) {
      hunk.lines.push({ kind: 'added', before: null, after: after++, text });
      additions += 1;
    } else {
      return null;
    }
  }

  if (!hunk?.lines.length) return null;
  complete &&= before === beforeEnd && after === afterEnd;
  return { hunks, additions, deletions, complete };
}

export function splitDiffLines(lines: DiffLine[]) {
  const rows: { before?: DiffLine; after?: DiffLine }[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];

  function flushChanges() {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) {
      rows.push({ before: removed[index], after: added[index] });
    }
    removed = [];
    added = [];
  }

  for (const line of lines) {
    if (line.kind === 'removed') {
      // A deletion after additions begins another change block.
      if (added.length > 0) flushChanges();
      removed.push(line);
    } else if (line.kind === 'added') {
      added.push(line);
    } else {
      flushChanges();
      rows.push({ before: line, after: line });
    }
  }
  flushChanges();
  return rows;
}
