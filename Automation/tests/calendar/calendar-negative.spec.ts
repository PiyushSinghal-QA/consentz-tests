import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { CalendarPage } from '../../pages/calendar/CalendarPage';
import { DEMO_USER } from '../../test-data/users';

// Booking-modal negative paths — abort flows + required-field validation.

function todayAt(hour: number, minute: number): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(hour).padStart(2, '0');
  const mn = String(minute).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${mn}`;
}

test('Cancel button on booking modal does not create an event', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Patient setup so the typeahead can pick something — the test verifies
  // that even with a fully-valid booking filled in, hitting Cancel
  // creates nothing.
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

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(todayAt(9, 30));
  await calendar.setEnd(todayAt(10, 0));
  await calendar.pickPatientByTypeahead(marker);
  // Cancel instead of Save
  await calendar.cancelBookingModal();

  // No event should exist for this marker on the grid
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(0);

  // Cleanup the patient
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('booking with no practitioner selected is rejected — no event created', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

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

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  // INTENTIONALLY skip pickFirstPractitioner
  await calendar.setStart(todayAt(10, 30));
  await calendar.setEnd(todayAt(11, 0));
  await calendar.pickPatientByTypeahead(marker);

  await calendar.appointmentSave.click();
  await page.waitForTimeout(3_000);

  // Modal should still be visible (save blocked by validation)
  await expect(calendar.appointmentModal).toBeVisible();
  // The specific error string the app surfaces at the top of the form
  await expect(page.getByText(/please select a practitioner/i)).toBeVisible({
    timeout: 10_000,
  });
  // No event on the grid
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(0);
  // Validation failure must be 4xx (or in-page), never 5xx
  // Tidy up — close modal, then delete patient
  await calendar.cancelBookingModal();
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('booking with no start time is rejected — no event created', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

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

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  // Clear the auto-populated start, leave it blank
  await page.locator('#appointment_start').fill('');
  await page.locator('#appointment_start').blur();
  await calendar.setEnd(todayAt(13, 0));
  await calendar.pickPatientByTypeahead(marker);

  await calendar.appointmentSave.click();
  await page.waitForTimeout(3_000);

  await expect(calendar.appointmentModal).toBeVisible();
  // App surfaces the standard "This field is required" message under
  // empty Start/End inputs — assert at least one is visible.
  await expect(
    page.getByText(/this field is required/i).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(0);
  await calendar.cancelBookingModal();
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
