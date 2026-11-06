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
      await page.getByRole('button', { name: repository.name }).focus();
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

test('empty accounts explain missing import and disable inspection', async ({ page }) => {
  await fixture(page, 'empty');
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No repositories in this workspace yet' }),
  ).toBeVisible();
  await expect(
    page.getByText(/Connecting or importing a GitHub repository is not available yet/),
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
