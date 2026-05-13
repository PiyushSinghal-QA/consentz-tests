import { test as setup } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { DEMO_USER } from '../../test-data/users';
import { STORAGE_STATE } from '../../playwright/auth-state';

setup('authenticate', async ({ page }) => {
  setup.setTimeout(2 * 60 * 1000);
  const login = new LoginPage(page);
  await login.goto();
  await login.login(DEMO_USER.username, DEMO_USER.password);
  await page.context().storageState({ path: STORAGE_STATE });
});
