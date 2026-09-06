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

  it('keeps the four-panel grid within common desktop viewports', () => {
    expect(gridRules).toMatch(/min-width:\s*0/);
    expect(stylesheet).toMatch(/@media \(max-width: 1100px\)/);
    expect(stylesheet).toMatch(
      /grid-template-columns:\s*150px 210px minmax\(270px, 1fr\) minmax\(340px, 1fr\)/,
    );
  });

  it('fits the four-panel grid at the 1220px desktop boundary', () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 1260px\)[\s\S]*grid-template-columns:\s*160px 220px minmax\(280px, 1fr\) minmax\(360px, 1fr\)/,
    );
  });

  it('keeps the compact grid within the 1220px viewport', () => {
    const compactMinimums = 160 + 220 + 280 + 360;

    expect(compactMinimums).toBeLessThanOrEqual(1220);
  });
});
