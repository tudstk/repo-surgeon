import { reviewExamples } from './inspection-code';

const cases = [
  { name: 'parsePrice', args: ['-2'], original: -2, reviewed: null },
  { name: 'isSource', args: [{ name: 'index.TS' }], original: false, reviewed: true },
  {
    name: 'changedPaths',
    args: [[{ path: 'a.ts' }, { path: 'a.ts' }]],
    original: ['a.ts', 'a.ts'],
    reviewed: ['a.ts'],
  },
  { name: 'totalChanges', args: [[{ additions: 2, deletions: 3 }]], original: 2, reviewed: 5 },
  { name: 'hasPatch', args: [{ patch: '  ' }], original: true, reviewed: false },
  {
    name: 'sourceWindow',
    args: [Array.from({ length: 210 }, (_, n) => n), -2],
    original: Array.from({ length: 210 }, (_, n) => n),
    reviewed: Array.from({ length: 200 }, (_, n) => n),
  },
];

for (const sample of cases) {
  it(`illustrates a valid self-contained ${sample.name} review`, () => {
    const example = reviewExamples.find((item) => item.name === sample.name)!;
    // These are fixed local illustration strings, never imported repository content.
    const original = new Function(`${example.source}; return ${example.name}`)() as (
      ...args: unknown[]
    ) => unknown;
    const reviewed = new Function(`${example.reviewed}; return ${example.name}`)() as (
      ...args: unknown[]
    ) => unknown;
    expect(original(...sample.args)).toEqual(sample.original);
    expect(reviewed(...sample.args)).toEqual(sample.reviewed);
  });
}
