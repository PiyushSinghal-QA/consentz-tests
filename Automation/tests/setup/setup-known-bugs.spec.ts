import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// `test.fail()` tripwires don't need retries.
test.describe.configure({ retries: 0 });

// Tracked-bug tripwires for Set Up.
//
// K8 — Set Up › T&C: CKEditor JS file 404s, so the rich-text editor
//      is broken. Tripwire visits the T&C page and listens for 404s
//      on /bundles/fosckeditor/ckeditor.js. `test.fail()` while the
//      404 happens; flips red on fix.

test.fail('[K8] Set Up › T&C should load CKEditor without 404', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const fourOhFours: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() === 404 && /ckeditor\.js/i.test(resp.url())) {
      fourOhFours.push(resp.url());
    }
  });

  // T&C lives under Set Up. Several routes are plausible; the page-load
  // listener will catch the 404 regardless of where T&C lands.
  for (const p of [
    `/admin/clinics/${clinicId}/set-up/terms`,
    `/admin/clinics/${clinicId}/setup/terms`,
    `/admin/clinics/${clinicId}/set-up/tnc`,
    `/admin/clinics/${clinicId}/set-up`,
  ]) {
    await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    await page.waitForTimeout(1_000);
  }

  expect(fourOhFours, `CKEditor JS should load (got 404s: ${fourOhFours.join(', ')})`).toEqual([]);
});
