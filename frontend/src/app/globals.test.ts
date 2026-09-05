import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'globals.css'),
  'utf8',
);
const shellRules = stylesheet.match(/\.workspace-shell\s*\{([^}]*)\}/)?.[1] ?? '';
const gridRules = stylesheet.match(/\.workspace-grid\s*\{([^}]*)\}/)?.[1] ?? '';

describe('viewport shell contract', () => {
  it('keeps the application shell free of screenshot-frame constraints', () => {
    expect(shellRules).toMatch(/min-height:\s*100dvh/);
    expect(shellRules).toMatch(/height:\s*100%/);
    expect(shellRules).not.toMatch(/max-width:/);
    expect(gridRules).not.toMatch(/min-height:\s*730px/);
  });
});
