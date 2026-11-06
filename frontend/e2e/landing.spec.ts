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
      page.getByText('The current provider lists files and returns a fixed completion message.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('GitHub sign-in identifies your account.', { exact: false }),
    ).not.toBeVisible();
    await page.getByText('Does GitHub sign-in import repositories?', { exact: true }).click();
    await expect(
      page.getByText('GitHub sign-in identifies your account.', { exact: false }),
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
  const artwork = page.locator('[data-visual="inspection-mark"]');
  await artwork.hover();
  const scanLine = artwork.locator('g').last();
  await expect(scanLine).toHaveCSS('transform', 'none');
  await expect(scanLine).toHaveCSS('transition-duration', '0s');
});

test('background pulses move, can be paused, and stop offscreen or for reduced motion', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/landing');
  const field = page.locator('[data-visual="circuit-field"]');
  const pulse = field.locator('g').last();
  await expect(field).toHaveAttribute('data-motion', 'playing');
  await expect
    .poll(() => pulse.evaluate((node) => node.getAnimations({ subtree: true }).length), {
      intervals: [50, 100, 200],
    })
    .toBe(3);
  const start = await pulse
    .locator('path')
    .last()
    .evaluate((node) => getComputedStyle(node).strokeDashoffset);
  await expect
    .poll(() =>
      pulse
        .locator('path')
        .last()
        .evaluate((node) => getComputedStyle(node).strokeDashoffset),
    )
    .not.toBe(start);
  const screenshot = testInfo.outputPath('hero-electric-pulse.png');
  await page.screenshot({
    path: screenshot,
    style: 'nextjs-portal { visibility: hidden !important; }',
  });
  await testInfo.attach('hero-electric-pulse', { path: screenshot, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Pause background motion' }).click();
  await expect(field).toHaveAttribute('data-motion', 'paused');
  await expect
    .poll(() => pulse.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
  await page.getByRole('button', { name: 'Resume background motion' }).click();
  await expect(field).toHaveAttribute('data-motion', 'playing');
  await page.getByRole('heading', { name: 'The current boundary.' }).scrollIntoViewIfNeeded();
  await expect(field).toHaveAttribute('data-motion', 'idle');
  await expect
    .poll(() => pulse.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await expect(field).toHaveAttribute('data-motion', 'reduced');
  await expect(field.getByRole('button')).toHaveCount(0);
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
      'reduced',
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
