import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('bulk add 10 patients and bulk delete them all', async ({ page, trackedMarkers }) => {
  test.setTimeout(15 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Run-scoped token: same value for all 10 patients in this run, unique
  // across runs. `Probe` + base36 timestamp is search-friendly (no
  // hyphens, no long digit strings).
  const runId = `Probe${Date.now().toString(36)}`;
  // One push covers all 10 — they share the runId prefix, so the cleanup
  // search will find all remaining records in a single sweep.
  trackedMarkers.push(runId);
  const COUNT = 10;
  const names = Array.from({ length: COUNT }, (_, i) =>
    `${runId}_BULK_${String(i + 1).padStart(2, '0')}`,
  );

  const patients = new PatientsPage(page);

  // 1. Bulk add — 10 patients, all sharing the runId prefix
  for (let i = 0; i < COUNT; i++) {
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: names[i]!,
      lastName: 'Test',
      phone: `7${(Date.now() + i).toString().slice(-9)}`,
    });
    await patients.save();
  }

  // 2. Verify all 10 appear when searching by the shared runId
  await patients.gotoList(clinicId);
  await patients.search(runId);
  await expect.poll(() => patients.count(), { timeout: 120_000 }).toBe(COUNT);

  // 3. Bulk delete — for each name, re-search by runId, open the specific
  //    row (filtered by full name), and delete. Poll for the new expected
  //    count after each delete to let the search index catch up before
  //    the next iteration tries to open.
  for (let i = 0; i < COUNT; i++) {
    const expectedRemaining = COUNT - i;
    await patients.gotoList(clinicId);
    await patients.search(runId);
    await expect
      .poll(() => patients.count(), { timeout: 120_000 })
      .toBe(expectedRemaining);
    await patients.openByName(names[i]!);
    await patients.delete(DEMO_USER.password);
  }

  // 4. Verify all gone — search by runId, expect "No Results"
  await patients.gotoList(clinicId);
  await patients.search(runId);
  await patients.assertNoResults();
});

test('add and delete the same patient 10 times — CRUD persistency', async ({ page, trackedMarkers }) => {
  test.setTimeout(20 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Same marker for every iteration — we re-create and re-delete the
  // same logical patient 10 times to verify the create/delete cycle is
  // stable and search reflects the latest state on every pass.
  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const ITERATIONS = 10;

  const patients = new PatientsPage(page);

  for (let i = 0; i < ITERATIONS; i++) {
    // 1. Add — phone has to be unique-per-iteration to avoid clashing
    //    with the previous iteration's now-soft-deleted record.
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: marker,
      lastName: 'Test',
      phone: `7${(Date.now() + i).toString().slice(-9)}`,
    });
    await patients.save();

    // 2. Search → verify present
    await patients.gotoList(clinicId);
    await patients.search(marker);
    await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

    // 3. Open + delete
    await patients.openByName(marker);
    await patients.delete(DEMO_USER.password);

    // 4. Search → verify gone
    await patients.gotoList(clinicId);
    await patients.search(marker);
    await patients.assertNoResults();
  }
});
