import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { INVALID_USER } from '../../test-data/users';

// Tracked-bug tripwires + regression tests for Auth/Login.
//
// On v3 (the active staging target), invalid credentials correctly bounce
// the user back to /admin/login with an inline error — this is the desired
// behavior. The same probe on v4 returned an HTTP 500 (previously tracked
// as K23 and now dropped because v4 isn't the target). The test below
// locks in the v3 contract so a future regression to the v4-style 500
// would fail loudly.

test.use({ storageState: { cookies: [], origins: [] } });

test('invalid credentials land on the login form with an error, not a 500', async ({ page }) => {
  test.setTimeout(60_000);

  const login = new LoginPage(page);
  await login.goto();
  await login.username.fill(INVALID_USER.username);
  await login.password.fill(INVALID_USER.password);
  await login.submit.click({ noWaitAfter: true });
  await page.waitForTimeout(3_000);

  // Still on (or back at) /admin/login (NOT /admin/login_check or a 500 page).
  await expect(page).toHaveURL(/\/admin\/login(?!_check)/);
  // No Symfony 500 template visible.
  await expect(page.getByText(/oops!.*error.*occurred/i)).toHaveCount(0);
});
