import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('search finds a patient by lastName', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Marker goes in lastName for this test — we want to verify the search
  // filter hits the lastName column, not just firstName.
  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: 'Test',
    lastName: marker,
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // Cleanup — the row's text contains "Test {marker}", so hasText filter works
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('search finds a patient by phone number', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const phone = `7${Date.now().toString().slice(-9)}`;

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({ firstName: marker, lastName: 'Test', phone });
  await patients.save();

  // Search by the FULL phone number — long digit strings are routed to
  // the phone column by the search engine.
  await patients.gotoList(clinicId);
  await patients.search(phone);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // Cleanup
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('search is case-insensitive', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Mixed-case marker; we'll search by the all-lowercase form
  const marker = `MarkerXyz${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  await patients.gotoList(clinicId);
  await patients.search(marker.toLowerCase());
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test("search handles apostrophe in name (O'Brien-style)", async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Marker is searchable; the leading O' is the apostrophe under test.
  const marker = `Probe${Date.now().toString(36)}OBrien`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: `O'${marker}`,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('search query persists across reload (bookmarkable URL)', async ({ page, trackedMarkers }) => {
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
  await patients.save();

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);
  const filteredUrl = page.url();

  // Reload — the query string should keep the filter applied
  await page.reload({ waitUntil: 'commit' });
  await patients.searchInput.waitFor({ state: 'visible' });

  expect(page.url()).toBe(filteredUrl);
  await expect.poll(() => patients.count(), { timeout: 30_000 }).toBe(1);

  // Cleanup
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
