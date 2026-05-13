import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// `test.fail()` tripwires don't need retries.
test.describe.configure({ retries: 0 });

// Tracked-bug tripwires for Marketing.
//
// K5 — Marketing › Template Library: 3× 404s on default thumbnails
//      (/library/61/image/default-image{3,4,5}.png).
// K6 — Marketing › Ads: 404 on /uploads/medium/1662660561.png.

test.fail('[K5] Marketing › Template Library should not return 404s on default thumbnails', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const fourOhFours: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() === 404 && /\/library\/.*\/image\/default-image\d+\.png/i.test(resp.url())) {
      fourOhFours.push(resp.url());
    }
  });

  // Marketing → Template Library
  for (const p of [
    `/admin/clinics/${clinicId}/marketing/templates`,
    `/admin/clinics/${clinicId}/marketing/template-library`,
    `/admin/clinics/${clinicId}/marketing/templates/library`,
  ]) {
    await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    await page.waitForTimeout(1_500);
  }

  expect(fourOhFours, `Default thumbnails should load (got: ${fourOhFours.join(', ')})`).toEqual([]);
});

test.fail('[K6] Marketing › Ads should not return 404 on banner image', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const fourOhFours: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() === 404 && /\/uploads\/medium\/\d+\.png/i.test(resp.url())) {
      fourOhFours.push(resp.url());
    }
  });

  for (const p of [
    `/admin/clinics/${clinicId}/marketing/ads`,
    `/admin/clinics/${clinicId}/marketing/banners`,
  ]) {
    await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    await page.waitForTimeout(1_500);
  }

  expect(fourOhFours, `Banner image should load (got: ${fourOhFours.join(', ')})`).toEqual([]);
});
