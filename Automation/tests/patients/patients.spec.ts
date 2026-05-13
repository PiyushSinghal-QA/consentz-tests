import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('patients list loads', async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const patients = new PatientsPage(page);
  await patients.gotoList(clinicId);
  await patients.assertOnList();
});

test('add patient form loads', async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const patients = new PatientsPage(page);
  await patients.gotoNew(clinicId);
  await patients.assertOnNewForm();
});

test('add a patient and find it via search', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Unique-per-run marker. Single alphanumeric token (no hyphen, no
  // long digit sequence) — Consentz's search treats hyphens as
  // delimiters and long digit strings as phone-column queries, so a
  // marker like `pwt-1778329310407` doesn't reliably match the
  // firstName column. `Probe` + base36 timestamp is a clean string the
  // search engine matches as-is.
  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const phone = `7${Date.now().toString().slice(-9)}`;

  const patients = new PatientsPage(page);

  // 1. Create the patient
  await patients.gotoNew(clinicId);
  await patients.fill({ firstName: marker, lastName: 'Test', phone });
  await patients.save();

  // 2. Go back to the list and search by the unique marker
  await patients.gotoList(clinicId);
  await patients.search(marker);

  // 3. Verify exactly one patient appears in the results.
  //    Poll: the search index has a noticeable lag for freshly-created
  //    patients on this clinic — 90 s gives it room to catch up while
  //    still failing fast on a real bug.
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // 4. Cleanup — leave no orphan
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('add a patient, open it, delete it, and verify it is gone', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const phone = `7${Date.now().toString().slice(-9)}`;

  const patients = new PatientsPage(page);

  // 1. Create
  await patients.gotoNew(clinicId);
  await patients.fill({ firstName: marker, lastName: 'Test', phone });
  await patients.save();

  // 2. Find via search, open the row
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);
  await patients.openByName(marker);

  // 3. Delete
  await patients.delete(DEMO_USER.password);

  // 4. Verify gone — search again, results should show "No Results"
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.assertNoResults();
});

test('edit a patient and persist the change', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // `original` must NOT be a substring of `updated` — Consentz's search
  // does prefix/substring matching, so a query for the old name would
  // still hit the renamed patient and break the post-edit assertion.
  const tag = Date.now().toString(36);
  const original = `ProbeA${tag}`;
  const updated = `ProbeB${tag}`;
  // Track both prefixes — depending on where a failure lands, the patient
  // may carry either name when cleanup runs.
  trackedMarkers.push(original, updated);

  const patients = new PatientsPage(page);

  // 1. Create
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: original,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // 2. On /patients/{id}/edit. Update firstName and save in place. URL
  //    doesn't change after edit-save, so we wait for the actual POST
  //    response (more reliable than networkidle, which can resolve
  //    before the form's submit handler fires the request).
  await patients.firstName.fill(updated);
  const savedResponse = page.waitForResponse(
    (resp) =>
      resp.request().method() === 'POST' && /\/patients\/\d+/.test(resp.url()),
    { timeout: 30_000 },
  );
  await patients.saveButton.click({ noWaitAfter: true });
  await savedResponse;
  // The save POST returns a 302 → browser follows it to /patients/{id}/edit.
  // Wait for that follow-up navigation to settle before we navigate away,
  // otherwise the next gotoList collides with the in-flight redirect.
  await page
    .waitForURL(/\/patients\/\d+\/edit/, { waitUntil: 'commit', timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Diagnostic: read the persisted firstName from /edit BEFORE searching.
  // If this matches `updated`, the edit-save round-tripped server-side
  // and any search failure below is search-index lag. If it still shows
  // `original`, the edit didn't persist — a real app bug.
  const persistedFirstName = await patients.firstName.inputValue();
  // eslint-disable-next-line no-console
  console.log(
    `[edit] expected="${updated}" persisted="${persistedFirstName}" matches=${persistedFirstName === updated}`,
  );
  expect(
    persistedFirstName,
    `edit-patient should persist the new firstName (expected "${updated}", got "${persistedFirstName}")`,
  ).toBe(updated);

  // 3. Verify the new name is searchable; the old name is not
  await patients.gotoList(clinicId);
  await patients.search(updated);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  await patients.gotoList(clinicId);
  await patients.search(original);
  await patients.assertNoResults();

  // 4. Cleanup
  await patients.gotoList(clinicId);
  await patients.search(updated);
  await patients.openByName(updated);
  await patients.delete(DEMO_USER.password);
});
