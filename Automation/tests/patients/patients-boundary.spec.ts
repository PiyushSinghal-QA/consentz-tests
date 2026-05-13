import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test.fail('[K21] save accepts a 200-character firstName (no HTTP 500)', async ({ page, trackedMarkers, serverErrors }) => {
  test.setTimeout(3 * 60 * 1000);

  // BUG K21: firstName ≥46 chars triggers HTTP 500 on save (binary-narrowed
  // 2026-05-11; ≤45 chars saves fine). Expected post-fix: client-side
  // validation OR form-level server validation, never a 500. Pinned at
  // 200 chars here to give the regression headroom.

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: 'A'.repeat(200) + marker, // 200+ chars, guaranteed >46
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Cleanup if save succeeds (i.e. K21 is fixed and we got here)
  await patients.delete(DEMO_USER.password);

  // Opt out of serverErrors auto-fail — K21 emits 500 by design.
  serverErrors.length = 0;
});

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

test.fail('[K22] save accepts unicode names (accented + CJK) AND is then searchable', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  // BUG K22: a patient with a non-ASCII firstName (e.g. `Müller${marker}`)
  // saves correctly and is reachable by direct `/edit` URL, but is INVISIBLE
  // to the list search even when the query is an ASCII substring of the
  // firstName. This `test.fail()` keeps the suite green while the bug
  // exists; the moment search starts returning the unicode row, this test
  // passes — Playwright then reports it as an unexpected pass, which is
  // the tripwire signal to un-mark and turn it into a regression.
  //
  // NOTE: a more accurate K22 tripwire would create the patient via API
  // (sidestepping any UI-save flakiness) and then poll the search endpoint.
  // The current shape leans on the UI flow for parity with how a user
  // would hit the bug.

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const patients = new PatientsPage(page);

  const expectedFirstName = `Müller${marker}`;
  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: expectedFirstName,
    lastName: '张伟',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Search by the ASCII marker that's embedded in firstName.
  await patients.gotoList(clinicId);
  await patients.search(marker);
  // Expected post-fix: search returns the unicode patient.
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBeGreaterThan(0);

  // Cleanup (only reached when bug is fixed)
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
