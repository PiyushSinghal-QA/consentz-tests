import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// `test.fail()` tripwires don't need retries — an unexpected-pass on retry
// would just duplicate the "may be fixed" signal we already capture on the
// first attempt. Saves CI time and stops the dashboard from showing the
// same probe twice.
test.describe.configure({ retries: 0 });

// Tracked-bug tripwires for Logs.
//
// K1 — Logs › Blockers returns HTTP 500 (null variable access on
//      "Impossible to access an attribute ('name') on a null variable").
//      Tripwire reaches /admin/clinics/{id}/blockers and asserts 200.
//      `test.fail()` keeps the suite green while the bug exists; the
//      moment the page returns 200, the test passes and Playwright
//      flips it red as the tripwire signal.

test.fail('[K1] Logs › Blockers should return 200, not HTTP 500', async ({ page, serverErrors }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const resp = await page.goto(`/admin/clinics/${clinicId}/blockers`, { waitUntil: 'commit' });
  expect(resp?.status() ?? 0, 'Logs › Blockers should not 5xx').toBeLessThan(500);

  // Opt out of serverErrors auto-fail — K1 emits 500 by design.
  serverErrors.length = 0;
});
