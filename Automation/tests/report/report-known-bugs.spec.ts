import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// Tracked-bug tripwires for Report.
//
// K7 — Report › Custom Reports: 2× 404s on report icons
//      (Giacomo%20Goodwin.svg, New%20Report.svg).
// K12 — Dashboard ↔ Reports metric mismatch: out of automation scope
//      (needs deterministic widget-vs-Reports comparison; flagged as
//      unverified in bug-severity.json). Not tripwire-ready.

test.fail('[K7] Report › Custom Reports should not return 404s on report icons', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const fourOhFours: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() === 404 && /\/images\/custom_reports\/.*\.svg/i.test(resp.url())) {
      fourOhFours.push(resp.url());
    }
  });

  for (const p of [
    `/admin/clinics/${clinicId}/reports/custom`,
    `/admin/clinics/${clinicId}/report/custom-reports`,
    `/admin/clinics/${clinicId}/reports`,
  ]) {
    await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    await page.waitForTimeout(1_500);
  }

  expect(fourOhFours, `Custom Report icons should load (got: ${fourOhFours.join(', ')})`).toEqual([]);
});
