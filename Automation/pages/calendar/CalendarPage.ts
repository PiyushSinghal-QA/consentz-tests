import { type Page, type Locator, expect } from '@playwright/test';

export class CalendarPage {
  readonly page: Page;
  // FullCalendar view-switcher buttons
  readonly viewDay: Locator;
  readonly viewWeek: Locator;
  readonly viewMonth: Locator;
  // Booking
  readonly bookAppointmentButton: Locator;
  readonly appointmentModal: Locator;
  readonly appointmentSave: Locator;
  readonly appointmentPatientId: Locator; // hidden, set by typeahead
  readonly notes: Locator;

  constructor(page: Page) {
    this.page = page;
    this.viewDay = page.locator('.fc-agendaDay-button');
    this.viewWeek = page.locator('.fc-agendaWeek-button');
    this.viewMonth = page.locator('.fc-month-button');
    this.bookAppointmentButton = page.locator('#new_appointment');
    // Scope the modal locator by the field it contains so we don't have to
    // hard-code its own ID (DOM has multiple modals — appointment + meeting).
    this.appointmentModal = page.locator('.modal:has(#appointment_patientId)');
    this.appointmentSave = page.locator('#save_appointment');
    this.appointmentPatientId = page.locator('#appointment_patientId');
    this.notes = page.locator('#appointment_notes');
  }

  async goto(clinicId: string) {
    await this.page.goto(`/admin/clinics/${clinicId}/appointments/calendar`, {
      waitUntil: 'commit',
    });
    // Wait for FullCalendar's toolbar to render
    await this.viewDay.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async switchView(view: 'Day' | 'Week' | 'Month') {
    const btn =
      view === 'Day' ? this.viewDay : view === 'Week' ? this.viewWeek : this.viewMonth;
    await btn.click();
    await expect(btn).toHaveClass(/fc-state-active/);
  }

  async openBookingModal() {
    // Modal JS-binding race — the button uses data-toggle="modal", same
    // pattern that bit us on patient delete. Brief settle keeps it stable.
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1_000);
    await this.bookAppointmentButton.click();
    await this.appointmentModal.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Pick the first non-empty option in the practitioner Select2. The
   * native <select> is hidden so we set the value via JS and trigger
   * jQuery's change so Select2 syncs (same workaround as patient gender).
   * Returns the selected value.
   */
  async pickFirstPractitioner(): Promise<string> {
    return this.page.evaluate(() => {
      const sel = document.getElementById('appointment_clinicUser') as HTMLSelectElement;
      for (const opt of Array.from(sel.options)) {
        if (opt.value) {
          sel.value = opt.value;
          const w = window as unknown as {
            jQuery?: (el: HTMLElement) => { trigger: (e: string) => void };
          };
          if (w.jQuery) w.jQuery(sel).trigger('change');
          return opt.value;
        }
      }
      return '';
    });
  }

  /**
   * Type into the patient typeahead, wait for results, click the first
   * suggestion. Sets `#appointment_patientId` as a side effect. Retries
   * for ~10s because freshly-created patients have noticeable search-
   * index lag — same pattern that bit the patient search tests.
   */
  async pickPatientByTypeahead(query: string) {
    const input = this.page.locator('#appointment_patient');
    const item = this.page.locator('.typeahead__item').first();
    for (let attempt = 0; attempt < 10; attempt++) {
      await input.fill(query);
      await this.page.waitForTimeout(1_000);
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        return;
      }
    }
    throw new Error(`Patient typeahead never returned a match for ${JSON.stringify(query)}`);
  }

  /**
   * Set the start time. The field accepts `DD-MM-YYYY HH:MM` and the
   * Bootstrap datepicker normalises it to `DD Month YYYY HH.mm`.
   */
  async setStart(text: string) {
    await this.page.locator('#appointment_start').fill(text);
    await this.page.locator('#appointment_start').blur();
  }

  async setEnd(text: string) {
    await this.page.locator('#appointment_end').fill(text);
    await this.page.locator('#appointment_end').blur();
  }

  /**
   * Click Save and wait for the modal to close (and FullCalendar to
   * re-render with the new event).
   */
  async saveBooking() {
    await this.appointmentSave.click();
    await this.appointmentModal.waitFor({ state: 'hidden', timeout: 30_000 });
    // FullCalendar refreshes after save; small settle so the event is
    // in the DOM before the next assertion runs.
    await this.page.waitForTimeout(1_500);
  }

  /** Set the appointment Notes textarea. */
  async setNotes(text: string) {
    await this.notes.fill(text);
  }

  /**
   * Click an event on the calendar grid to surface its details modal
   * (`#detailsEvent`). Find the event by hasText (typically a patient
   * marker). The outer `<a>` intercepts clicks via `calendarEventClick`,
   * so we click the inner `.calendar-event-wrapper` div which carries
   * `data-toggle="modal" data-target="#detailsEvent"`.
   */
  async openEventDetails(matcher: string | RegExp) {
    const event = this.page
      .locator('.fc-event')
      .filter({ hasText: matcher })
      .first();
    await event.locator('.calendar-event-wrapper').click();
    await this.page
      .locator('#detailsEvent')
      .waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForTimeout(1_000);
  }

  /**
   * Edit the start/end of the appointment whose details modal is open.
   * Walks: details → pencil icon → edit form → fill new times →
   * `#edit_save_appointment`. The edit form uses parallel field IDs
   * with an `edit_` prefix to avoid colliding with the booking form.
   */
  async editAppointmentTime(start: string, end: string) {
    await this.page
      .locator('#detailsEvent .edit_appoinments')
      .first()
      .evaluate((el) => (el as HTMLButtonElement).click());
    await this.page
      .locator('#edit_appointment_form')
      .waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForTimeout(1_000);

    await this.page.locator('#edit_appointment_start').fill(start);
    await this.page.locator('#edit_appointment_start').blur();
    await this.page.locator('#edit_appointment_end').fill(end);
    await this.page.locator('#edit_appointment_end').blur();

    await this.page.locator('#edit_save_appointment').click();
    await this.page
      .locator('#edit_appointment_form')
      .waitFor({ state: 'hidden', timeout: 30_000 });
    // FullCalendar refresh
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Toggle the All-Day checkbox in the booking modal. Native input is
   * hidden by a switch widget — set checked + dispatch change via JS.
   */
  async setAllDay(value: boolean) {
    await this.page.evaluate((checked) => {
      const cb = document.getElementById('appointment_allDay') as HTMLInputElement;
      cb.checked = checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  /** Toggle the Video appointment checkbox (same pattern as All-Day). */
  async setVideo(value: boolean) {
    await this.page.evaluate((checked) => {
      const cb = document.getElementById('appointment_videoApt') as HTMLInputElement;
      cb.checked = checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  /**
   * Cancel/delete the appointment whose details modal is currently
   * open. The Delete button in `#edit_appointment_form` doesn't open a
   * confirmation modal — it navigates to
   * `/appointments/{id}/delete/edit?calendar=1&recurring=0` which
   * performs the delete server-side and redirects back to the calendar.
   * No password / confirmation step (UX worth flagging separately).
   */
  async cancelAppointment() {
    // 1. Open the edit form via the pencil icon on detailsEvent
    await this.page
      .locator('#detailsEvent .edit_appoinments')
      .first()
      .evaluate((el) => (el as HTMLButtonElement).click());
    await this.page
      .locator('#edit_appointment_form')
      .waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForTimeout(1_000);

    // 2. Click Delete inside the edit form. This kicks off a navigation
    //    to /appointments/{id}/delete/... → calendar redirect; wait for
    //    the redirect to finish.
    const navBack = this.page.waitForURL(/\/appointments\/calendar/, {
      waitUntil: 'commit',
      timeout: 30_000,
    });
    await this.page
      .locator('#edit_appointment_form button.btn-outline-danger:has-text("Delete")')
      .first()
      .evaluate((el) => (el as HTMLButtonElement).click());
    await navBack;

    // FullCalendar boots after the redirect; wait for the toolbar +
    // a render settle so the next assertion sees the post-delete grid.
    await this.viewDay.waitFor({ state: 'visible', timeout: 30_000 });
    await this.page.waitForTimeout(1_500);
  }

  /** Dismiss the booking modal via its Cancel button (no save). */
  async cancelBookingModal() {
    // Cancel button has `data-dismiss="modal"` (Bootstrap pattern) but
    // sits inside a tab/section that registers as "not visible" to
    // Playwright even after scroll. Fire the click via JS evaluate —
    // the data-dismiss handler attaches at document level and runs
    // regardless of CSS visibility.
    await this.appointmentModal
      .locator('button[data-dismiss="modal"]:has-text("Cancel")')
      .first()
      .evaluate((el) => (el as HTMLButtonElement).click());
    await this.appointmentModal.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  /**
   * Use the booking modal's inline "Add Patient" toggle to create a
   * brand-new patient without leaving the modal. Fills the 4 required
   * fields (firstName, lastName, phone — countryCode defaults to the
   * clinic's primary), optional email, then clicks
   * `#confirm-patient-form` to save the inline patient.
   *
   * Modal stays open afterwards with the new patient selected as the
   * appointment's patient — caller decides whether to continue with the
   * booking or navigate away.
   */
  async addPatientInline(opts: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
  }) {
    const toggle = this.appointmentModal.locator('button:has-text("Add Patient")').first();
    await toggle.click();
    await this.page.waitForTimeout(800);

    await this.page.locator('#patient_firstName').fill(opts.firstName);
    await this.page.locator('#patient_lastName').fill(opts.lastName);
    await this.page.locator('#patient_phone').fill(opts.phone);
    if (opts.email !== undefined) {
      await this.page.locator('#patient_email').fill(opts.email);
    }

    await this.page.locator('#confirm-patient-form').click();
    // Settle for the inline save POST + modal state update.
    await this.page.waitForTimeout(2_500);
  }
}
