import { test } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { DEMO_USER } from '../../test-data/users';

// This spec tests the login UI itself, so start without any saved auth.
test.use({ storageState: { cookies: [], origins: [] } });

test('valid credentials land on the dashboard', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  const login = new LoginPage(page);
  await login.goto();
  await login.login(DEMO_USER.username, DEMO_USER.password);
  const dashboard = new DashboardPage(page);
  await dashboard.assertLoaded();
});
