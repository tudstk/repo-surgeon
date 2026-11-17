import { describe, expect, it } from 'vitest';
import { parsePatch, splitDiffLines } from './pull-request-diff';

describe('GitHub patch display', () => {
  it('retains file line numbers across hunks and aligns uneven replacements', () => {
    const patch = parsePatch(
      '@@ -10,4 +10,3 @@\n context\n-old one\n-old two\n+new\n keep\n@@ -80 +79,2 @@\n unchanged\n+extra\n\\ No newline at end of file',
    );
    expect(patch).toMatchObject({ additions: 2, deletions: 2, complete: true });
    const rows = splitDiffLines(patch!.hunks[0].lines);
    expect(rows.map((row) => [row.before?.before, row.after?.after])).toEqual([
      [10, 10],
      [11, 11],
      [12, undefined],
      [13, 12],
    ]);
    expect(patch!.hunks[1].lines[1]).toMatchObject({ before: null, after: 80, noNewline: true });
  });

  it('reads new and deleted files with zero-length ranges', () => {
    expect(parsePatch('@@ -0,0 +1 @@\n+added')?.hunks[0].lines[0]).toEqual({
      kind: 'added',
      before: null,
      after: 1,
      text: 'added',
    });
    expect(parsePatch('@@ -1 +0,0 @@\n-removed')?.hunks[0].lines[0]).toEqual({
      kind: 'removed',
      before: 1,
      after: null,
      text: 'removed',
    });
  });

  it('distinguishes incomplete patches from malformed input', () => {
    expect(parsePatch('@@ -1,3 +1,3 @@\n-old\n+new')?.complete).toBe(false);
    expect(parsePatch('not a patch')).toBeNull();
    expect(parsePatch('@@ -1 +1 @@\n-removed\n+new\n+extra')).toBeNull();
  });
});
