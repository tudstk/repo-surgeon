import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
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

async function fixture(page: Page, state: 'saved' | 'empty' | 'failed' | 'ready' = 'saved') {
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: account }));
  await page.route('**/api/v1/repositories', (route) =>
    route.fulfill({ json: state === 'empty' ? [] : [repository] }),
  );
  await page.route('**/api/v1/repositories/*/summary', (route) =>
    route.fulfill({
      json: {
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
      },
    }),
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
      await expect(page.getByRole('region', { name: 'Run events' })).toBeVisible();
      const bounds = await page.getByRole('region', { name: 'Run events' }).boundingBox();
      expect(bounds?.width).toBe(420);
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
      await expect(page.getByRole('button', { name: 'Read-only review' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.getByRole('button', { name: /Run events/ }).click();
      await expect(page.getByRole('dialog', { name: 'Run events' })).toContainText('Persisted');
      await capture(page, testInfo, 'events-drawer');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: /Run events/ })).toBeFocused();
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
  await page.getByRole('button', { name: 'Send instruction' }).click();
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
  await expect(page.getByText('Running read-only inspection…')).toBeVisible();
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
  await expect(page.getByRole('button', { name: created.title })).toHaveAttribute(
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
  await expect(page.getByRole('button', { name: created.title })).toHaveAttribute(
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
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeEnabled();
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
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Profile' }),
    ).toHaveCount(0);
    await expect(page.locator('.app-header')).not.toContainText('Read-only');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
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
      page.getByText('There are no configurable settings in this release.', { exact: false }),
    ).toBeVisible();
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
  await expect(trigger).toHaveText('A');
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
  await expect(
    page.getByRole('button', { name: /pallets\/flask Snapshot aaaaaaa/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Start read-only session' })).toBeEnabled();
  await capture(page, testInfo, 'public-import-selected');
  await page.reload();
  await expect(
    page.getByRole('button', { name: /pallets\/flask Snapshot aaaaaaa/ }),
  ).toHaveAttribute('aria-pressed', 'true');
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
    await fixture(page);
    await page.goto('/');
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    const summary = page.getByRole('region', { name: 'Repository summary' });
    await expect(summary.getByText('75.0%')).toBeVisible();
    await expect(summary.getByText('25.0%')).toBeVisible();
    await expect(summary.getByText('Partial scan', { exact: true })).toHaveCount(0);
    await expect(summary.locator('img')).toHaveCount(2);
    await expect
      .poll(() =>
        summary
          .locator('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await capture(page, testInfo, `language-summary-${width}`);
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
    await fixture(page);
    let hidden = false;
    await page.route('**/api/v1/repositories', (route) =>
      route.fulfill({ json: hidden ? [] : [repository] }),
    );
    await page.route('**/api/v1/repositories/repository-1/visibility', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      hidden = route.request().postDataJSON().hidden;
      return route.fulfill({ status: 204 });
    });
    await page.goto('/');
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    const actions = page.getByRole('button', { name: `Actions for ${repository.name}` });
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
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: repository.name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo removal' }).click();
    await expect(page.getByRole('button', { name: 'Repositories 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions 1' })).toBeVisible();
    await capture(page, testInfo, `repository-remove-action-${width}`);
    await actions.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
    await page.reload();
    if (width === 390)
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Repositories 0' })).toBeVisible();
  });
}
