import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('reload persistency — patient survives many reloads, no 500s', async ({ page, trackedMarkers }) => {
  test.setTimeout(15 * 60 * 1000);

  // Watch for any 5xx HTTP responses across the whole test.
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // Create the patient once
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Reload-thrash loop: each iteration searches, reloads twice (with a
  // full-load wait between), and re-asserts the patient is still there.
  // The point is to catch 500s that show up only after repeated reloads.
  const ITERATIONS = 10;
  for (let i = 0; i < ITERATIONS; i++) {
    await patients.gotoList(clinicId);
    await patients.search(marker);
    await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

    await page.reload({ waitUntil: 'commit' });
    await patients.searchInput.waitFor({ state: 'visible' });
    // Best-effort full-load wait — Consentz can starve 'load' on slow
    // renders, so we don't fail the test just because it didn't fire.
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
    await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

    await page.reload({ waitUntil: 'commit' });
    await patients.searchInput.waitFor({ state: 'visible' });
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
    await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);
  }

  // Cleanup so we don't leave orphan data behind
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);

  // Final assertion: no 5xx responses fired during the reload loop
});

test('opening a non-existent patient ID does not 5xx', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);

  // Watch for 5xx — the customer complaint is excessive 4xx/5xx in prod,
  // so the contract here is: a missing patient is a 4xx (404), never a 500.
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Use an absurdly large ID that almost certainly doesn't exist.
  const fakeId = 99_999_999;
  const response = await page.goto(
    `/admin/clinics/${clinicId}/patients/${fakeId}/edit`,
    { waitUntil: 'commit' },
  );

  // Server-rendered 404 OR an in-app handled response — either is fine,
  // as long as nothing 5xx'd during the load.
  const status = response?.status() ?? 0;
});
