import { type Page, type Locator, expect } from '@playwright/test';

export class PatientsPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchSubmit: Locator;
  readonly addPatientLink: Locator;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly phone: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  // Personal tab — extra fields beyond firstName / lastName / phone
  readonly email: Locator;
  readonly dob: Locator;
  readonly gender: Locator; // Select2-wrapped <select>, hidden
  readonly occupation: Locator;
  readonly ageLabel: Locator;
  // Address tab
  readonly address1: Locator;
  readonly address2: Locator;
  readonly town: Locator;
  readonly state: Locator;
  readonly postcode: Locator;
  // Physical tab
  readonly weight: Locator;
  // GP tab
  readonly gpName: Locator;
  readonly nhsNumber: Locator;
  readonly contactGp: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('#search_filter_search');
    // Magnifying-glass submit, scoped to the form containing the search
    // input so we don't accidentally match a submit elsewhere on the page.
    this.searchSubmit = page
      .locator('form:has(#search_filter_search) button[type="submit"]')
      .first();
    this.addPatientLink = page.locator('a[href$="/patients/new"]').first();
    this.firstName = page.locator('#patient_firstName');
    this.lastName = page.locator('#patient_lastName');
    this.phone = page.locator('#patient_phone');
    // Scope to the form containing the patient firstName input — this
    // matches the Save button on both /new (class .btn-patient-save) and
    // /edit (different class but same form).
    this.saveButton = page
      .locator('form:has(#patient_firstName) button[type="submit"]')
      .first();
    // Cancel can render as either an <a> or a <button> depending on the
    // page; match by visible text and take the first occurrence.
    this.cancelButton = page
      .locator('a:has-text("Cancel"), button:has-text("Cancel")')
      .first();
    this.email = page.locator('#patient_email');
    this.dob = page.locator('#patient_birthday');
    this.gender = page.locator('#patient_gender');
    this.occupation = page.locator('#patient_occupation');
    // Age display rendered after DOB blur — match "Age <digit…>" anywhere
    // on the page since the form puts it in a sibling label region.
    this.ageLabel = page.locator('text=/Age\\s+\\d/').first();
    this.address1 = page.locator('#patient_address1');
    this.address2 = page.locator('#patient_address2');
    this.town = page.locator('#patient_town');
    this.state = page.locator('#patient_state');
    this.postcode = page.locator('#patient_postcode');
    this.weight = page.locator('#patient_weight');
    this.gpName = page.locator('#patient_gpName');
    this.nhsNumber = page.locator('#patient_numberNHS');
    this.contactGp = page.locator('#patient_contactGp');
  }

  async gotoList(clinicId: string) {
    await this.page.goto(`/admin/clinics/${clinicId}/patients`, { waitUntil: 'commit' });
    await this.searchInput.waitFor({ state: 'visible' });
  }

  async gotoNew(clinicId: string) {
    await this.page.goto(`/admin/clinics/${clinicId}/patients/new`, { waitUntil: 'commit' });
    await this.firstName.waitFor({ state: 'visible' });
  }

  /**
   * Switch to one of the four form tabs. Fields on non-active tabs are
   * in the DOM but `display: none`, so Playwright's actionability check
   * fails on .fill() — call this before filling Address/Physical/GP fields.
   *
   * Real-click first (matches the user path), with a jQuery `.tab('show')`
   * fallback if the click didn't activate the panel within 3s. The fallback
   * is needed because of a JS-binding race: tab handlers (Bootstrap + jQuery
   * UI tabs both wired here) sometimes aren't attached when the click fires.
   */
  async clickTab(name: 'Personal' | 'Address' | 'Physical' | 'GP') {
    const hrefMap: Record<typeof name, string> = {
      Personal: '#personal',
      Address: '#find-address',
      Physical: '#physical-parameters',
      GP: '#gp-address',
    };
    const href = hrefMap[name];

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1_000);

    // Scope to .nav-link — the form ALSO has dropdown-menu items
    // (`a.dropdown-item[data-toggle="tab"][href="#find-address"]` for
    // "Find Address From Postcode") that share the same href. The
    // unscoped selector matches both and trips strict mode.
    const tabSelector = `a.nav-link[data-toggle="tab"][href="${href}"]`;
    await this.page.locator(tabSelector).click();

    await this.page
      .locator(href)
      .waitFor({ state: 'visible', timeout: 3_000 })
      .catch(async () => {
        // Click didn't activate — fall back to Bootstrap's tab API via jQuery.
        await this.page.evaluate((sel) => {
          const w = window as unknown as { jQuery?: (s: string) => { tab: (action: string) => void } };
          if (w.jQuery) w.jQuery(sel).tab('show');
        }, tabSelector);
        await this.page.locator(href).waitFor({ state: 'visible', timeout: 10_000 });
      });
  }

  async fill(fields: { firstName: string; lastName: string; phone: string }) {
    await this.firstName.fill(fields.firstName);
    await this.lastName.fill(fields.lastName);
    await this.phone.fill(fields.phone);
  }

  async save() {
    // Brief settle for the same JS-binding race that affects search/delete:
    // in long loops the save click can fire before the form's submit
    // handler is wired and end up a no-op.
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(500);
    await this.saveButton.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/patients\/\d+(?:[/?#]|$)/, {
      waitUntil: 'commit',
      timeout: 120_000,
    });
  }

  /**
   * Abandon the new-patient form (must be on /patients/new). Clicks
   * Cancel and waits for navigation away from /new — typically back to
   * the list, but we don't pin the destination since it can vary.
   */
  async cancel() {
    await this.cancelButton.click({ noWaitAfter: true });
    await this.page.waitForURL(
      (url) => !url.toString().includes('/patients/new'),
      { waitUntil: 'commit', timeout: 60_000 },
    );
  }

  async search(query: string) {
    await this.searchInput.fill(query);
    // Brief settle: in long loops on slow staging, the submit-click can
    // fire before the search form's submit handler is bound, resulting
    // in a no-op (no navigation, waitForURL times out). Same JS-binding
    // race we work around in delete().
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(500);
    await this.searchSubmit.click({ noWaitAfter: true });
    await this.page.waitForURL(/search_filter%5Bsearch%5D=/, {
      waitUntil: 'commit',
      timeout: 90_000,
    });
    await this.searchInput.waitFor({ state: 'visible' });
  }

  /**
   * Count patients visible on the current page.
   *
   * The list renders as ONE <table> where each <tr> can hold TWO
   * patient cells side by side (the app stacks results into an
   * n/2 rows × 2 columns layout when there are many). Counting <tr>
   * rows undercounts by ~2×.
   *
   * Each patient cell contains an avatar anchor (no text) AND a name
   * anchor (the patient's name) — both pointing at /patients/{id}/edit.
   * Counting only the NAMED anchors (filter by non-empty text) gives
   * the true patient count regardless of layout.
   */
  async count(): Promise<number> {
    return this.page
      .locator('table.dataTable tbody a[href$="/edit"]')
      .filter({ hasText: /\S/ })
      .count();
  }

  /**
   * Open the patient whose name matches `firstNameQuery` from the
   * current search results. Pass the row index when multiple matches
   * exist (defaults to the first).
   */
  async openByName(firstNameQuery: string, index = 0) {
    const nameLink = this.page
      .locator('table.dataTable tbody a[href$="/edit"]')
      .filter({ hasText: firstNameQuery })
      .nth(index);
    await nameLink.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/patients\/\d+\//, { waitUntil: 'commit' });
    await this.firstName.waitFor({ state: 'visible' });
  }

  /**
   * Delete the currently-open patient (must be on /patients/{id}/edit).
   * Walks the two-modal Consentz delete chain:
   *   1. Page-level Delete button (.btn-danger) → opens #deleteModal{id}patient
   *   2. Confirm modal's `.btn-outline-danger` Delete button → opens #passModal{id}patient
   *   3. Fill password, submit → server POSTs to /patients/{id}/delete and redirects away
   */
  async delete(password: string) {
    const idMatch = this.page.url().match(/\/patients\/(\d+)\//);
    if (!idMatch) throw new Error(`delete(): not on a patient detail page — url=${this.page.url()}`);
    const patientId = idMatch[1]!;

    // Wait for Bootstrap modal JS bindings to attach. The Delete button uses
    // data-toggle="modal" — clicking before bindings are wired is a no-op,
    // and the form's `visible` state alone doesn't guarantee modal JS is ready.
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1_500);

    // 1. Open the confirm modal
    await this.page.locator('button.btn-danger:has-text("Delete")').first().click();
    const confirmModal = this.page.locator(`#deleteModal${patientId}patient`);
    await confirmModal.waitFor({ state: 'visible', timeout: 15_000 });

    // 2. Click the modal's Delete (.btn-outline-danger — distinct from
    //    the page-level .btn-danger trigger) to open the password modal
    await confirmModal.locator('button.btn-outline-danger').first().click();
    const passModal = this.page.locator(`#passModal${patientId}patient`);
    await passModal.waitFor({ state: 'visible', timeout: 15_000 });

    // 3. Fill password + submit, wait for nav away from /edit
    await passModal.locator('input[type="password"]').first().fill(password);
    // Brief settle so the password-submit handler is wired before we click.
    await this.page.waitForTimeout(500);
    await passModal.locator('button[type="submit"]').first().click({ noWaitAfter: true });
    await this.page.waitForURL(
      (url) => !url.toString().includes(`/patients/${patientId}/edit`),
      { waitUntil: 'commit', timeout: 120_000 },
    );
  }

  /**
   * Assert the search results show the empty-state "No Results" message.
   * Use after `search(marker)` to verify a patient is gone.
   */
  async assertNoResults() {
    await expect(this.page.getByText(/no\s*results?/i).first()).toBeVisible({
      timeout: 90_000,
    });
  }

  /**
   * Fill the optional Personal-tab fields. Pass only the keys you care
   * about; the others are left untouched.
   *
   * `dob` is blurred after fill so the on-blur age-calc handler runs
   * (otherwise the Age label below the field doesn't render).
   */
  async fillPersonal(opts: { email?: string; dob?: string; occupation?: string }) {
    if (opts.email !== undefined) await this.email.fill(opts.email);
    if (opts.dob !== undefined) {
      await this.dob.fill(opts.dob);
      await this.dob.blur();
      await this.page.waitForTimeout(500);
    }
    if (opts.occupation !== undefined) await this.occupation.fill(opts.occupation);
  }

  /**
   * Pick a gender option by index. The native <select id="patient_gender">
   * is hidden by Select2 (data-plugin="select2"), so Playwright's
   * selectOption fails the visibility check. We set the underlying value
   * directly and dispatch jQuery's change so Select2 syncs its UI.
   * Returns the value that was selected.
   */
  async selectGender(optionIndex: number): Promise<string> {
    const value = await this.page.evaluate((idx) => {
      const sel = document.getElementById('patient_gender') as HTMLSelectElement;
      if (sel.options.length <= idx) return '';
      sel.value = sel.options[idx]!.value;
      const w = window as unknown as {
        jQuery?: (el: HTMLElement) => { trigger: (e: string) => void };
      };
      if (w.jQuery) w.jQuery(sel).trigger('change');
      return sel.value;
    }, optionIndex);
    // Brief settle so Select2's UI/state has flushed before the next action
    // (without it the test was flaky — change handler hadn't propagated yet).
    await this.page.waitForTimeout(300);
    return value;
  }

  /** Read the saved gender value (the underlying <select> is Select2-hidden). */
  async getGenderValue(): Promise<string> {
    // Wait for the element to be in DOM (state: attached, not visible —
    // the underlying select is permanently hidden by Select2). Without
    // this, evaluate() can fire before the form has finished rendering
    // post-reload and getElementById returns null.
    await this.gender.waitFor({ state: 'attached', timeout: 10_000 });
    return this.page.evaluate(
      () => (document.getElementById('patient_gender') as HTMLSelectElement).value,
    );
  }

  /**
   * Fill Address-tab fields. Switches to the Address tab automatically.
   */
  async fillAddress(opts: {
    line1?: string;
    line2?: string;
    town?: string;
    state?: string;
    postcode?: string;
  }) {
    await this.clickTab('Address');
    if (opts.line1 !== undefined) await this.address1.fill(opts.line1);
    if (opts.line2 !== undefined) await this.address2.fill(opts.line2);
    if (opts.town !== undefined) await this.town.fill(opts.town);
    if (opts.state !== undefined) await this.state.fill(opts.state);
    if (opts.postcode !== undefined) await this.postcode.fill(opts.postcode);
  }

  /** Fill Physical-tab fields. Switches to the Physical tab automatically. */
  async fillPhysical(opts: { weight?: string }) {
    await this.clickTab('Physical');
    if (opts.weight !== undefined) await this.weight.fill(opts.weight);
  }

  /** Fill GP-tab fields. Switches to the GP tab automatically. */
  async fillGp(opts: { gpName?: string; nhsNumber?: string; contactGp?: boolean }) {
    await this.clickTab('GP');
    if (opts.gpName !== undefined) await this.gpName.fill(opts.gpName);
    if (opts.nhsNumber !== undefined) await this.nhsNumber.fill(opts.nhsNumber);
    // The native <input type="checkbox"> is hidden by a custom switch
    // widget; even .check({ force: true }) errors on visibility. Set the
    // checked state via JS and dispatch a change event so any listeners
    // (and the form serializer) see the toggle.
    if (opts.contactGp !== undefined) {
      await this.page.evaluate((checked) => {
        const cb = document.getElementById('patient_contactGp') as HTMLInputElement;
        cb.checked = checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }, opts.contactGp);
    }
  }

  /**
   * Open the page-level Delete button to surface the confirm modal, then
   * dismiss it via the close button (×) without confirming. Use this in
   * tests that verify the modal-cancel path leaves the patient intact.
   */
  async cancelDeleteConfirm() {
    const idMatch = this.page.url().match(/\/patients\/(\d+)\//);
    if (!idMatch) {
      throw new Error(`cancelDeleteConfirm(): not on a patient detail page — url=${this.page.url()}`);
    }
    const patientId = idMatch[1]!;

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1_500);

    await this.page.locator('button.btn-danger:has-text("Delete")').first().click();
    const confirmModal = this.page.locator(`#deleteModal${patientId}patient`);
    await confirmModal.waitFor({ state: 'visible', timeout: 15_000 });

    // Bootstrap modal close button (×) — Escape doesn't dismiss this modal.
    await confirmModal.locator('button.close, [data-dismiss="modal"]').first().click();
    await confirmModal.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  /**
   * Walk the full delete chain submitting `password`, but DON'T wait for
   * any specific post-submit URL — server behaviour on a wrong password
   * varies (sometimes redirects to list, sometimes stays). The caller
   * verifies the patient still exists afterwards.
   */
  async tryDelete(password: string) {
    const idMatch = this.page.url().match(/\/patients\/(\d+)\//);
    if (!idMatch) {
      throw new Error(`tryDelete(): not on a patient detail page — url=${this.page.url()}`);
    }
    const patientId = idMatch[1]!;

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1_500);

    await this.page.locator('button.btn-danger:has-text("Delete")').first().click();
    const confirmModal = this.page.locator(`#deleteModal${patientId}patient`);
    await confirmModal.waitFor({ state: 'visible', timeout: 15_000 });

    await confirmModal.locator('button.btn-outline-danger').first().click();
    const passModal = this.page.locator(`#passModal${patientId}patient`);
    await passModal.waitFor({ state: 'visible', timeout: 15_000 });

    await passModal.locator('input[type="password"]').first().fill(password);
    await this.page.waitForTimeout(500);
    await passModal.locator('button[type="submit"]').first().click({ noWaitAfter: true });
    // Let the server respond, then return — caller decides what to assert.
    await this.page.waitForTimeout(3_000);
  }

  async assertOnList() {
    await expect(this.searchInput).toBeVisible();
    await expect(this.addPatientLink).toBeVisible();
  }

  async assertOnNewForm() {
    await expect(this.firstName).toBeVisible();
    await expect(this.lastName).toBeVisible();
    await expect(this.phone).toBeVisible();
    await expect(this.saveButton).toBeVisible();
  }
}
