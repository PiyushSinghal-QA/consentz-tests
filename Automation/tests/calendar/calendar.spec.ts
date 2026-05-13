import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { CalendarPage } from '../../pages/calendar/CalendarPage';

test('calendar page loads with FullCalendar in Day view by default', async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);

  await expect(calendar.viewDay).toHaveClass(/fc-state-active/);
});

test('switching calendar views (Day → Week → Month) updates the active state', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);

  await calendar.switchView('Week');
  await calendar.switchView('Month');
  await calendar.switchView('Day');
});

test('Book Appointment opens the appointment modal', async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const calendar = new CalendarPage(page);
  await calendar.goto(clinicId);

  await calendar.openBookingModal();
  await expect(calendar.appointmentModal).toBeVisible();
});
