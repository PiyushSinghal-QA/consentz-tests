import { test } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

// Cross-clinic isolation. Account `tester2` owns two clinics — 1080
// (default landing) and 1081. A patient created in one must NOT appear
// in the other's list. If both clinics start showing each other's
// patients, that's a multi-tenant data leak.

const PRIMARY_CLINIC = '1080';
const OTHER_CLINIC = '1081';

test('a patient created in clinic 1080 is invisible from clinic 1081', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  // Default landing should be clinic 1080 — assert that so the rest of
  // the test isn't accidentally running both legs in 1081.
  const landed = dashboard.getClinicId();
  if (landed !== PRIMARY_CLINIC) {
    throw new Error(
      `Expected default clinic ${PRIMARY_CLINIC}, landed on ${landed}. ` +
        `Either tester2's default changed, or someone reordered the clinics.`,
    );
  }

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  // 1. Create the patient in 1080.
  await patients.gotoNew(PRIMARY_CLINIC);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // 2. Switch to clinic 1081 directly via URL and search for the marker.
  //    Consentz drives active-clinic state from the URL, so a fresh GET
  //    on /admin/clinics/1081/patients re-scopes the session.
  await patients.gotoList(OTHER_CLINIC);
  await patients.search(marker);
  await patients.assertNoResults();

  // 3. Cleanup — back in 1080, delete the patient we just created.
  await patients.gotoList(PRIMARY_CLINIC);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
