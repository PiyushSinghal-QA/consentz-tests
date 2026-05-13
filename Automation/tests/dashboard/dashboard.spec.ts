import { test } from '@playwright/test';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

test('dashboard loads', async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.assertLoaded();
});
