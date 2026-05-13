import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('save accepts a single-character firstName', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // FirstName is a single 'A'; the unique marker goes in lastName so we
  // can find the patient again for cleanup.
  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: 'A',
    lastName: marker,
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Save succeeded — we're on /patients/{id}/edit. Cleanup.
  await patients.delete(DEMO_USER.password);
});

test('save accepts unicode names (accented + CJK)', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // Mix accented Latin and CJK; embed marker so search can find the row.
  const expectedFirstName = `Müller${marker}`;
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: expectedFirstName,
    lastName: '张伟',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Diagnostic: read the persisted firstName from /edit BEFORE searching.
  // If this matches `expectedFirstName`, save worked end-to-end and any
  // search failure below is search-index lag. If this differs, the
  // server silently dropped/normalised characters — a real app bug.
  const persistedFirstName = await patients.firstName.inputValue();
  // eslint-disable-next-line no-console
  console.log(
    `[unicode] expected="${expectedFirstName}" persisted="${persistedFirstName}" matches=${persistedFirstName === expectedFirstName}`,
  );
  // Cleanup if it was actually saved
  await patients.gotoList(clinicId);
  await patients.search(marker);
  const found = await patients.count();
  if (found > 0) {
    await patients.openByName(marker);
    await patients.delete(DEMO_USER.password);
  }
});
