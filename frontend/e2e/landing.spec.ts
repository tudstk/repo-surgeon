import { expect, test } from '@playwright/test';

for (const viewport of [
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
