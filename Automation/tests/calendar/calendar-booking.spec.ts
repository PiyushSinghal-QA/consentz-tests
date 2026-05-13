import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { CalendarPage } from '../../pages/calendar/CalendarPage';
import { DEMO_USER } from '../../test-data/users';

// Booking happy path. Doubles as a regression test for the
// dev-team-reported "booking saved but not shown on calendar" bug —
// the post-save assertion specifically requires the event to render
// in the FullCalendar grid.

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

test('book an appointment for an existing patient and see it on the calendar', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // 1. Create a patient to book against
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

  // 2. Open the calendar (Day view = today by default) and book
  const startStr = todayAt(12, 0);
  const endStr = todayAt(12, 30);

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(startStr);
  await calendar.setEnd(endStr);
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  // 3. Verify the event renders on the calendar grid. FullCalendar
  //    paints events as `.fc-event` elements with the patient name in
  //    the title region. Also assert EXACTLY ONE event with this marker
  //    — catches the render-duplicate bug class (one save → two events
  //    drawn) which is distinct from the user-action duplicate bug.
  const eventOnGrid = page.locator('.fc-event').filter({ hasText: marker });
  await expect(eventOnGrid.first()).toBeVisible({ timeout: 10_000 });
  await expect(
    eventOnGrid,
    'Expected exactly 1 event for this marker after a single save (catches render duplicates).',
  ).toHaveCount(1);

  // 4. Cleanup: delete the patient. Note: cascade behaviour for the
  //    linked appointment is unknown — tracked in PENDING-ITEMS.
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('booked appointment renders at the time it was saved (no timezone / format drift)', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  // Targets dev-team complaint #3: "wrong timings". Saves an event at a
  // known hour, then asserts the rendered .fc-event text contains that
  // same hour. Tolerant to "HH:00" or "HH.00" since Consentz's display
  // format uses a dot.

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

  const BOOK_HOUR = 14; // pick a non-midnight, non-noon hour to be unambiguous
  const startStr = todayAt(BOOK_HOUR, 0);
  const endStr = todayAt(BOOK_HOUR, 30);

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(startStr);
  await calendar.setEnd(endStr);
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  const event = page.locator('.fc-event').filter({ hasText: marker }).first();
  await expect(event).toBeVisible();
  const text = (await event.textContent()) ?? '';
  // The hour we set must appear in the rendered event content. Tolerant
  // to 24-hour ("14:00" / "14.00") OR 12-hour ("2:00 pm") format since
  // the clinic locale isn't pinned. Word boundaries prevent "12:00"
  // false-matching when we expect "2:00 pm".
  const hour12 = ((BOOK_HOUR + 11) % 12) + 1;
  const ampm = BOOK_HOUR < 12 ? 'am' : 'pm';
  const expected = new RegExp(
    `\\b${BOOK_HOUR}[:.]00\\b|\\b${hour12}[:.]00 ?${ampm}\\b`,
    'i',
  );
  expect(
    text,
    `Rendered event time mismatch — expected hour ${BOOK_HOUR} but got: ${JSON.stringify(text)}`,
  ).toMatch(expected);

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('booked appointment is still shown after reloading the calendar page', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  // Targets dev-team complaint #2: "bookings not shown". Saves an
  // event, asserts it renders, reloads the page, asserts it STILL
  // renders. Catches both the live-render path and the server-fetch /
  // re-paint path on initial load.

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

  const startStr = todayAt(16, 0);
  const endStr = todayAt(16, 30);

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(startStr);
  await calendar.setEnd(endStr);
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  // Live render
  const event = page.locator('.fc-event').filter({ hasText: marker });
  await expect(event.first()).toBeVisible();

  // Reload + re-paint
  await page.reload({ waitUntil: 'commit' });
  await calendar.viewDay.waitFor({ state: 'visible' });
  // Best-effort full-load wait; FullCalendar boots after DCL.
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  await expect(event.first()).toBeVisible({ timeout: 15_000 });

  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('cancel/delete an appointment removes it from the calendar grid', async ({
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

  // Book at a daytime hour
  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(todayAt(9, 30));
  await calendar.setEnd(todayAt(10, 0));
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  // Sanity: event present
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(1);

  // Open event → walk the cancel chain → event gone
  await calendar.openEventDetails(marker);
  await calendar.cancelAppointment();
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(0);

  // Cleanup the patient
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});

test('a booking whose patient is deleted shows "Patient record deleted" on the calendar', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(7 * 60 * 1000);

  // Verifies cascade behaviour for patient deletion: the appointment is
  // NOT deleted along with the patient — instead the calendar event
  // stays on the grid with a "Patient record deleted" indicator.
  // (This was a PENDING-ITEMS unknown until now — observed manually
  // 2026-05-10, codified here.)

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

  // Daytime hour to stay within clinic-open window (after-hours
  // bookings appear to be rejected silently — saw 21:00/22:00 fail).
  const BOOK_HOUR = 9;
  const startStr = todayAt(BOOK_HOUR, 0);
  const endStr = todayAt(BOOK_HOUR, 30);

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.pickFirstPractitioner();
  await calendar.setStart(startStr);
  await calendar.setEnd(endStr);
  await calendar.pickPatientByTypeahead(marker);
  await calendar.saveBooking();

  // Sanity: event renders with patient name pre-deletion
  await expect(page.locator('.fc-event').filter({ hasText: marker })).toHaveCount(1);

  // Delete the patient
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);

  // Reload the calendar so any cached patient-name reference is refreshed
  await calendar.goto(clinicId);

  // The orphaned event no longer carries the patient marker (replaced
  // by "Patient record deleted"), so we can't filter by marker. Look
  // for ANY visible event whose text contains "deleted" — this confirms
  // the cascade contract (orphan, not delete).
  const orphanEvents = page.locator('.fc-event').filter({ hasText: /deleted/i });
  await expect(orphanEvents.first()).toBeVisible({ timeout: 15_000 });

  // Note: cleaning up the orphaned appointment requires UI we don't yet
  // have a method for. Tracked in PENDING-ITEMS — accept the leak for now.
});

test('a patient created via the inline Add Patient flow appears in the regular patient list', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // 1. Open the booking modal and use its inline Add Patient flow.
  //    We never click Book Appointment — the test is solely about
  //    whether the new patient is reachable from the regular patient
  //    list afterwards.
  const marker = `Probe${Date.now().toString(36)}`;
  trackedMarkers.push(marker);

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);
  await calendar.openBookingModal();
  await calendar.addPatientInline({
    firstName: marker,
    lastName: 'Test',
    phone: `7${Date.now().toString().slice(-9)}`,
  });

  // 2. Navigate to the patient list (this also dismisses the still-open
  //    booking modal as a side effect of the page change) and search.
  const patients = new PatientsPage(page);
  await patients.gotoList(clinicId);
  await patients.search(marker);
  await expect.poll(() => patients.count(), { timeout: 90_000 }).toBe(1);

  // 3. Cleanup
  await patients.openByName(marker);
  await patients.delete(DEMO_USER.password);
});
