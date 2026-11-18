import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

async function capture(target: Page | Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path, style: 'nextjs-portal { visibility: hidden; }' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const account = {
  user: {
    display_name: 'Ada Lovelace',
    github_login: 'ada',
    github_avatar_url: null,
    github_profile_url: 'https://github.com/ada',
  },
  csrf_token: 'fixture-csrf',
};
const repository = { id: 'repository-1', name: 'sample/inspection-fixture' };
const session = {
  id: 'session-1',
  repository_id: repository.id,
  title: 'Read-only review',
  status: 'active',
  created_at: '2026-10-24T10:00:00Z',
  updated_at: '2026-10-24T10:00:02Z',
};
const turn = {
  run_id: 'run-1',
  status: 'completed',
  question: 'List this repository',
  answer: 'I completed a bounded read-only inspection of the selected repository.',
  started_at: session.created_at,
  completed_at: session.updated_at,
};
const repositorySummary = {
  language: 'Python',
  languages: { Python: 75, TypeScript: 25 },
  language_confidence: 'high',
  file_count: 12,
  approximate_lines: 420,
  test_framework: 'pytest',
  test_command: 'uv run pytest',
  test_detection: 'detected',
  detected_at: session.created_at,
  truncated: true,
};

async function fixture(page: Page, state: 'saved' | 'empty' | 'failed' | 'ready' = 'saved') {
  await page.route('**/api/v1/review-provider', (route) =>
    route.fulfill({ json: { available: true, simulation: true, model: 'Simulation' } }),
  );
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: account }));
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: state === 'empty' ? [] : [repository] }),
  );
  await page.route('**/api/v1/repositories/*/summary', (route) =>
    route.fulfill({ json: repositorySummary }),
  );
  await page.route('**/api/v1/repositories/*/tree?*', (route) =>
    route.fulfill({ json: { entries: [], next_offset: null, scan_limit_reached: false } }),
  );
  await page.route('**/api/v1/repositories/*/sync-status', (route) =>
    route.fulfill({ json: { up_to_date: true } }),
  );
  await page.route('**/api/v1/sessions?*', (route) => route.fulfill({ json: [session] }));
  await page.route('**/api/v1/sessions/session-1', (route) =>
    route.fulfill({
      json: {
        ...session,
        turns:
          state === 'ready'
            ? []
            : [{ ...turn, status: state === 'failed' ? 'failed' : 'completed' }],
      },
    }),
  );
  await page.route('**/api/v1/agent-runs/run-1/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: [
        state === 'failed' ? 'tool.failed' : 'tool.completed',
        state === 'failed' ? 'run.failed' : 'run.completed',
      ]
        .map(
          (type, index) =>
            `data: ${JSON.stringify({ event_id: `event-${index}`, run_id: 'run-1', sequence: index + 1, type, occurred_at: session.updated_at, data: { tool: 'list_files' } })}\n\n`,
        )
        .join(''),
    }),
  );
}

test('workspace brand returns to the landing page and the workspace link returns to the app', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest exchange' })).toBeVisible();
  await page.getByRole('link', { name: 'Repo Surgeon', exact: true }).click();
  await expect(page).toHaveURL('/landing');
  await page.getByRole('banner').getByRole('link', { name: 'Open workspace', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Latest exchange' })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1200, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`saved workspace fits ${viewport.width} and keeps the composer available`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await fixture(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latest exchange' })).toBeVisible();
    await expect(page.getByText(turn.answer)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send instruction' })).toBeInViewport();
    expect(
      await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      })),
    ).toEqual({ width: viewport.width, overflow: false });
    await expect(page.getByText(repository.name, { exact: true }).first()).toBeVisible();
    await capture(page, testInfo, `workspace-${viewport.width}`);
    if (viewport.width > 1100) {
      await expect(
        page.getByRole('complementary', { name: 'Repositories and sessions' }),
      ).toBeVisible();
      await expect(page.getByRole('region', { name: 'Repository tools' })).toBeVisible();
      const bounds = await page.getByRole('region', { name: 'Repository tools' }).boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(viewport.width * 0.3);
    } else {
      const trigger = page.getByRole('button', { name: 'Repositories', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Repositories and sessions' });
      await expect(dialog).toBeVisible();
      await capture(page, testInfo, 'repositories-drawer');
      await page.getByRole('button', { name: repository.name, exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Add repository' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Repositories 1' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(
        page.getByRole('button', { name: 'Close Repositories and sessions' }),
      ).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.locator('summary')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(
        page.getByRole('button', { name: 'Actions for session Read-only review' }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.getByRole('button', { name: 'Repository tools' }).click();
      await page.getByRole('tab', { name: 'Activity' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Activity' })).toContainText('Persisted');
      await capture(page, testInfo, 'events-drawer');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Repository tools' })).toBeFocused();
    }
  });
}

test('empty accounts explain public import and disable inspection', async ({ page }) => {
  await fixture(page, 'empty');
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No repositories in this workspace yet' }),
  ).toBeVisible();
  await expect(
    page.getByText(/Use Add repository to import a public GitHub source snapshot/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /connect|import/i })).toHaveCount(0);
});

test('a failed tool remains failed even though its event is persisted', async ({ page }) => {
  await fixture(page, 'failed');
  await page.goto('/');
  await page.getByRole('tab', { name: 'Activity' }).click();
  const event = page
    .getByRole('article')
    .filter({ has: page.locator('code', { hasText: 'tool.failed' }) });
  await expect(event).toContainText('Failed');
  await expect(event).toContainText('Persisted');
  await expect(page.getByText('Run outcome: failed')).toBeVisible();
  await expect(page.getByText(/no Git commit occurred/)).toBeVisible();
});

test('repository errors offer a working retry and never look like an empty success', async ({
  page,
}) => {
  await fixture(page, 'empty');
  let failed = true;
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ status: failed ? 503 : 200, json: failed ? { code: 'unavailable' } : [] }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Latest exchange' }).getByRole('alert'),
  ).toContainText('could not be loaded');
  await expect(
    page.getByRole('heading', { name: 'No repositories in this workspace yet' }),
  ).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No repositories in this workspace yet' }),
  ).toBeVisible();
});

test('an in-flight inspection disables duplicate submission and restores its saved result', async ({
  page,
}) => {
  await fixture(page, 'ready');
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/sessions/session-1/turns', async (route) => {
    await pending;
    await route.fulfill({ json: turn });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Session ready' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Agent instruction' })
    .fill('What does this repository contain?');
  await page.getByRole('button', { name: 'Send instruction' }).click();
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
  await expect(
    page.getByRole('region', { name: 'Latest exchange' }).getByRole('status'),
  ).toHaveText('Inspecting…');
  await page.route('**/api/v1/sessions/session-1', (route) =>
    route.fulfill({ json: { ...session, turns: [turn] } }),
  );
  release?.();
  await expect(page.getByText(turn.answer)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeEnabled();
});

test('light theme and 200 percent reflow geometry retain task access without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await fixture(page);
  await page.goto('/');
  await expect(page.getByText(turn.answer)).toBeVisible();
  expect(
    await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  // 1440x900 at 200% browser zoom has a 720x450 CSS-pixel layout viewport.
  // This checks the reflow geometry without claiming to drive browser chrome zoom.
  await page.setViewportSize({ width: 720, height: 450 });
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Repositories', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('all unfinished routes are informative and have real return navigation', async ({ page }) => {
  for (const path of [
    '/git-graph-staging',
    '/agent-traces-stream',
    '/worktrees-locks',
    '/audit-ledger',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Return to workspace' })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(
      page.getByText(/not available in this release|Run activity is available/),
    ).toBeVisible();
    await expect(page.getByText(/acme|SAFE SANDBOX/)).toHaveCount(0);
  }
});

test('a new session stays selected when an older session restore finishes late', async ({
  page,
}) => {
  await fixture(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/sessions/session-1', async (route) => {
    await pending;
    await route.fulfill({ json: { ...session, turns: [turn] } });
  });
  const created = { ...session, id: 'session-2', title: 'New inspection session' };
  await page.route('**/api/v1/sessions', (route) => route.fulfill({ status: 201, json: created }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: session.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start read-only session' }).click();
  await expect(page.getByRole('button', { name: created.title, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const restored = page.waitForResponse('**/api/v1/sessions/session-1');
  release?.();
  await restored;
  // Allow the released response and React paint to finish before negative assertions.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('button', { name: created.title, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Session ready' })).toBeVisible();
  await expect(page.getByText(turn.answer)).toHaveCount(0);
});

test('session creation is labelled separately from running an inspection', async ({ page }) => {
  await fixture(page, 'ready');
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/sessions', async (route) => {
    await pending;
    await route.fulfill({ status: 201, json: { ...session, id: 'session-2' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Session ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Start read-only session' }).click();
  try {
    await expect(
      page.getByRole('region', { name: 'Latest exchange' }).getByRole('status'),
    ).toHaveText('Starting session…');
    await expect(page.getByText('Running read-only inspection…')).toHaveCount(0);
  } finally {
    release?.();
  }
  await expect(page.getByRole('textbox', { name: 'Agent instruction' })).toBeEnabled();
});

test('an unavailable repository still lets the user select another assigned repository', async ({
  page,
}) => {
  await fixture(page, 'ready');
  const available = { id: 'repository-2', name: 'available-demo' };
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: [repository, available] }),
  );
  await page.route('**/api/v1/repositories/repository-1/summary', (route) =>
    route.fulfill({ status: 503, json: { code: 'repository_unavailable' } }),
  );
  await page.route('**/api/v1/sessions?*', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Latest exchange' }).getByRole('alert'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: available.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
  await page.getByRole('button', { name: available.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start a read-only session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start read-only session' })).toBeEnabled();
  await expect(
    page.getByRole('region', { name: 'Latest exchange' }).getByRole('alert'),
  ).toHaveCount(0);
});

test('a stale GitHub snapshot can be recovered and reopens its saved session', async ({ page }) => {
  await fixture(page);
  let recovered = false;
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: [{ ...repository, github_commit: 'a'.repeat(40) }] }),
  );
  await page.route('**/api/v1/repositories/repository-1/summary', (route) =>
    recovered
      ? route.fallback()
      : route.fulfill({ status: 503, json: { code: 'repository_unavailable' } }),
  );
  await page.route('**/api/v1/repositories/repository-1/recover', (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    recovered = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover snapshot' }).click();
  await expect(page.getByText(turn.answer)).toBeVisible();
  await expect(page.getByRole('button', { name: session.title, exact: true })).toBeVisible();
});

test('repository authorization failures still clear all private workspace choices', async ({
  page,
}) => {
  await fixture(page, 'ready');
  await page.route('**/api/v1/repositories/repository-1/summary', (route) =>
    route.fulfill({ status: 403, json: { code: 'repository_unavailable' } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Latest exchange' }).getByRole('alert'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: repository.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`composer focus stays on its shared boundary in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await fixture(page);
    await page.goto('/');
    const instruction = page.getByRole('textbox', { name: 'Agent instruction' });
    await expect(instruction).toBeEnabled();
    await instruction.fill('Explain the repository');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await instruction.click();
      await expect(instruction).toBeFocused();
      await capture(page, testInfo, `composer-focus-${colorScheme}-${width}`);
      await expect(instruction).toHaveCSS('outline-style', 'none');
      await expect(page.locator('.composer-input')).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
      const inspect = page.getByRole('button', { name: 'Send instruction' });
      await expect(inspect).toBeFocused();
      await expect(inspect).toHaveCSS('outline-style', 'solid');
      await expect(page.locator('.composer-input')).toHaveCSS('outline-style', 'none');
    }
  });
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`GitHub account menu works on desktop and phone in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await fixture(page);
    const avatar = 'https://avatars.githubusercontent.com/u/fixture?s=64';
    await page.route(avatar, (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#116a5b"/><text x="32" y="43" text-anchor="middle" fill="white" font-size="32">A</text></svg>',
      }),
    );
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({ json: { ...account, user: { ...account.user, github_avatar_url: avatar } } }),
    );
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Account menu for @ada' });
    await expect(trigger.locator('img')).toHaveAttribute('src', avatar);
    await expect
      .poll(() => trigger.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.locator('.repository-context').locator(trigger)).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(trigger.getByText('@ada', { exact: true })).toBeVisible();
      await trigger.hover();
      await expect(page.getByRole('tooltip')).toHaveText('@ada');
      await expect(page.getByRole('tooltip')).toBeVisible();
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const profile = page.getByRole('menuitem', { name: 'Profile', exact: true });
      const settings = page.getByRole('menuitem', { name: 'Settings', exact: true });
      await expect(profile).toHaveAttribute('href', '/profile');
      await expect(settings).toHaveAttribute('href', '/settings');
      await expect(profile.locator('svg')).toHaveCount(1);
      await expect(settings.locator('svg')).toHaveCount(1);
      await expect(profile).toBeFocused();
      await capture(page, testInfo, `account-menu-${colorScheme}-${width}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.keyboard.press('ArrowDown');
      await expect(settings).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(profile).toBeFocused();
      await page.keyboard.press('End');
      await expect(settings).toBeFocused();
      await page.keyboard.press('Home');
      await expect(profile).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(settings).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await trigger.click();
      await page.getByRole('heading', { name: 'Latest exchange' }).click();
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await capture(page, testInfo, `settings-${colorScheme}-390`);
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', {
        name: 'Personalization',
      }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Green', exact: true })).toBeChecked();
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page).toHaveURL('/profile');
    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
  });
}

test('personalization follows the system by default and persists theme and accent', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await fixture(page);
  await page.goto('/settings');
  const theme = page.getByRole('group', { name: 'Theme', exact: true });
  const accent = page.getByRole('group', { name: 'Accent color' });
  const system = theme.getByRole('radio', { name: 'System', exact: true });
  const dark = theme.getByRole('radio', { name: 'Dark', exact: true });
  const light = theme.getByRole('radio', { name: 'Light', exact: true });
  const green = accent.getByRole('radio', { name: 'Green' });
  const blue = accent.getByRole('radio', { name: 'Blue' });
  const body = page.locator('body');

  await expect(system).toBeChecked();
  await expect(green).toBeChecked();
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(body).toHaveCSS('background-color', 'rgb(16, 18, 20)');
  const darkPreview = page.locator('[data-theme-preview="dark"]');
  const lightPreview = page.locator('[data-theme-preview="light"]');
  await expect(darkPreview).toHaveCSS('background-color', 'rgb(16, 18, 20)');
  await expect(lightPreview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await capture(page, testInfo, 'settings-system-desktop');

  await light.check();
  await blue.check();
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const category = page.getByRole('link', { name: 'Personalization' });
  await expect(category).toHaveCSS('color', 'rgb(36, 88, 166)');
  await expect(page.locator('[data-theme-preview="system"]')).toHaveCSS(
    'background-color',
    'rgb(16, 18, 20)',
  );
  await expect(darkPreview).toHaveCSS('background-color', 'rgb(16, 18, 20)');
  await capture(page, testInfo, 'settings-light-desktop');

  await theme.getByRole('radio', { name: 'Light', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dark).toBeChecked();
  await expect(body).toHaveCSS('background-color', 'rgb(16, 18, 20)');
  await page.getByRole('link', { name: 'Workspace', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('textbox', { name: 'Agent instruction' }).fill('Explain the repository');
  const inspect = page.getByRole('button', { name: 'Send instruction' });
  await expect(inspect).toHaveCSS('background-color', 'rgb(147, 186, 255)');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(body).toHaveCSS('background-color', 'rgb(16, 18, 20)');
  await page.getByRole('textbox', { name: 'Agent instruction' }).fill('Explain the repository');
  await expect(inspect).toHaveCSS('background-color', 'rgb(147, 186, 255)');
  await page.goto('/settings');
  await expect(dark).toBeChecked();
  await expect(blue).toBeChecked();
  await system.check();
  await green.check();
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(category).toHaveCSS('color', 'rgb(17, 106, 91)');
});

test('appearance changes propagate between open tabs', async ({ page, context }) => {
  await fixture(page);
  const otherTab = await context.newPage();
  await fixture(otherTab);
  await Promise.all([page.goto('/settings'), otherTab.goto('/settings')]);
  await expect(otherTab.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.getByRole('radio', { name: 'Violet', exact: true }).check();
  await expect(otherTab.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(otherTab.getByRole('radio', { name: 'Violet', exact: true })).toBeChecked();
});

test('a broken GitHub picture falls back to an initial without losing account navigation', async ({
  page,
}) => {
  await fixture(page);
  await page.route('https://avatars.githubusercontent.com/broken', (route) => route.abort());
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        ...account,
        user: {
          ...account.user,
          github_avatar_url: 'https://avatars.githubusercontent.com/broken',
        },
      },
    }),
  );
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account menu for @ada' });
  await expect(trigger.locator('.account-avatar')).toHaveText('A');
  await expect(trigger.locator('img')).toHaveCount(0);
  await trigger.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeFocused();
});

for (const width of [1440, 390]) {
  test(`public GitHub discovery opens a focused modal at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, 'empty');
    const avatar = 'https://avatars.githubusercontent.com/u/16748505?s=64';
    await page.route(avatar, (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#116a5b"/></svg>',
      }),
    );
    await page.route('**/api/v1/repositories/github/search?*', (route) => {
      const query = new URL(route.request().url()).searchParams.get('q');
      expect(query).toBe('pallets/flask');
      return route.fulfill({ json: [{ full_name: 'pallets/flask', owner_avatar_url: avatar }] });
    });

    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Add repository' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add a repository' });
    const search = dialog.getByRole('searchbox', { name: 'Search GitHub' });
    await expect(search).toBeFocused();
    await expect(dialog).toBeInViewport();
    expect(
      await dialog.evaluate((node) => getComputedStyle(node, '::backdrop').backdropFilter),
    ).toBe('blur(5px)');
    await search.fill('pallets/flask');
    const suggestion = dialog.getByRole('button', { name: /pallets\/flask/ });
    await expect(suggestion).toBeEnabled();
    await expect(suggestion.locator('img')).toHaveAttribute('src', avatar);
    await capture(page, testInfo, `github-repository-picker-${width}`);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('public import selects its snapshot, recovers after failure and survives reload', async ({
  page,
}, testInfo) => {
  await fixture(page, 'empty');
  const imported = { id: 'imported-1', name: 'pallets/flask', github_commit: 'a'.repeat(40) };
  let saved = false;
  let calls = 0;
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: saved ? [imported] : [] }),
  );
  await page.route('**/api/v1/sessions?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/github/search?*', (route) =>
    route.fulfill({ json: [{ full_name: imported.name, owner_avatar_url: null }] }),
  );
  await page.route('**/api/v1/repositories/github/import', (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    expect(route.request().postDataJSON()).toEqual({ full_name: imported.name });
    calls += 1;
    saved = calls > 1;
    return route.fulfill({
      status: saved ? 200 : 422,
      json: saved ? imported : { code: 'github_import_failed' },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add repository' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a repository' });
  await dialog.getByRole('searchbox').fill('pallets/flask');
  await dialog.getByRole('button', { name: 'Import pallets/flask' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Import failed');
  await capture(page, testInfo, 'public-import-retry');
  await dialog.getByRole('button', { name: 'Import pallets/flask' }).click();
  await expect(dialog).toHaveCount(0);
  const importedRow = page.getByRole('button', { name: imported.name, exact: true });
  await expect(importedRow).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.work-toolbar').getByText('Snapshot aaaaaaa · Read-only'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start read-only session' })).toBeEnabled();
  await capture(page, testInfo, 'public-import-selected');
  await page.reload();
  await expect(importedRow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Start read-only session' })).toBeEnabled();
  expect(calls).toBe(2);
});

test('owner prefix searches before a full repository name is entered', async ({ page }) => {
  await fixture(page, 'empty');
  const queries: string[] = [];
  await page.route('**/api/v1/repositories/github/search?*', (route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    return route.fulfill({ json: [{ full_name: 'tudstk/repo-surgeon', owner_avatar_url: null }] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add repository' }).click();
  await page.getByRole('searchbox').fill('tudstk/');
  await expect(page.getByRole('button', { name: 'Import tudstk/repo-surgeon' })).toBeVisible();
  expect(queries).toContain('tudstk/');
  await page.getByRole('searchbox').fill('tudstk/repo');
  await expect.poll(() => queries.includes('tudstk/repo')).toBe(true);
});

for (const width of [1440, 390]) {
  test(`language summary shows icons and source-byte shares at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? 'light' : 'dark' });
    await fixture(page);
    await page.route('**/api/v1/repositories/*/summary', (route) =>
      route.fulfill({
        json: {
          ...repositorySummary,
          language: 'TypeScript / JavaScript',
          languages: { JavaScript: 74.2, CSS: 24.6, HTML: 1.2 },
          file_count: 32,
          approximate_lines: 1543,
          ...(width === 1440
            ? { test_framework: null, test_command: null, test_detection: 'not_found' }
            : {}),
        },
      }),
    );
    await page.goto('/');
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    const summary = page.getByRole('region', { name: 'Repository summary' });
    await expect(summary.getByText('32', { exact: true })).toBeVisible();
    await expect(summary.getByText('1.5K', { exact: true })).toBeVisible();
    await expect(
      summary.getByText(width === 1440 ? 'Not detected' : 'pytest', { exact: true }),
    ).toBeVisible();
    const languages = summary.getByRole('list', { name: 'Language shares' });
    await expect(languages.getByRole('listitem')).toHaveText([
      /JavaScript\s*74\.2%/,
      /CSS\s*24\.6%/,
      /HTML\s*1\.2%/,
    ]);
    await expect(languages.locator('img')).toHaveCount(3);
    await expect
      .poll(() =>
        languages
          .locator('img')
          .evaluateAll((icons) => icons.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    const details = summary.locator('summary');
    await expect(summary.getByText('Language confidence')).toBeHidden();
    await capture(summary, testInfo, `repository-summary-${width}`);
    await details.press('Enter');
    await expect(summary.getByText('Language confidence')).toBeVisible();
    await expect(summary.getByText('Scan limits may omit some files or lines.')).toBeVisible();
    if (width === 390) await expect(summary.getByText('uv run pytest')).toBeVisible();
    await details.press('Enter');
    await expect(summary.getByText('Language confidence')).toBeHidden();
  });
}

for (const width of [1440, 390]) {
  test(`sidebar sections collapse independently and keep counts and add actions at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await fixture(page);
    await page.goto('/');
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    const pane =
      width === 390
        ? page.getByRole('dialog', { name: 'Repositories and sessions' })
        : page.getByRole('complementary', { name: 'Repositories and sessions' });
    const repos = pane.getByRole('button', { name: 'Repositories 1' });
    const sessions = pane.getByRole('button', { name: 'Sessions 1' });
    await expect(sessions).toHaveAttribute('aria-expanded', 'true');
    await repos.click();
    await expect(repos).toHaveAttribute('aria-expanded', 'false');
    await expect(pane.getByRole('button', { name: repository.name, exact: true })).toBeHidden();
    await expect(pane.getByRole('button', { name: session.title, exact: true })).toBeVisible();
    await sessions.focus();
    await page.keyboard.press('Enter');
    await expect(sessions).toHaveAttribute('aria-expanded', 'false');
    await expect(pane.getByRole('button', { name: session.title, exact: true })).toBeHidden();
    const add = pane.getByRole('button', { name: 'Add repository' });
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Add a repository' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await capture(page, testInfo, `sidebar-collapsed-${width}`);
    await repos.click();
    await sessions.click();
    await expect(pane.getByRole('button', { name: repository.name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pane.getByRole('button', { name: session.title, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await capture(page, testInfo, `sidebar-expanded-${width}`);
  });
}

for (const width of [1440, 390]) {
  test(`repository removal and undo update the saved list at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 1440 ? 'dark' : 'light' });
    await fixture(page);
    let hidden = false;
    let failRemoval = true;
    await page.route('**/api/v1/repositories', (route) =>
      route.fulfill({ json: hidden ? [] : [repository] }),
    );
    await page.route('**/api/v1/repositories/repository-1/visibility', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      if (failRemoval && route.request().postDataJSON().hidden) {
        failRemoval = false;
        return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      }
      hidden = route.request().postDataJSON().hidden;
      return route.fulfill({ status: 204 });
    });
    await page.goto('/');
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    const actions = page.getByRole('button', { name: `Actions for ${repository.name}` });
    const row = page.locator('.repository-selection').filter({ has: actions });
    await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await actions.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Remove', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(actions).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await actions.click();
    await page.getByRole('button', { name: 'Repositories 1' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Repositories 1' }).click();
    await actions.click();
    await capture(page, testInfo, `repository-actions-menu-${width}`);
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Remove repository?' });
    await expect(confirmation).toContainText(repository.name);
    await expect(confirmation).toContainText('associated sessions');
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    expect(hidden).toBe(false);
    await capture(page, testInfo, `repository-removal-confirmation-${width}`);
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(actions).toBeFocused();
    expect(hidden).toBe(false);
    await actions.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(actions).toBeFocused();
    expect(hidden).toBe(false);
    await actions.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Remove repository', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toHaveText(
      'Could not remove this repository. Please retry.',
    );
    expect(hidden).toBe(false);
    await confirmation.getByRole('button', { name: 'Remove repository', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: repository.name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo removal' }).click();
    await expect(page.getByRole('button', { name: 'Repositories 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions 1' })).toBeVisible();
    await capture(page, testInfo, `repository-remove-action-${width}`);
    await actions.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Remove repository', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
    await capture(page, testInfo, `repository-removal-notice-${width}`);
    await page.getByRole('button', { name: 'Dismiss removal notice' }).click();
    await expect(page.getByRole('button', { name: 'Undo removal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeFocused();
    expect(hidden).toBe(true);
    await page.reload();
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
  });
}

for (const width of [1440, 390]) {
  test(`session names and actions persist at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await fixture(page);
    const createdTitle = 'inspection-fixture read-only review of the imported source and tests-1';
    let saved = [{ ...session, title: 'sample/inspection-fixture read-only review' }];
    let renameFailure = true;
    await page.route('**/api/v1/sessions?*', (route) => route.fulfill({ json: saved }));
    await page.route('**/api/v1/sessions', (route) => {
      expect(route.request().postDataJSON()).toEqual({ repository_id: repository.id });
      const created = {
        ...session,
        id: 'session-2',
        title: createdTitle,
      };
      saved = [created, ...saved];
      return route.fulfill({ status: 201, json: created });
    });
    await page.route('**/api/v1/sessions/*', (route) => {
      const item = saved.find((entry) =>
        route
          .request()
          .url()
          .endsWith('/' + entry.id),
      );
      if (!item) return route.fulfill({ status: 404, json: {} });
      if (route.request().method() === 'PATCH') {
        expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
        if (renameFailure) {
          renameFailure = false;
          return route.fulfill({ status: 409, json: { detail: 'Choose another session name.' } });
        }
        item.title = route.request().postDataJSON().title;
      }
      return route.fulfill({ json: { ...item, turns: [] } });
    });
    await page.route('**/api/v1/sessions/*/archive', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      saved = saved.filter(
        (item) =>
          !route
            .request()
            .url()
            .endsWith('/' + item.id + '/archive'),
      );
      return route.fulfill({ status: 204 });
    });
    await page.goto('/');
    const showSessions = async () => {
      if (width === 390)
        await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    };
    await showSessions();
    await expect(
      page.getByRole('button', { name: 'inspection-fixture read-only review', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'sample/inspection-fixture read-only review', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Start read-only session' }).click();
    const createdRow = page.getByRole('button', { name: createdTitle, exact: true });
    const label = createdRow.getByText(createdTitle, { exact: true });
    await expect(createdRow).toHaveAttribute('title', createdTitle);
    await expect(label).toHaveCSS('white-space', 'nowrap');
    await expect(label).toHaveCSS('text-overflow', 'ellipsis');
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await capture(page, testInfo, `session-titles-${width}`);
    const actions = page.getByRole('button', {
      name: `Actions for session ${createdTitle}`,
    });
    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
    await capture(page, testInfo, `session-menu-${width}`);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename session', exact: true });
    await expect(rename.getByLabel('Session name')).toBeFocused();
    await rename.getByLabel('Session name').fill('  ');
    await expect(rename.getByRole('button', { name: 'Save name' })).toBeDisabled();
    await rename.getByLabel('Session name').fill('Review authentication');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(rename.getByRole('alert')).toHaveText('Choose another session name.');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(rename).toHaveCount(0);
    await page.reload();
    await showSessions();
    await expect(
      page.getByRole('button', { name: 'Review authentication', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page
      .getByRole('button', {
        name: 'Actions for session inspection-fixture read-only review',
        exact: true,
      })
      .click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove session?', exact: true });
    await expect(remove.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    expect(saved).toHaveLength(2);
    await page
      .getByRole('button', {
        name: 'Actions for session inspection-fixture read-only review',
        exact: true,
      })
      .click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await capture(page, testInfo, `session-removal-${width}`);
    await remove.getByRole('button', { name: 'Remove session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sessions 1' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Review authentication', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Actions for session Review authentication' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await remove.getByRole('button', { name: 'Remove session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sessions 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repositories 1' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
    await showSessions();
    await expect(page.getByRole('button', { name: 'Sessions 0' })).toBeVisible();
  });
}

for (const width of [1440, 390]) {
  test(`Code opens files from an expandable repository tree at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await fixture(page);
    await page.route('**/api/v1/repositories/*/tree?*', (route) => {
      const directory = new URL(route.request().url()).searchParams.get('directory');
      const entries =
        directory === '.'
          ? [
              { name: 'src', path: 'src', kind: 'directory' },
              { name: 'README.md', path: 'README.md', kind: 'file' },
            ]
          : [
              { name: 'main.ts', path: 'src/main.ts', kind: 'file' },
              { name: 'logo.png', path: 'src/logo.png', kind: 'file' },
            ];
      return route.fulfill({ json: { entries, next_offset: null, scan_limit_reached: false } });
    });
    let failNext = true;
    let requestsForSecondBatch = 0;
    let finishFirstRequest!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      finishFirstRequest = resolve;
    });
    await page.route('**/api/v1/repositories/*/file?*', async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const path = query.get('path');
      if (path === 'src/logo.png') {
        return route.fulfill({ status: 415, json: { detail: 'The requested file is binary.' } });
      }
      if (query.get('start_line') === '501') {
        requestsForSecondBatch++;
        if (failNext) {
          failNext = false;
          await firstRequest;
          return route.fulfill({ status: 503, json: { detail: 'Could not load more lines.' } });
        }
        return route.fulfill({
          json: {
            path,
            start_line: 501,
            end_line: 1000,
            has_more: true,
            lines: Array.from({ length: 500 }, (_, index) => `// Example line ${index + 501}`),
          },
        });
      }
      if (query.get('start_line') === '1001') {
        return route.fulfill({
          json: {
            path,
            start_line: 1001,
            end_line: 1001,
            has_more: false,
            lines: ['export const lastLine = true;'],
          },
        });
      }
      expect(query.get('start_line')).toBe('1');
      return route.fulfill({
        json: {
          path,
          start_line: 1,
          end_line: 500,
          has_more: true,
          lines: [
            'export function describeRepository(name: string) {',
            '  const message = "Inspecting repository";',
            '  return { name, message, readOnly: true };',
            '}',
            ...Array.from({ length: 496 }, (_, index) => `// Example line ${index + 5}`),
          ],
        },
      });
    });
    await page.goto('/');
    const mobile = width < 1101;
    if (mobile) await page.getByRole('button', { name: 'Repository tools' }).click();
    const codeTab = page.getByRole('tab', { name: 'Code' });
    await expect(codeTab).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'src', exact: true }).click();
    await expect(page.getByRole('button', { name: 'src', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.getByRole('button', { name: 'main.ts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'src/main.ts' })).toBeVisible();
    if (!mobile) {
      await expect(page.getByRole('button', { name: 'main.ts', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );
    }
    await expect(
      page.getByRole('region', { name: 'File contents' }).locator('.hljs-keyword').first(),
    ).toHaveText('export');
    const contents = page.getByRole('region', { name: 'File contents' });
    const viewMore = page.getByRole('button', { name: 'View more' });
    const scrollToEnd = () =>
      contents.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await expect(viewMore).not.toBeInViewport();
    await scrollToEnd();
    await expect(viewMore).toBeInViewport();
    if (!mobile) await capture(page, testInfo, 'work-pane-view-more');
    await viewMore.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
    try {
      await expect(viewMore).toHaveCount(0);
      await expect(contents.getByRole('status')).toHaveText('Loading lines…');
      await expect.poll(() => requestsForSecondBatch).toBe(1);
    } finally {
      finishFirstRequest();
    }
    await expect(contents.getByRole('alert')).toHaveText('Could not load more lines.');
    await expect(contents).toContainText('Example line 500');
    await scrollToEnd();
    const position = await contents.evaluate((element) => element.scrollTop);
    await viewMore.click();
    await expect(contents).toContainText('Example line 1000');
    await expect(contents).toContainText('describeRepository');
    expect(await contents.evaluate((element) => element.scrollTop)).toBe(position);
    await expect(viewMore).not.toBeInViewport();
    await scrollToEnd();
    await expect(viewMore).toBeInViewport();
    await viewMore.click();
    await expect(contents).toContainText('lastLine');
    await expect(viewMore).toHaveCount(0);
    await contents.evaluate((element) => {
      element.scrollTop = 0;
    });
    await capture(page, testInfo, `repository-code-${width}`);
    await codeTab.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Activity' })).toContainText('run.completed');
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: 'src/main.ts' })).toBeVisible();
    if (mobile) {
      await page.getByRole('button', { name: 'Files', exact: true }).click();
      await expect(page.getByRole('button', { name: 'main.ts', exact: true })).toBeFocused();
    }
    if (!mobile) {
      const divider = page.getByRole('separator', { name: 'Resize repository tools' });
      await divider.press('Home');
      await expect(page.getByRole('button', { name: 'main.ts', exact: true })).toBeHidden();
      await expect(contents).toContainText('lastLine');
      await page.getByRole('button', { name: 'Files', exact: true }).click();
      await expect(page.getByRole('button', { name: 'main.ts', exact: true })).toBeFocused();
    }
    await page.getByRole('button', { name: 'logo.png', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Code' }).getByRole('alert')).toHaveText(
      'The requested file is binary.',
    );
  });
}

test('the work pane resizes with the pointer and keyboard within 20–50% of the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: [{ ...repository, github_commit: 'a'.repeat(40) }] }),
  );
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Resize repository tools' });
  const pane = page.getByRole('region', { name: 'Repository tools' });
  const paneHeaders = page.locator(
    '.repo-panel > .panel-heading, .conversation > .panel-heading, .work-panel > .work-toolbar',
  );
  await expect(paneHeaders).toHaveCount(3);
  const expectAlignedHeaders = async () => {
    await expect
      .poll(() =>
        paneHeaders.evaluateAll(
          (headers) => new Set(headers.map((header) => header.getBoundingClientRect().bottom)).size,
        ),
      )
      .toBe(1);
  };
  await expect(pane.getByText('Up to date', { exact: true })).toBeVisible();
  await expectAlignedHeaders();
  const bounds = await divider.boundingBox();
  if (!bounds) throw new Error('Resize handle is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, bounds.y + bounds.height / 2);
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect((await pane.boundingBox())?.width).toBe(720);
  await page.mouse.move(1439, bounds.y + bounds.height / 2);
  await expect(divider).toHaveAttribute('aria-valuenow', '20');
  expect((await pane.boundingBox())?.width).toBe(288);
  await page.mouse.up();
  await expect(page.getByRole('navigation', { name: 'Repository files' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Check GitHub for updates' })).toBeInViewport();
  await expectAlignedHeaders();
  await capture(page, testInfo, 'aligned-headers-narrow-work-pane');
  await pane.getByRole('tab', { name: 'Activity' }).click();
  await expectAlignedHeaders();
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '22');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '20');
});

for (const width of [1440, 390]) {
  test(`Sync updates the selected public snapshot at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await fixture(page);
    const oldSnapshot = { ...repository, github_commit: 'a'.repeat(40) };
    const newSnapshot = { ...oldSnapshot, github_commit: 'b'.repeat(40) };
    let upstream = oldSnapshot.github_commit;
    let owned = oldSnapshot;
    let failSync = true;
    let finishSync!: () => void;
    const syncResponse = new Promise<void>((resolve) => {
      finishSync = resolve;
    });
    await page.route('**/api/v1/repositories', (route) => route.fulfill({ json: [owned] }));
    await page.route('**/api/v1/repositories/*/sync-status', (route) =>
      route.fulfill({ json: { up_to_date: upstream === owned.github_commit } }),
    );
    await page.route('**/api/v1/repositories/repository-1/sync', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      if (failSync) {
        failSync = false;
        return route.fulfill({
          status: 422,
          json: { detail: 'The archive could not be downloaded.' },
        });
      }
      await syncResponse;
      owned = newSnapshot;
      return route.fulfill({ json: newSnapshot });
    });
    await page.goto('/');
    const avatar = page.getByRole('button', { name: 'Account menu for @ada' });
    await expect(avatar.getByText('@ada', { exact: true })).toBeVisible();
    await expect(page.locator('.repository-context')).not.toContainText('Snapshot');
    const openCode = async () => {
      if (width === 390)
        await page.getByRole('button', { name: 'Repository tools', exact: true }).click();
    };
    const closeCode = async () => {
      if (width === 390) await page.getByRole('button', { name: 'Close Repository tools' }).click();
    };
    await openCode();
    const toolbar = page.locator('.work-toolbar');
    const sync = toolbar.getByRole('button', { name: 'Sync', exact: true });
    const code = toolbar.getByRole('tab', { name: 'Code' });
    const activity = toolbar.getByRole('tab', { name: 'Activity' });
    await expect(toolbar.getByText('Up to date', { exact: true })).toBeVisible();
    await activity.click();
    await expect(toolbar.getByText('Up to date', { exact: true })).toBeHidden();
    await code.click();
    await expect(sync).toHaveCount(0);
    upstream = newSnapshot.github_commit;
    await toolbar.getByRole('button', { name: 'Check GitHub for updates' }).click();
    await expect(toolbar.getByText('Behind GitHub', { exact: true })).toBeVisible();
    await expect(sync).toBeVisible();
    await capture(page, testInfo, `snapshot-behind-${width}`);
    await sync.click();
    await expect(toolbar.getByText('The archive could not be downloaded.')).toBeVisible();
    await expect(toolbar.getByText('Snapshot aaaaaaa · Read-only')).toBeVisible();
    await sync.click();
    const syncing = toolbar.getByRole('button', { name: 'Syncing…', exact: true });
    await expect(syncing).toBeDisabled();
    if (width === 390) {
      await closeCode();
      await openCode();
    } else {
      await activity.click();
      await code.click();
    }
    await expect(syncing).toBeDisabled();
    finishSync();
    await expect(toolbar.getByText('Snapshot bbbbbbb · Read-only')).toBeVisible();
    await expect(toolbar.getByText('Up to date', { exact: true })).toBeVisible();
    await expect(sync).toHaveCount(0);
    await capture(page, testInfo, `snapshot-up-to-date-${width}`);
    await closeCode();
    await expect(page.getByText(turn.answer)).toBeVisible();
    if (width === 390) {
      await page.mouse.move(0, 0);
      await capture(page, testInfo, 'workspace-toolbar-390');
    }
    await page.reload();
    await openCode();
    await expect(toolbar.getByText('Snapshot bbbbbbb · Read-only')).toBeVisible();
    await closeCode();
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Repositories 1' })).toBeVisible();
    const repositoryRows = page.getByRole('group', { name: 'Repositories', exact: true });
    await expect(
      repositoryRows.getByRole('button', { name: repository.name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(repositoryRows).not.toContainText('Snapshot');
    await expect(page.getByRole('button', { name: session.title, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
}

for (const width of [1440, 390]) {
  test(`branches and commits preview read-only code at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await fixture(page);
    const url = '/api/v1/repositories/repository-1';
    const saved = 'a'.repeat(40);
    const latest = {
      sha: 'b'.repeat(40),
      message:
        'Merge pull request #7 from sample/release/checkout\n\nValidate the cart before submitting the order.',
    };
    const previous = {
      sha: 'c'.repeat(40),
      message: 'Create the checkout view',
    };
    const branch = 'release/checkout';
    const opened: string[] = [];
    await page.route('**/api/v1/repositories', (route) =>
      route.fulfill({ json: [{ ...repository, github_commit: saved }] }),
    );
    await page.route(`**${url}/branches?*`, (route) => {
      const page = new URL(route.request().url()).searchParams.get('page');
      return route.fulfill({
        json:
          page === '1'
            ? { default_branch: 'main', branches: ['main'], next_page: 2 }
            : { default_branch: 'main', branches: [branch], next_page: null },
      });
    });
    await page.route(`**${url}/commits?*`, (route) => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('branch')).toBe(branch);
      return route.fulfill({
        json:
          query.get('page') === '1'
            ? { commits: [latest], next_page: 2 }
            : { commits: [previous], next_page: null },
      });
    });
    await page.route(`**${url}/history-preview`, (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      const body = route.request().postDataJSON();
      expect(body.branch).toBe(branch);
      expect(body.page).toBe(body.sha === latest.sha ? 1 : 2);
      opened.push(body.sha);
      return route.fulfill({ status: 204 });
    });
    await page.route(`**${url}/tree?*`, (route) =>
      route.fulfill({
        json: {
          entries: [{ path: 'checkout.ts', name: 'checkout.ts', kind: 'file' }],
          next_offset: null,
          scan_limit_reached: false,
        },
      }),
    );
    await page.route(`**${url}/file?*`, (route) => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('path')).toBe('checkout.ts');
      return route.fulfill({
        json: {
          path: 'checkout.ts',
          start_line: 1,
          end_line: 1,
          lines: [`const checkout = "${query.get('revision')?.slice(0, 7) ?? 'saved'}";`],
          has_more: false,
        },
      });
    });
    await page.goto('/');
    if (width === 390) await page.getByRole('button', { name: 'Repository tools' }).click();
    const branchTrigger = page.getByRole('button', { name: /^Choose branch/ });
    const commitTrigger = page.getByRole('button', { name: /^Choose commit/ });
    await expect(branchTrigger).toHaveText('main');
    const files = page.getByRole('navigation', { name: 'Repository files' });
    await expect(files).toBeVisible();
    const [branchBounds, filesBounds] = await Promise.all([
      branchTrigger.boundingBox(),
      files.boundingBox(),
    ]);
    expect(branchBounds!.x).toBeCloseTo(filesBounds!.x);
    expect(branchBounds!.width).toBeCloseTo(filesBounds!.width);
    await branchTrigger.click();
    const branches = page.getByRole('group', { name: 'Branches', exact: true });
    await expect(branches.getByRole('button', { name: 'main' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await branches.getByRole('button', { name: 'More branches' }).click();
    const nextBranch = branches.getByRole('button', { name: branch });
    await expect(nextBranch).toBeEnabled();
    await capture(page, testInfo, `revision-branches-${width}`);
    await nextBranch.click();
    await expect(branchTrigger).toHaveText(branch);
    await expect(commitTrigger).toContainText('bbbbbbb');
    const description = page.locator('.revision-message');
    await expect(commitTrigger).toContainText('Merge pull request #7 from sample/release/checkout');
    await expect(description).toHaveText('Validate the cart before submitting the order.');
    const [commitBounds, descriptionBounds] = await Promise.all([
      commitTrigger.boundingBox(),
      description.boundingBox(),
    ]);
    expect(descriptionBounds!.x).toBeCloseTo(commitBounds!.x);
    expect(descriptionBounds!.width).toBeCloseTo(commitBounds!.width);
    await expect(page.getByText('Saved snapshot aaaaaaa · Read-only')).toBeVisible();
    await page.getByRole('button', { name: 'checkout.ts', exact: true }).click();
    const source = page.getByRole('region', { name: 'File contents' });
    await expect(source).toContainText('bbbbbbb');
    await capture(page, testInfo, `revision-preview-${width}`);

    await commitTrigger.click();
    const commits = page.getByRole('group', { name: 'Commits', exact: true });
    await expect(commits.getByRole('button', { name: /bbbbbbb/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const menuBounds = await commits.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(commitBounds!.x);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(
      commitBounds!.x + commitBounds!.width,
    );
    await commits.getByRole('button', { name: 'Older commits' }).click();
    await expect(commits.getByRole('button', { name: /ccccccc/ })).toBeVisible();
    await capture(page, testInfo, `revision-commits-${width}`);
    await page.keyboard.press('Escape');
    await expect(commitTrigger).toBeFocused();
    await commitTrigger.click();
    await commits.getByRole('button', { name: /ccccccc/ }).click();
    await expect(commitTrigger).toContainText(previous.message);
    await expect(description).toHaveCount(0);
    await page.getByRole('button', { name: 'checkout.ts', exact: true }).click();
    await expect(source).toContainText('ccccccc');

    if (width === 390) {
      await page.getByRole('button', { name: 'Close Repository tools' }).click();
      await expect(page.getByText(turn.answer)).toBeVisible();
      await page.getByRole('button', { name: 'Repository tools' }).click();
      await expect(commitTrigger).toContainText('ccccccc');
    }
    await commitTrigger.click();
    await commits.getByRole('button', { name: 'Saved snapshot' }).click();
    await expect(page.locator('.revision-message')).toHaveCount(0);
    await page.getByRole('button', { name: 'checkout.ts', exact: true }).click();
    await expect(source).toContainText('"saved"');
    expect(opened).toEqual([latest.sha, previous.sha]);
  });
}

async function pullRequestFixture(page: Page) {
  await fixture(page, 'ready');
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: [{ ...repository, github_commit: 'a'.repeat(40) }] }),
  );
  await page.route('**/api/v1/repositories/*/branches?*', (route) =>
    route.fulfill({ json: { default_branch: 'main', branches: ['main'], next_page: null } }),
  );
  await page.route('**/api/v1/repositories/*/commits?*', (route) =>
    route.fulfill({ json: { commits: [], next_page: null } }),
  );
  const pull = {
    number: 24,
    status: 'open',
    title: 'Validate the catalog price filter',
    author: 'ada',
    updated_at: '2026-11-17T12:00:00Z',
    base_ref: 'main',
    head_ref: 'validate-price-filter',
    url: 'https://github.com/sample/inspection-fixture/pull/24',
  };
  const second = { ...pull, number: 23, title: 'Keep search results stable' };
  const merged = {
    ...pull,
    number: 21,
    status: 'merged',
    title: 'Add the catalog search endpoint',
  };
  const file = {
    path: 'src/catalog/price.ts',
    status: 'modified',
    previous_path: null,
    additions: 3,
    deletions: 1,
    patch_status: 'available',
    patch: [
      '@@ -12,5 +12,7 @@ export function parsePrice(raw: string) {',
      '   const input = raw.trim();',
      '   if (!input) return null;',
      '-  const price = Number(input);',
      '+  const price = parseFloat(input);',
      '+  if (!Number.isFinite(price)) return null;',
      '+  if (price < 0) return null;',
      '   return price;',
      ' }',
    ].join('\n'),
  };
  let listRequests = 0;
  await page.route('**/api/v1/repositories/*/pull-requests?*', (route) => {
    listRequests += 1;
    const state = new URL(route.request().url()).searchParams.get('state');
    return route.fulfill({
      json: { pulls: state === 'closed' ? [merged] : [pull, second], next_page: null },
    });
  });
  await page.route('**/api/v1/repositories/*/pull-requests/*/files?*', (route) => {
    const url = new URL(route.request().url());
    const pageNumber = url.searchParams.get('page');
    const isMerged = url.pathname.endsWith('/21/files');
    return route.fulfill({
      json: {
        changed_files: isMerged ? 8 : 2,
        additions: 15,
        deletions: 3,
        restricted_files: 0,
        file_limit_reached: false,
        next_page: isMerged && pageNumber === '1' ? 2 : null,
        files:
          pageNumber === '2'
            ? [{ ...file, path: 'src/catalog/sort.ts' }]
            : [
                file,
                {
                  ...file,
                  path: 'public/catalog-thumbnail.png',
                  status: 'added',
                  patch: null,
                  patch_status: 'unavailable',
                },
              ],
      },
    });
  });
  return () => listRequests;
}

test('browses open and merged GitHub pull requests and both diff layouts', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const countRequests = await pullRequestFixture(page);
  await page.goto('/');
  const code = page.getByRole('tab', { name: 'Code', exact: true });
  await expect(code).toHaveAttribute('aria-selected', 'true');
  expect(countRequests()).toBe(0);
  const tabs = page.getByRole('tablist', { name: 'Repository work panel' });
  await expect(tabs.getByRole('tab')).toHaveText(['Code', 'Pull Request', 'Activity']);
  await code.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Pull Request', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Activity' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: 'Pull Request', exact: true })).toBeFocused();
  const panel = page.getByRole('tabpanel', { name: 'Pull Request' });
  const row = panel.getByRole('button', { name: /Validate the catalog price filter/ });
  await expect(row).toBeVisible();
  await capture(
    page.getByRole('region', { name: 'Repository tools' }),
    testInfo,
    'open-pull-requests',
  );
  const second = panel.getByRole('button', { name: /Keep search results stable/ });
  await expect(second).toBeVisible();
  await row.click();
  await expect(
    panel.getByRole('heading', { name: /Validate the catalog price filter/ }),
  ).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Code Review this PR' })).toBeEnabled();
  const totals = panel.getByRole('group', { name: 'Pull request totals' });
  await expect(totals).toContainText('2 files changed');
  const title = panel.getByRole('heading', { name: /Validate the catalog price filter/ });
  const [titleBounds, totalsBounds] = await Promise.all([
    title.boundingBox(),
    totals.boundingBox(),
  ]);
  expect(totalsBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width);
  const file = panel.getByRole('region', { name: 'File diff' });
  const layouts = file.getByRole('group', { name: 'Diff layout' });
  await expect(file.getByLabel('1 deletions')).toBeVisible();
  const [countBounds, layoutsBounds] = await Promise.all([
    file.getByLabel('1 deletions').boundingBox(),
    layouts.boundingBox(),
  ]);
  expect(layoutsBounds!.x).toBeGreaterThanOrEqual(countBounds!.x + countBounds!.width);
  const unified = file.getByRole('region', { name: 'Unified diff' });
  await expect(unified).toContainText('const price = Number(input);');
  await expect(unified).toContainText('const price = parseFloat(input);');
  await capture(page.getByRole('region', { name: 'Repository tools' }), testInfo, 'unified-diff');
  await layouts.getByRole('button', { name: 'Side by side' }).click();
  const split = panel.getByRole('region', { name: 'Side-by-side diff' });
  await expect(split.getByRole('columnheader', { name: 'Before' })).toBeVisible();
  await expect(split.getByRole('columnheader', { name: 'After' })).toBeVisible();
  const replacement = split.getByRole('row', { name: /Number\(input\);.*parseFloat\(input\);/ });
  await expect(replacement).toBeVisible();
  await capture(
    page.getByRole('region', { name: 'Repository tools' }),
    testInfo,
    'side-by-side-diff',
  );
  await panel.getByLabel('Changed files on this page').selectOption('1');
  await expect(panel.getByText('GitHub did not include a text patch for this file.')).toBeVisible();
  await expect(layouts).toHaveCount(0);
  await panel.getByRole('button', { name: 'All pull requests' }).click();
  await expect(row).toBeFocused();
  await panel.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(row).not.toBeVisible();
  await panel.getByRole('button', { name: /Add the catalog search endpoint/ }).click();
  await expect(panel.getByText('Merged', { exact: true }).filter({ visible: true })).toBeVisible();
  await panel
    .getByRole('navigation', { name: 'Changed file pages' })
    .getByRole('button', { name: 'Next' })
    .click();
  await expect(panel.getByRole('heading', { name: 'src/catalog/sort.ts' })).toBeVisible();
  await expect(totals).toContainText('8 files changed');
  await expect(split).toBeVisible();
});

test('shows readable pull request diffs in the mobile repository tools drawer', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pullRequestFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Repository tools', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Repository tools' });
  await drawer.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  await drawer.getByRole('button', { name: /Validate the catalog price filter/ }).click();
  await expect(drawer.getByRole('region', { name: 'Unified diff' })).toBeVisible();
  await capture(drawer, testInfo, 'mobile-pull-request');
  await drawer.getByRole('button', { name: 'Side by side' }).click();
  await expect(drawer.getByRole('region', { name: 'Side-by-side diff' })).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const width of [1920, 1440, 390]) {
  test(`streams a clearly labelled PR review into chat at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await pullRequestFixture(page);
    await page.route('**/api/v1/review-provider', (route) =>
      route.fulfill({
        json: {
          available: true,
          simulation: true,
          repository_chat: true,
          model: 'Simulation',
          default_model: 'deepseek/deepseek-v3.2',
          models: [
            { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', description: 'Default' },
            { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Budget' },
          ],
        },
      }),
    );
    const review = {
      number: 24,
      title: 'Validate the catalog price filter',
      repository: repository.name,
      head_sha: 'b'.repeat(40),
      simulation: true,
      model: 'Simulation',
    };
    const answer =
      '## Simulation\n\nNo model has evaluated this pull request.\n\n### Example suggestion format\n\n```javascript\nconst price = Number(input);\n```\n\nTests were not executed.';
    let requested = false;
    await page.route('**/api/v1/sessions/session-1/pull-request-reviews', async (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      expect(route.request().postDataJSON()).toEqual({
        number: 24,
        request_id: expect.any(String),
        model: 'deepseek/deepseek-v3.2',
      });
      expect(requested).toBe(false);
      requested = true;
      await route.continue();
    });
    await page.route('**/api/v1/sessions/session-1', (route) =>
      route.fulfill({
        json: {
          ...session,
          turns: requested ? [{ ...turn, question: 'Code Review this PR', answer, review }] : [],
        },
      }),
    );
    await page.route('**/api/v1/agent-runs/run-1/events', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ event_id: 'map', run_id: 'run-1', sequence: 1, type: 'tool.completed', occurred_at: session.updated_at, data: { tool: 'repository_map' } })}\n\n`,
      }),
    );
    await page.goto('/');
    if (width < 1101)
      await page.getByRole('button', { name: 'Repository tools', exact: true }).click();
    await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
    await page.getByRole('button', { name: /Validate the catalog price filter/ }).click();
    await page.getByRole('button', { name: 'Code Review this PR' }).click();
    const chat = page.getByRole('region', { name: 'Latest exchange' });
    await expect(chat.getByText('Code Review this PR', { exact: true })).toBeVisible();
    await expect(chat.locator('.review-processing')).toContainText(/review/);
    await expect(chat.getByRole('button', { name: 'Stop review' })).toBeVisible();
    await expect(chat.getByRole('heading', { name: 'Simulation', exact: true })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Stop review' })).toBeVisible();
    await expect(chat.getByText('Run outcome: completed')).toBeVisible();
    const [bodyBounds, replyBounds] = await Promise.all([
      chat.locator('.conversation-body').boundingBox(),
      chat.locator('.review-context-note').boundingBox(),
    ]);
    expect(replyBounds).not.toBeNull();
    expect(replyBounds!.x - bodyBounds!.x).toBeLessThanOrEqual(72);
    await expect(chat.locator('.agent-avatar .icon')).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Stop review' })).toHaveCount(0);
    await expect(chat.getByText('No model has evaluated this pull request.')).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Copy code' })).toBeVisible();
    await capture(page, testInfo, `pr-review-simulation-${width}`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.reload();
    await expect(chat.getByRole('heading', { name: 'Simulation', exact: true })).toBeVisible();
    await expect(chat.getByText(/PR revision/)).toContainText('bbbbbbb');
  });
}

test('chat model selector submits the selected budget model for PR review', async ({
  page,
}, testInfo) => {
  await pullRequestFixture(page);
  await page.route('**/api/v1/review-provider', (route) =>
    route.fulfill({
      json: {
        available: true,
        simulation: false,
        model: 'deepseek/deepseek-v3.2',
        default_model: 'deepseek/deepseek-v3.2',
        models: [
          { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', description: 'Default' },
          { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Budget' },
        ],
      },
    }),
  );
  let requestModel = '';
  await page.route('**/api/v1/sessions/session-1/pull-request-reviews', (route) => {
    requestModel = route.request().postDataJSON().model;
    return route.fulfill({ status: 429, json: { detail: 'Test rate limit. No model call made.' } });
  });
  await page.goto('/');
  const select = page.getByLabel('Chat model');
  await expect(select).toHaveValue('deepseek/deepseek-v3.2');
  await select.selectOption('deepseek/deepseek-v4-flash');
  await capture(page, testInfo, 'model-selector-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(select).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, testInfo, 'model-selector-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  await page.getByRole('button', { name: /Validate the catalog price filter/ }).click();
  await page.getByRole('button', { name: 'Code Review this PR' }).click();
  await expect(page.getByText('Test rate limit. No model call made.')).toBeVisible();
  expect(requestModel).toBe('deepseek/deepseek-v4-flash');
});

for (const width of [1440, 390]) {
  test(`repository chat grows from one line and saves a model answer at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await fixture(page, 'ready');
    await page.route('**/api/v1/review-provider', (route) =>
      route.fulfill({
        json: {
          available: true,
          simulation: false,
          repository_chat: true,
          model: 'deepseek/deepseek-v3.2',
          default_model: 'deepseek/deepseek-v3.2',
          models: [{ id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', description: 'Default' }],
        },
      }),
    );
    const question = 'How does the entry point work?';
    const answer =
      '## Architecture\n\nThere are **2 components** connected through `src/main.py`.\n\n---\n\n1. The entry point starts the application.\n2. The handler processes requests.';
    const response = {
      ...turn,
      question,
      answer,
      review: {
        kind: 'repository_chat',
        model: 'deepseek/deepseek-v3.2',
        simulation: false,
        repository: repository.name,
        head_sha: 'a'.repeat(40),
      },
    };
    let sent = false;
    await page.route('**/api/v1/sessions/session-1/repository-messages', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        message: question,
        model: 'deepseek/deepseek-v3.2',
      });
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      sent = true;
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          `event: started\ndata: ${JSON.stringify({ ...response, status: 'running', answer: '' })}\n\n` +
          `event: delta\ndata: ${JSON.stringify({ text: answer })}\n\n` +
          `event: completed\ndata: ${JSON.stringify(response)}\n\n`,
      });
    });
    await page.route('**/api/v1/sessions/session-1', (route) =>
      route.fulfill({ json: { ...session, turns: sent ? [response] : [] } }),
    );
    await page.goto('/');
    const input = page.getByPlaceholder('Write your message...');
    await expect(input).toBeVisible();
    const single = (await input.boundingBox())!.height;
    expect(single).toBeLessThanOrEqual(48);
    await input.fill('First line\nSecond line\nThird line');
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(single);
    await input.fill(question);
    await expect.poll(async () => (await input.boundingBox())!.height).toBe(single);
    const send = page.getByRole('button', { name: 'Send instruction' });
    await expect(send).toHaveText('');
    await expect(send).toHaveCSS('border-radius', '6px');
    await send.click();
    await expect(page.getByRole('heading', { name: 'Architecture' })).toBeVisible();
    await expect(page.getByText('Repository conversation', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    const rule = page.locator('.assistant-content hr');
    await expect(rule).toHaveCSS('border-top-style', 'solid');
    expect(
      await rule.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)),
    ).toBeLessThanOrEqual(1);
    await capture(page, testInfo, `repository-chat-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Architecture' })).toBeVisible();
  });
}

test('Code wraps long source lines and keeps the next line number aligned', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await fixture(page);
  const lines = [
    '<meta name="description" content="' + 'Repository source preview '.repeat(20) + '">',
    '<title>Repository</title>',
  ];
  await page.route('**/api/v1/repositories/*/tree?*', (route) =>
    route.fulfill({
      json: {
        entries: [{ name: 'index.html', path: 'index.html', kind: 'file' }],
        next_offset: null,
        scan_limit_reached: false,
      },
    }),
  );
  await page.route('**/api/v1/repositories/*/file?*', (route) =>
    route.fulfill({
      json: {
        path: 'index.html',
        start_line: 1,
        end_line: 2,
        has_more: false,
        lines,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  const content = page.getByRole('region', { name: 'File contents' });
  await expect(content.locator('.source-code-row')).toHaveCount(2);
  const first = await content.locator('.source-code-row').nth(0).boundingBox();
  const second = await content.locator('.source-code-row').nth(1).boundingBox();
  expect(first!.height).toBeGreaterThan(22);
  expect(second!.y).toBeCloseTo(first!.y + first!.height, 0);
  expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await content.locator('code').allTextContents()).toEqual(lines);
  await capture(page, testInfo, 'wrapped-source');
});
