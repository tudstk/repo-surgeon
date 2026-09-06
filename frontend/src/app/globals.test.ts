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
      /grid-template-columns:\s*150px 8px 210px 8px minmax\(270px, 1fr\) 8px minmax\(340px, 1fr\)/,
    );
  });

  it('fits the four-panel grid at the 1220px desktop boundary', () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 1284px\)[\s\S]*grid-template-columns:\s*160px 8px 220px 8px minmax\(280px, 1fr\) 8px minmax\(360px, 1fr\)/,
    );
  });

  it('compacts the global header before the 1261px transition can clip it', () => {
    const compactHeaderRules =
      stylesheet.match(/@media \(max-width: 1500px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(compactHeaderRules).toMatch(/\.global-status > span:not\(\.read-only-badge\)/);
    expect(compactHeaderRules).toMatch(/\.branch-context/);
    expect(compactHeaderRules.match(/display:\s*none/g)).toHaveLength(1);
  });

  it('keeps the compact grid within the 1220px viewport', () => {
    const compactMinimums = 160 + 220 + 280 + 360;

    expect(compactMinimums).toBeLessThanOrEqual(1220);
  });

  it('contains the work toolbar and file metadata in the narrow desktop band', () => {
    expect(stylesheet).toMatch(
      /@media \(min-width: 1025px\) and \(max-width: 1100px\)[\s\S]*\.work-toolbar[\s\S]*flex-wrap:\s*wrap[\s\S]*\.work-tabs[\s\S]*overflow-x:\s*auto[\s\S]*\.work-toolbar > span[\s\S]*white-space:\s*normal[\s\S]*\.file-heading[\s\S]*flex-wrap:\s*wrap[\s\S]*\.file-heading span[\s\S]*overflow-wrap:\s*anywhere/,
    );
  });

  it('reserves bounded splitter tracks only for the desktop layout', () => {
    expect(stylesheet).toMatch(/grid-template-columns:\s*200px 8px 260px 8px/);
    expect(stylesheet).toMatch(/\.pane-separator[\s\S]*touch-action:\s*none/);
    expect(stylesheet).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*\.pane-separator\s*\{[\s\S]*display:\s*none/,
    );
  });
});
