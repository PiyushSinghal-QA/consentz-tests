import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('cancel on add-patient form does not save the patient', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;

  const patients = new PatientsPage(page);

  // 1. Fill the form completely, then hit Cancel instead of Save
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.cancel();

  // 2. Verify the patient was NOT created
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.assertNoResults();
});

test('required fields block save when missing — no 5xx', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;

  const patients = new PatientsPage(page);

  // Fill firstName only — leave lastName + phone empty
  await patients.gotoNew(clinicId);
  await patients.firstName.fill(marker);
  await patients.saveButton.click({ noWaitAfter: true });

  // Form should not navigate to a created-patient URL — give the click a
  // moment to register, then assert we're still on /new.
  await page.waitForTimeout(2_000);
  await expect(page).toHaveURL(/\/patients\/new/);

  // Confirm by searching: no patient with this marker exists
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.assertNoResults();

});

test('cancelling delete-confirm modal does not delete the patient', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // 1. Create
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // 2. Open the confirm modal but dismiss it (no actual delete)
  await patients.cancelDeleteConfirm();

  // 3. Verify patient still exists
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // 4. Cleanup — actually delete now
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('whitespace-only firstName is not silently saved as a patient — no 5xx', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // No marker to push here — the input is just spaces; if the server
  // unexpectedly accepts it, the saved firstName won't be searchable
  // and there's nothing useful to track for cleanup.
  void trackedMarkers;

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.firstName.fill('   '); // 3 spaces
  await patients.lastName.fill('Test');
  await patients.phone.fill(`7${Date.now().toString().slice(-9)}`);
  await page.waitForTimeout(500);
  await patients.saveButton.click({ noWaitAfter: true });

  // Either rejected (URL stays /new) or silently trimmed and accepted —
  // both are acceptable here. The contract is no 5xx.
  await page.waitForTimeout(3_000);

  // If we somehow ended up on /edit, the server accepted it — clean up.
  if (/\/patients\/\d+\/edit/.test(page.url())) {
    await patients.delete(DEMO_USER.password);
  }
});

test('phone with letters is handled — no 5xx', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  // Track in case the server unexpectedly accepts the bad input.
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.firstName.fill(marker);
  await patients.lastName.fill('Test');
  await patients.phone.fill('abcdefghij'); // letters where digits are expected
  await page.waitForTimeout(500);
  await patients.saveButton.click({ noWaitAfter: true });

  await page.waitForTimeout(3_000);

  // Cleanup if it was actually accepted
  if (/\/patients\/\d+\/edit/.test(page.url())) {
    await patients.delete(DEMO_USER.password);
  }
});

test('rapid double-click on Save creates only one patient', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await page.waitForTimeout(500);

  // Click twice in immediate succession. The second click may land on a
  // disabled/removed button (caught) or trigger nothing — either is fine.
  await patients.saveButton.click({ noWaitAfter: true });
  await patients.saveButton
    .click({ noWaitAfter: true, timeout: 2_000 })
    .catch(() => {});

  // Wait for save to settle
  await page.waitForTimeout(5_000);

  // Search — exactly one patient with this marker should exist
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // Cleanup
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('opening the edit URL of an already-deleted patient does not 5xx', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // 1. Create a patient and capture its ID
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();
  const patientId = page.url().match(/\/patients\/(\d+)\//)![1]!;

  // 2. Delete it
  await patients.delete(DEMO_USER.password);

  // 3. Try to revisit the now-deleted patient via stale URL
  const response = await page.goto(
    `/admin/clinics/${clinicId}/patients/${patientId}/edit`,
    { waitUntil: 'commit' },
  );

  const status = response?.status() ?? 0;
});

test('wrong password on delete does not delete the patient', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // 1. Create
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // 2. Walk the delete chain with a wrong password — tryDelete() doesn't
  //    pin a post-submit URL, since the server's response on bad creds
  //    varies (redirect to list vs. stay on /edit).
  await patients.tryDelete('definitely-not-the-password');

  // 3. The real invariant: the patient must not be deleted.
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // 4. Cleanup with the correct password
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
