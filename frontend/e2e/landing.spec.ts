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
  await expect(field).toHaveAttribute('data-motion', 'reduced');
  expect(
    await field
      .locator('svg')
      .first()
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(field.getByRole('button')).toHaveCount(0);
});

test('background pulses move without a control and stop offscreen or for reduced motion', async ({
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
  await expect
    .poll(() => pulse.evaluate((node) => node.getAnimations({ subtree: true }).length), {
      intervals: [25, 50, 100],
    })
    .toBe(0);
  await expect
    .poll(() => pulse.evaluate((node) => node.getAnimations({ subtree: true }).length), {
      intervals: [25, 50, 100],
      timeout: 1600,
    })
    .toBe(3);
  await expect(field.getByRole('button')).toHaveCount(0);
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

test('pointer movement sends bounded circuit pulses and respects reduced motion', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/landing');
  const field = page.locator('[data-visual="circuit-field"]');
  const cursorPulses = field.locator('[data-cursor-pulse]');
  await expect(field).toHaveAttribute('data-motion', 'playing');
  await page.mouse.move(260, 210, { steps: 3 });
  const active = await cursorPulses.evaluateAll(
    (groups) => groups.flatMap((node) => node.getAnimations({ subtree: true })).length,
  );
  expect(active).toBeGreaterThan(0);
  expect(active).toBeLessThanOrEqual(6);
  const screenshot = testInfo.outputPath('hero-cursor-pulses.png');
  await page.screenshot({
    path: screenshot,
    style: 'nextjs-portal { visibility: hidden !important; }',
  });
  await testInfo.attach('hero-cursor-pulses', { path: screenshot, contentType: 'image/png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(field).toHaveAttribute('data-motion', 'reduced');
  await expect
    .poll(() =>
      cursorPulses.evaluateAll(
        (groups) => groups.flatMap((node) => node.getAnimations({ subtree: true })).length,
      ),
    )
    .toBe(0);
  await page.mouse.move(300, 250, { steps: 3 });
  expect(
    await cursorPulses.evaluateAll(
      (groups) => groups.flatMap((node) => node.getAnimations({ subtree: true })).length,
    ),
  ).toBe(0);
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

test('code globe counter-scrolls and magnifies an illustrative review', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/landing');
  const globe = page.locator('[data-visual="inspection-mark"]');
  await expect(globe).toHaveAttribute('data-running', 'true');
  const bands = globe.locator('textPath');
  const values = await bands.evaluateAll((nodes) =>
    nodes.slice(8, 10).map((node) => (node as SVGTextPathElement).startOffset.animVal.value),
  );
  await expect
    .poll(async () =>
      bands.evaluateAll((nodes) =>
        nodes.slice(8, 10).map((node) => (node as SVGTextPathElement).startOffset.animVal.value),
      ),
    )
    .not.toEqual(values);
  const after = await bands.evaluateAll((nodes) =>
    nodes.slice(8, 10).map((node) => (node as SVGTextPathElement).startOffset.animVal.value),
  );
  expect(after[0]).toBeGreaterThan(values[0]);
  expect(after[1]).toBeLessThan(values[1]);
  const magnifier = globe.getByRole('button', { name: 'Magnify an illustrative code review' });
  const bounds = (await globe.locator('svg').first().boundingBox())!;
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
  const original = await globe.locator('[data-selected="true"] text').textContent();
  await expect(globe).toHaveAttribute('data-review-phase', 'edited');
  expect(await globe.locator('[data-selected="true"] text').textContent()).not.toBe(original);
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
  expect(
    await globe
      .locator('svg')
      .first()
      .evaluate(async (element) => {
        const svg = element as SVGSVGElement;
        const before = svg.getCurrentTime();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return svg.getCurrentTime() - before;
      }),
  ).toBe(0);
});

for (const width of [1910, 1024]) {
  test(`globe lens explores the rim without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 989 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/landing');
    const globe = page.locator('[data-visual="inspection-mark"]');
    const bounds = (await globe.locator('svg').first().boundingBox())!;
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
