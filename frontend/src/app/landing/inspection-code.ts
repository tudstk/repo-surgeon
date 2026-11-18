/** Fixed, self-contained JavaScript examples for the decorative review illustration. */
export const reviewExamples = [
  {
    name: 'parsePrice',
    source:
      'function parsePrice(raw) { const price = Number(raw); return Number.isFinite(price) ? price : null; }  ',
    reviewed:
      'function parsePrice(raw) { const price = Number(raw); return Number.isFinite(price) && price >= 0 ? price : null; }  ',
  },
  {
    name: 'isSource',
    source: 'function isSource(file) { return /\\.(js|ts|tsx|py)$/.test(file.name); }  ',
    reviewed: 'function isSource(file) { return /\\.(js|ts|tsx|py)$/i.test(file.name); }  ',
  },
  {
    name: 'changedPaths',
    source: 'function changedPaths(files) { return files.map(file => file.path); }  ',
    reviewed:
      'function changedPaths(files) { return [...new Set(files.map(file => file.path))]; }  ',
  },
  {
    name: 'totalChanges',
    source:
      'function totalChanges(files) { return files.reduce((sum, file) => sum + file.additions, 0); }  ',
    reviewed:
      'function totalChanges(files) { return files.reduce((sum, file) => sum + file.additions + file.deletions, 0); }  ',
  },
  {
    name: 'hasPatch',
    source:
      "function hasPatch(file) { const patch = file.patch; return typeof patch === 'string'; }  ",
    reviewed:
      "function hasPatch(file) { const patch = file.patch; return typeof patch === 'string' && patch.trim().length > 0; }  ",
  },
  {
    name: 'sourceWindow',
    source:
      'function sourceWindow(lines, start) { const offset = Math.max(0, start); return lines.slice(offset); }  ',
    reviewed:
      'function sourceWindow(lines, start) { const offset = Math.max(0, start); return lines.slice(offset, offset + 200); }  ',
  },
] as const;
