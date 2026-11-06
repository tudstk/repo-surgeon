// Run against the isolated proxy fixture and frontend, never a real account or database.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../.impeccable/review/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await context.newPage();
const origin = 'http://127.0.0.1:3001';
const captures = [];

async function capture(name, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (dimensions.width !== width || dimensions.height !== height || dimensions.scrollWidth > width)
    throw new Error(`Invalid viewport for ${name}: ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: `${output}${name}.png`, fullPage: true, animations: 'disabled' });
  captures.push({ name, ...dimensions, url: new URL(page.url()).pathname });
}

async function state(value, selector) {
  await context.addCookies([{ name: 'review_state', value, url: origin }]);
  await page.goto(origin);
  await page.locator(selector).first().waitFor({ state: 'attached' });
}

async function contrast(scheme) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name) => styles.getPropertyValue(`--${name}`).trim();
    const luminance = (hex) => {
      let normalized = hex.replace('#', '');
      if (normalized.length === 3)
        normalized = normalized
          .split('')
          .map((value) => value + value)
          .join('');
      const channels = normalized
        .match(/../g)
        .map((value) => parseInt(value, 16) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const ratio = (a, b) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const pairs = [];
    for (const foreground of ['text', 'muted', 'accent', 'success', 'warning', 'danger']) {
      for (const background of ['canvas', 'panel', 'raised']) pairs.push([foreground, background]);
    }
    pairs.push(
      ['accent-ink', 'accent'],
      ['accent', 'selected'],
      ['danger', 'danger-surface'],
      ['muted', 'danger-surface'],
      ['muted', 'hover'],
    );
    return {
      tokens: Object.fromEntries(
        [
          'canvas',
          'panel',
          'raised',
          'hover',
          'border',
          'control-border',
          'text',
          'muted',
          'accent',
          'accent-ink',
          'selected',
          'success',
          'warning',
          'danger',
          'danger-surface',
        ].map((name) => [name, token(name)]),
      ),
      pairs: pairs.map(([foreground, background]) => ({
        foreground,
        background,
        ratio: Number(ratio(token(foreground), token(background)).toFixed(2)),
      })),
      controls: ['canvas', 'panel'].map((background) => ({
        foreground: 'control-border',
        background,
        ratio: Number(ratio(token('control-border'), token(background)).toFixed(2)),
      })),
      computed: {
        body: {
          font: getComputedStyle(document.body).font,
          color: getComputedStyle(document.body).color,
          background: getComputedStyle(document.body).backgroundColor,
        },
        composer: { padding: getComputedStyle(document.querySelector('.composer')).padding },
        heading: { font: getComputedStyle(document.querySelector('h1')).font },
      },
    };
  });
}

try {
  await page.goto(`${origin}/login`);
  await page.getByRole('heading', { name: 'Sign in to Repo Surgeon' }).waitFor();
  await capture('login-desktop', 1440, 900);
  await capture('login-mobile', 390, 844);
  await page.goto(
    `${origin}/api/v1/auth/github/callback?code=deterministic-test-code&state=valid-state`,
  );
  await page.waitForURL(`${origin}/profile`);
  await page.locator('.profile-identity').waitFor();
  await capture('profile-desktop', 1440, 900);
  await capture('profile-mobile', 390, 844);
  await state('saved', '.event-row');
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['desktop-1280', 1280, 800],
    ['desktop-1200', 1200, 900],
    ['desktop-1920', 1920, 1080],
    ['mobile', 390, 844],
  ])
    await capture(name, width, height);
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await capture('mobile-repositories', 390, 844);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Run events/ }).click();
  await capture('mobile-events', 390, 844);
  await page.keyboard.press('Escape');
  const dark = await contrast('dark');
  const light = await contrast('light');
  await capture('light-mobile', 390, 844);
  await capture('light-desktop', 1440, 900);
  await capture('zoom-reflow', 720, 450);
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const [name, selector] of [
    ['empty', '.conversation .workspace-empty h2'],
    ['error', '.workspace-alert'],
    ['failed', '.event-failed'],
  ]) {
    await state(name, selector);
    await capture(`${name}-desktop`, 1440, 900);
    await capture(`${name}-mobile`, 390, 844);
    if (name === 'failed') {
      await page.getByRole('button', { name: /Run events/ }).click();
      await capture('failed-mobile-events', 390, 844);
      await page.keyboard.press('Escape');
    }
  }
  await state('ready', '.conversation .workspace-empty h2');
  await capture('ready-mobile', 390, 844);
  await state('loading', '.loading-state');
  await capture('loading-desktop', 1440, 900);
  await state('busy', '.event-row');
  await page.getByRole('button', { name: 'Send instruction' }).click();
  await page.getByText('Running read-only inspection…').waitFor();
  await capture('busy-desktop', 1440, 900);
  await page.goto(`${origin}/audit-ledger`);
  await page.getByRole('heading', { name: 'Audit Ledger' }).waitFor();
  await capture('unavailable-desktop', 1440, 900);
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto(`${origin}/auth/callback`);
  await page.getByRole('button', { name: 'Retry session check' }).waitFor();
  await capture('callback-error-mobile', 390, 844);
  await page.unroute('**/api/v1/auth/session');
  await writeFile(
    `${output}capture-manifest.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        fixture: 'Synthetic isolated same-origin proxy; no real GitHub/PostgreSQL evidence',
        userViewport:
          'Unknown; 1200 and 1920 are supplemental coverage, not measured user dimensions',
        captures,
        contrast: { dark, light },
      },
      null,
      2,
    ),
  );
  if (
    [dark, light].some(
      (theme) =>
        theme.pairs.some((pair) => !Number.isFinite(pair.ratio) || pair.ratio < 4.5) ||
        theme.controls.some((pair) => !Number.isFinite(pair.ratio) || pair.ratio < 3),
    )
  )
    throw new Error('Contrast requirements failed; inspect capture-manifest.json');
  console.log(
    JSON.stringify({
      captures: captures.length,
      darkMinimum: Math.min(...dark.pairs.map((pair) => pair.ratio)),
      lightMinimum: Math.min(...light.pairs.map((pair) => pair.ratio)),
      output,
    }),
  );
} finally {
  await browser.close();
}
