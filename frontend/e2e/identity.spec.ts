import { expect, test } from '@playwright/test';

const session = {
  user: {
    display_name: 'Ada Lovelace',
    github_login: 'ada',
    github_avatar_url: 'https://avatars.example/ada.png',
    github_profile_url: 'https://github.com/ada',
  },
  csrf_token: 'mocked-csrf-token',
};

const corsHeaders = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'X-CSRF-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': 'http://127.0.0.1:3001',
};

async function mockSession(
  page: import('@playwright/test').Page,
  response: object | (() => object),
  status: number | (() => number) = 200,
) {
  await page.route('http://api.test/api/v1/auth/session', (route) => {
    const payload = typeof response === 'function' ? response() : response;
    const responseStatus = typeof status === 'function' ? status() : status;
    return route.fulfill({
      body: JSON.stringify(payload),
      contentType: 'application/json',
      headers: corsHeaders,
      status: responseStatus,
    });
  });
}

test('logged-out login starts the configured OAuth endpoint without loading repository data', async ({
  page,
}) => {
  await mockSession(page, {}, 401);

  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to Repo Surgeon' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
    'href',
    'http://api.test/api/v1/auth/github/start',
  );
  await expect(page.getByText('Repository connections are not available yet.')).toBeVisible();
  await expect(page.getByText('payments-api')).toHaveCount(0);
});

test('callback resolves a mocked session into the safe profile and logs out with CSRF', async ({
  page,
}) => {
  let loggedOut = false;
  await mockSession(
    page,
    () => (loggedOut ? {} : session),
    () => (loggedOut ? 401 : 200),
  );
  let logoutRequest: import('@playwright/test').Request | undefined;
  await page.route('http://api.test/api/v1/auth/logout', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    logoutRequest = route.request();
    loggedOut = true;
    await route.fulfill({ headers: corsHeaders, status: 204 });
  });

  await page.goto('/auth/callback');
  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
  await expect(page.getByText('Connections are not available yet')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login?signed_out=1');
  expect(logoutRequest?.headers()['x-csrf-token']).toBe('mocked-csrf-token');
});
