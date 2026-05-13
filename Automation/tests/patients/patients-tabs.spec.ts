import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

// The add-patient form has 4 tabs (Personal default, Address, Physical, GP).
// All fields are in the DOM at once, but only the active panel is visible —
// the fillAddress / fillPhysical / fillGp methods on PatientsPage take care
// of switching tabs before filling.

test('clicking tabs switches the visible form panel', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const patients = new PatientsPage(page);
  await patients.gotoNew(clinicId);

  // Personal default — firstName visible, address hidden
  await expect(patients.firstName).toBeVisible();
  await expect(patients.address1).toBeHidden();

  await patients.clickTab('Address');
  await expect(patients.address1).toBeVisible();
  await expect(patients.firstName).toBeHidden();

  await patients.clickTab('Physical');
  await expect(patients.weight).toBeVisible();
  await expect(patients.address1).toBeHidden();

  await patients.clickTab('GP');
  await expect(patients.gpName).toBeVisible();
  await expect(patients.weight).toBeHidden();

  // Back to Personal restores the firstName field
  await patients.clickTab('Personal');
  await expect(patients.firstName).toBeVisible();
});

test('Address tab fields are saved and persisted across reload', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const addr = {
    line1: `123 ${marker} Street`,
    town: 'Sample Town',
    postcode: 'AB12 3CD',
  };

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.fillAddress(addr);
  await patients.save();

  await page.reload({ waitUntil: 'commit' });
  await patients.firstName.waitFor({ state: 'visible' });
  await patients.clickTab('Address');
  await expect(patients.address1).toHaveValue(addr.line1);
  await expect(patients.town).toHaveValue(addr.town);
  await expect(patients.postcode).toHaveValue(addr.postcode);

  await patients.delete(DEMO_USER.password);
});

test('Physical tab fields (weight) are saved and persisted across reload', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const weight = '75';

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.fillPhysical({ weight });
  await patients.save();

  await page.reload({ waitUntil: 'commit' });
  await patients.firstName.waitFor({ state: 'visible' });
  await patients.clickTab('Physical');
  await expect(patients.weight).toHaveValue(weight);

  await patients.delete(DEMO_USER.password);
});

test('GP tab fields are saved and persisted across reload', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const gpName = `Dr ${marker}`;
  const nhsNumber = '1234567890';

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.fillGp({ gpName, nhsNumber, contactGp: true });
  await patients.save();

  await page.reload({ waitUntil: 'commit' });
  await patients.firstName.waitFor({ state: 'visible' });
  await patients.clickTab('GP');
  await expect(patients.gpName).toHaveValue(gpName);
  await expect(patients.nhsNumber).toHaveValue(nhsNumber);
  await expect(patients.contactGp).toBeChecked();

  await patients.delete(DEMO_USER.password);
});
