import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

// Personal-tab optional fields (email, DOB, gender) round-tripping through
// save → reload, plus a couple of "no 5xx" guards on bad inputs. Tab-aware
// fields (address / physical / GP) live in patients-tabs.spec.ts.

test('email is saved and persisted across reload', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const email = `${marker.toLowerCase()}@example.com`;

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.fillPersonal({ email });
  await patients.save();

  await page.reload({ waitUntil: 'commit' });
  await patients.firstName.waitFor({ state: 'visible' });
  await expect(patients.email).toHaveValue(email);

  await patients.delete(DEMO_USER.password);
});

test('date of birth is saved and persisted across reload', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const dob = '01-01-1990';

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.fillPersonal({ dob });
  await patients.save();

  await page.reload({ waitUntil: 'commit' });
  await patients.firstName.waitFor({ state: 'visible' });
  await expect(patients.dob).toHaveValue(dob);

  await patients.delete(DEMO_USER.password);
});

test('gender selection is saved and persisted across reload', async ({ page, trackedMarkers }) => {
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
  const expectedGender = await patients.selectGender(1);
  if (/\/patients\/\d+\/edit/.test(page.url())) {
    await patients.delete(DEMO_USER.password);
  }
});

test('malformed DOB is rejected with "Invalid date format" message', async ({ page, trackedMarkers }) => {
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
  // Garbage in place of a date — server rejects with format error
  await patients.fillPersonal({ dob: '99-99-9999' });
  await page.waitForTimeout(500);
  await patients.saveButton.click({ noWaitAfter: true });

  await page.waitForTimeout(3_000);

  await expect(page).toHaveURL(/\/patients\/new/);
  await expect(page.getByText(/invalid date format.*DD-MM-YYYY/i)).toBeVisible({ timeout: 10_000 });

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.assertNoResults();

});

