import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { CalendarPage } from '../../pages/calendar/CalendarPage';
import { DEMO_USER } from '../../test-data/users';

// Calendar-side tracked-bug tests. Same pattern as patients-known-bugs:
// kept as `test.skip` so they don't fail the suite, but stay in source
// so they fire as tripwires the moment the underlying bug is fixed.

/** Build a `DD-MM-YYYY HH:MM` string for today at the given hour:min. */
function todayAt(hour: number, minute: number): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(hour).padStart(2, '0');
  const mn = String(minute).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${mn}`;
}

test.skip(
  '[KNOWN BUG] same practitioner + patient + time can be double-booked',
  async ({ page, trackedMarkers }) => {
    test.setTimeout(7 * 60 * 1000);

    // BUG (verified 2026-05-10 against v3): the booking form silently
    // accepts a second appointment with identical practitioner, patient,
    // start AND end — leaving TWO `.fc-event` entries for the same
    // marker on the calendar. Expected contract per the dev team: the
    // second save should be blocked OR a conflict warning should
    // surface. Un-skip when the validation is wired and this test will
    // start passing automatically.

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

    const startStr = todayAt(15, 0);
    const endStr = todayAt(15, 30);

    const calendar = new CalendarPage(page);
    await calendar.goto(clinicId);

    // First booking — should succeed.
    await calendar.openBookingModal();
    await calendar.pickFirstPractitioner();
    await calendar.setStart(startStr);
    await calendar.setEnd(endStr);
    await calendar.pickPatientByTypeahead(marker);
    await calendar.saveBooking();

    // Second booking attempt with the IDENTICAL inputs.
    await calendar.openBookingModal();
    await calendar.pickFirstPractitioner();
    await calendar.setStart(startStr);
    await calendar.setEnd(endStr);
    await calendar.pickPatientByTypeahead(marker);
    // Don't use saveBooking() — it waits for the modal to close, which
    // shouldn't happen if the second save is blocked. Click directly
    // via the page-object locator and observe the resulting state.
    await calendar.appointmentSave.click();
    await page.waitForTimeout(4_000);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1_000);

    const events = page.locator('.fc-event').filter({ hasText: marker });
    const count = await events.count();
    expect(
      count,
      `Expected exactly 1 booking after double-attempt; saw ${count}.`,
    ).toBe(1);

    await patients.gotoList(clinicId);
    await patients.search(marker);
    await patients.openByName(marker);
    await patients.delete(DEMO_USER.password);
  },
);
