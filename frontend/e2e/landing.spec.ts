import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1910, height: 989 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`landing preserves its headline and real actions at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    const privateRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) privateRequests.push(request.url());
    });
    await page.goto('/landing');
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole('heading', { name: 'Inspect the repo. Keep control.', exact: true }),
    ).toBeVisible();
    const hero = page.locator('section').first();
    await expect(hero.getByRole('link', { name: 'Open workspace', exact: true })).toBeInViewport();
    await expect(hero.getByRole('link', { name: 'Open workspace', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    expect(privateRequests).toEqual([]);
    const screenshot = testInfo.outputPath(`landing-${viewport.width}.png`);
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      animations: 'disabled',
      style: 'nextjs-portal { visibility: hidden !important; }',
    });
    await testInfo.attach(`landing-${viewport.width}`, {
      path: screenshot,
      contentType: 'image/png',
    });
    await page
      .getByRole('link', { name: 'This release', exact: true })
      .isVisible()
      .then(async (visible) => {
        if (visible) await page.getByRole('link', { name: 'This release', exact: true }).click();
      });
    const question = page.getByText('Does it answer questions with AI?', { exact: true });
    await question.click();
    await expect(
      page.getByText('Yes, when OpenRouter is configured.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('No. Sign-in identifies your account.', { exact: false }),
    ).not.toBeVisible();
    await page.getByText('Does GitHub sign-in import repositories?', { exact: true }).click();
    await expect(
      page.getByText('No. Sign-in identifies your account.', { exact: false }),
    ).toBeVisible();
  });
}

test('landing artwork respects reduced motion and keyboard navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/landing');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const field = page.locator('[data-visual="circuit-field"]');
  await expect(field).toHaveAttribute('data-motion', 'static');
  expect(
    await field
      .locator('svg')
      .first()
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(field.getByRole('button')).toHaveCount(0);
});

test('background lines stay static during pointer movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/landing');
  const field = page.locator('[data-visual="circuit-field"]');
  await expect(field).toHaveAttribute('data-motion', 'static');
  await page.mouse.move(260, 210, { steps: 5 });
  expect(await field.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(field.locator('[data-cursor-pulse]')).toHaveCount(0);
});

for (const scenario of [
  { width: 1910, height: 989, colorScheme: 'dark' as const },
  { width: 1440, height: 900, colorScheme: 'dark' as const },
  { width: 390, height: 844, colorScheme: 'dark' as const },
  { width: 320, height: 740, colorScheme: 'dark' as const },
  { width: 1440, height: 900, colorScheme: 'light' as const },
  { width: 390, height: 844, colorScheme: 'light' as const },
]) {
  test(`textured login keeps sign-in readable at ${scenario.width}px in ${scenario.colorScheme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(scenario);
    await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: 'reduce' });
    await page.route('**/api/v1/auth/session', (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to Repo Surgeon' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeInViewport();
    await expect(page.locator('[data-visual="circuit-field"]')).toHaveAttribute(
      'data-motion',
      'static',
    );
    await expect(page.locator('.identity-panel')).toHaveCSS('border-top-width', '1px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(scenario.width);
    const screenshot = testInfo.outputPath(
      `login-textured-${scenario.colorScheme}-${scenario.width}.png`,
    );
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden !important; }',
    });
    await testInfo.attach('textured-login', { path: screenshot, contentType: 'image/png' });
  });
}

test('code globe counter-scrolls and magnifies an illustrative review', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/landing');
  const globe = page.locator('[data-visual="inspection-mark"]');
  await expect(globe).toHaveAttribute('data-running', 'true');
  const canvas = globe.locator('[data-globe-canvas]');
  const before = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const offsets = await canvas.evaluate((node) => [
    Number(node.getAttribute('data-offset-right')),
    Number(node.getAttribute('data-offset-left')),
  ]);
  await expect
    .poll(() =>
      canvas.evaluate(
        (node, baseline) =>
          Number(node.getAttribute('data-offset-right')) > baseline[0] &&
          Number(node.getAttribute('data-offset-left')) < baseline[1],
        offsets,
      ),
    )
    .toBe(true);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(before);
  const magnifier = globe.getByRole('button', { name: 'Magnify an illustrative code review' });
  const bounds = (await globe.locator('[data-globe-canvas]').boundingBox())!;
  const viewport = globe.locator('[data-lens-viewport]');
  await page.mouse.move(
    bounds.x + (bounds.width * 155) / 440,
    bounds.y + (bounds.height * 130) / 440,
  );
  await expect(globe).toHaveAttribute('data-inspecting', 'true');
  await expect
    .poll(async () => Number(await viewport.getAttribute('data-source-x')))
    .toBeCloseTo(155, 0);
  await page.mouse.move(
    bounds.x + (bounds.width * 260) / 440,
    bounds.y + (bounds.height * 230) / 440,
  );
  await expect
    .poll(async () => Number(await viewport.getAttribute('data-source-x')))
    .toBeCloseTo(260, 0);
  await expect
    .poll(async () => Number(await viewport.getAttribute('data-source-y')))
    .toBeCloseTo(230, 0);
  const ring = (await globe.locator('[data-lens-ring]').boundingBox())!;
  expect(ring.x + ring.width / 2).toBeCloseTo(bounds.x + (bounds.width * 260) / 440, 0);
  expect(ring.y + ring.height / 2).toBeCloseTo(bounds.y + (bounds.height * 230) / 440, 0);
  await expect(globe).toHaveAttribute('data-review-phase', 'edited');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  const image = testInfo.outputPath('code-globe-review.png');
  await globe.screenshot({ path: image });
  await testInfo.attach('code-globe-review', { path: image, contentType: 'image/png' });
  await magnifier.click();
  await expect(magnifier).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(globe).toHaveAttribute('data-inspecting', 'false');
  await expect(magnifier).toHaveAttribute('aria-pressed', 'false');
  await magnifier.focus();
  await expect(globe).toHaveAttribute('data-inspecting', 'true');
  await page.getByRole('heading', { name: 'The current boundary.' }).scrollIntoViewIfNeeded();
  await expect(globe).toHaveAttribute('data-running', 'false');
});

test('reduced-motion code globe has a static magnified diff', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/landing');
  const globe = page.locator('[data-visual="inspection-mark"]');
  await expect(globe).toHaveAttribute('data-running', 'false');
  await globe.getByRole('button', { name: 'Magnify an illustrative code review' }).focus();
  await expect(globe).toHaveAttribute('data-review-phase', 'edited');
  const viewport = globe.locator('[data-lens-viewport]');
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Number(await viewport.getAttribute('data-source-x')))
    .toBeCloseTo(266, 0);
  const canvas = globe.locator('[data-globe-canvas]');
  const image = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(image);
});

for (const width of [1910, 1024]) {
  test(`globe lens explores the rim without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 989 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/landing');
    const globe = page.locator('[data-visual="inspection-mark"]');
    const bounds = (await globe.locator('[data-globe-canvas]').boundingBox())!;
    const viewport = globe.locator('[data-lens-viewport]');
    for (const [x, y] of [
      [365, 205],
      [45, 205],
      [205, 45],
      [205, 365],
    ]) {
      await page.mouse.move(
        bounds.x + (bounds.width * x) / 440,
        bounds.y + (bounds.height * y) / 440,
      );
      await expect
        .poll(async () => Number(await viewport.getAttribute('data-source-x')))
        .toBeCloseTo(x, 0);
      await expect
        .poll(async () => Number(await viewport.getAttribute('data-source-y')))
        .toBeCloseTo(y, 0);
      await expect(globe).toHaveAttribute('data-inspecting', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });
}
