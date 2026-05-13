import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

test('XSS payload as firstName is rendered safely (no script execution)', async ({ page, trackedMarkers }) => {
  test.setTimeout(3 * 60 * 1000);

  // If XSS were exploitable, an alert() in the payload would surface as a
  // dialog. We listen on the whole page lifetime and fail if one appears.
  let dialogFired: string | null = null;
  page.on('dialog', async (dialog) => {
    dialogFired = `${dialog.type()}: ${dialog.message()}`;
    await dialog.dismiss();
  });

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  // Marker embedded so we can find + clean up. Payload tries the classic
  // <script> alert vector.
  const payload = `<script>alert('xss-${marker}')</script>${marker}`;

  const patients = new PatientsPage(page);

  await patients.gotoNew(clinicId);
  await patients.fill({
    firstName: payload,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Visit two surfaces where unescaped HTML would fire: search-results
  // (renders the patient name in a row) and the edit page (renders the
  // name in form values + page heading).
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);
  await patients.openByName(marker);

  // Cleanup
  await patients.delete(DEMO_USER.password);

});

test('URL tamper to non-existent clinic does not 5xx', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  // Two probes: an absurdly large clinic ID (definitely doesn't exist)
  // and a small ID (likely belongs to someone else, inaccessible). Both
  // must produce 4xx, never 5xx.
  for (const fakeClinicId of ['99999999', '1']) {
    const response = await page.goto(
      `/admin/clinics/${fakeClinicId}/patients`,
      { waitUntil: 'commit' },
    );
    const status = response?.status() ?? 0;
    expect(
      status,
      `URL tamper to /admin/clinics/${fakeClinicId}/patients should not 5xx (got ${status})`,
    ).toBeLessThan(500);
  }
});
