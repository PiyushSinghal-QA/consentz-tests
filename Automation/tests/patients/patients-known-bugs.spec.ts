import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';

// `test.fail()` tripwires don't need retries.
test.describe.configure({ retries: 0 });

// Tracked-bug tripwires. `test.fail()` keeps the suite green while the
// bug exists; the moment it's fixed, the assertions pass and Playwright
// flips the test red — un-mark and convert to a regression test.

/** dd-mm-yyyy of N months ago (the age-calc handler runs on blur of #patient_birthday). */
function dobMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

test.fail(
  '[K25] age label should show months for patients under 1 year old',
  async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    // BUG: when DOB resolves to an age under 1 year, the Age display
    // beneath the DOB field renders nothing at all. Expected: show
    // months (e.g., "Age 0 years 6 months" or "Age 6 months").

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    const clinicId = dashboard.getClinicId();

    const marker = `Probe${Date.now().toString(36)}`;

    const patients = new PatientsPage(page);
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: marker,
      lastName: 'Test',
      phone: `7${Date.now().toString().slice(-9)}`,
    });
    // fillPersonal({ dob }) blurs after fill so the age handler fires.
    await patients.fillPersonal({ dob: dobMonthsAgo(6) });

    await expect(patients.ageLabel).toBeVisible({ timeout: 5_000 });
    await expect(patients.ageLabel).toContainText(/month/i);
  },
);

test.fail(
  '[K26] age label should include the months component (1y 3m must not show as "Age 1")',
  async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    // BUG: the Age display rounds down to whole years. A patient who is
    // 1 year 3 months old shows "Age 1" — the months are silently
    // dropped. Expected: show both ("Age 1 year 3 months" or similar).

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    const clinicId = dashboard.getClinicId();

    const marker = `Probe${Date.now().toString(36)}`;

    const patients = new PatientsPage(page);
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: marker,
      lastName: 'Test',
      phone: `7${Date.now().toString().slice(-9)}`,
    });
    await patients.fillPersonal({ dob: dobMonthsAgo(15) }); // 1 year 3 months ago

    await expect(patients.ageLabel).toBeVisible({ timeout: 5_000 });
    await expect(patients.ageLabel).toContainText(/month/i);
  },
);

test.fail(
  '[K27] future DOB should be rejected, not silently accepted',
  async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    // BUG: per Piyush, the form is supposed to reject future DOB with
    // the message "Date of Birth cannot be in the future." On v3 today
    // the patient saves successfully (verified 2026-05-10 with DOB
    // 01-01-2125 → /patients/{id}/edit). Un-skip when the validation
    // is wired and this should be a passing rejection test.

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    const clinicId = dashboard.getClinicId();

    const marker = `Probe${Date.now().toString(36)}`;

    const patients = new PatientsPage(page);
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: marker,
      lastName: 'Test',
      phone: `7${Date.now().toString().slice(-9)}`,
    });
    await patients.fillPersonal({ dob: '01-01-2125' });
    await page.waitForTimeout(500);
    await patients.saveButton.click({ noWaitAfter: true });
    await page.waitForTimeout(3_000);

    await expect(page).toHaveURL(/\/patients\/new/);
    await expect(page.getByText(/cannot be in the future/i)).toBeVisible({ timeout: 10_000 });
  },
);

test.fail(
  '[K28] DOB before 1900 should be rejected, not silently accepted',
  async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    // BUG: per Piyush, the form is supposed to reject DOB with year
    // < 1900 with "Date too old. Minimum year is 1900." On v3 today
    // the patient saves successfully (verified 2026-05-10 with DOB
    // 01-01-1800 → /patients/{id}/edit). Un-skip when the validation
    // is wired.

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    const clinicId = dashboard.getClinicId();

    const marker = `Probe${Date.now().toString(36)}`;

    const patients = new PatientsPage(page);
    await patients.gotoNew(clinicId);
    await patients.fill({
      firstName: marker,
      lastName: 'Test',
      phone: `7${Date.now().toString().slice(-9)}`,
    });
    await patients.fillPersonal({ dob: '01-01-1800' });
    await page.waitForTimeout(500);
    await patients.saveButton.click({ noWaitAfter: true });
    await page.waitForTimeout(3_000);

    await expect(page).toHaveURL(/\/patients\/new/);
    await expect(page.getByText(/date too old.*1900/i)).toBeVisible({ timeout: 10_000 });
  },
);
