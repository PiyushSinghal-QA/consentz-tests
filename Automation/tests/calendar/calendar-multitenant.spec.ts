import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { CalendarPage } from '../../pages/calendar/CalendarPage';
import { DEMO_USER } from '../../test-data/users';

// Cross-clinic event isolation. tester2 owns clinics 1080 (default) and
// 1081. An event booked in 1080 must NOT appear on 1081's calendar.
// Multi-tenant data leak between clinics would be a serious bug.

const PRIMARY_CLINIC = '1080';
const OTHER_CLINIC = '1081';

function todayAt(hour: number, minute: number): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(hour).padStart(2, '0');
  const mn = String(minute).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${mn}`;
}

test('an event booked in clinic 1080 is invisible from clinic 1081', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(7 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  // Sanity guard — default landing has been clinic 1080 historically.
  // Fail fast if topology has changed.
  const landed = dashboard.getClinicId();
  if (landed !== PRIMARY_CLINIC) {
    throw new Error(
      `Expected default clinic ${PRIMARY_CLINIC}, landed on ${landed}.`,
    );
  }

  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);
  const patients = new PatientsPage(page);
  await patients.gotoNew(PRIMARY_CLINIC);
  await patients.fill({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });
  await patients.save();

  // Book the event in PRIMARY_CLINIC
  const calendar = new CalendarPage(page);
  await calendar.goto(PRIMARY_CLINIC);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  // Daytime hour — after-hours bookings (e.g. 22:00) appear to silently
  // fail validation, leaving the modal open and the test stuck.
  await calendar.setStart(todayAt(11, 30));
  await calendar.setEnd(todayAt(12, 0));
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  // Sanity: visible on PRIMARY_CLINIC's calendar
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(1);

  // Switch to OTHER_CLINIC — the event must NOT be visible there
  await calendar.goto(OTHER_CLINIC);
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(0);

  // Cleanup: back to PRIMARY_CLINIC, delete the patient (orphans the
  // appointment per cascade behaviour, but search by marker won't find
  // it post-delete anyway).
  await patients.gotoList(PRIMARY_CLINIC);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
