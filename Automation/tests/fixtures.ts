import { test as base, expect } from '@playwright/test';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { PatientsPage } from '../pages/patients/PatientsPage';
import { DEMO_USER } from '../test-data/users';

interface ServerError {
  status: number;
  method: string;
  url: string;
}

/**
 * URLs we ignore even if they 5xx. Add Symfony / framework noise here
 * if needed; keep the list short on purpose — the whole point of this
 * fixture is to surface real server errors, not bury them.
 */
const SERVER_ERROR_IGNORE = [
  /\/_wdt\//, // Symfony Web Debug Toolbar
  /\/_profiler\//, // Symfony Profiler
];

type Fixtures = {
  /**
   * Per-test array of search markers (firstName / lastName tokens or a
   * shared bulk-runId prefix) for patients the test creates. Push to it
   * whenever you create a patient. The cleanup hook below uses these to
   * find and delete any leftovers — but ONLY when the test fails. Passing
   * tests are expected to clean up after themselves and pay no extra cost.
   */
  trackedMarkers: string[];
  /**
   * Auto-populated on every `response` event whose status is 5xx (and
   * whose URL doesn't match SERVER_ERROR_IGNORE). At teardown, if the
   * test otherwise passed but this list is non-empty, the test FAILS
   * with the captured 5xx URLs. Provides a "no 5xx anywhere" contract
   * for free across the suite — the K21 / K22 class of bugs surface
   * automatically without per-test boilerplate.
   *
   * Tests that *expect* a 5xx (e.g. negative tests probing for the bug
   * itself) should inspect the array, then clear it (`errors.length = 0`)
   * before the test ends to opt out of the auto-fail.
   */
  serverErrors: ServerError[];
};

export const test = base.extend<Fixtures>({
  serverErrors: [
    async ({ page }, use, testInfo) => {
      const errors: ServerError[] = [];
      page.on('response', (resp) => {
        const status = resp.status();
        if (status < 500 || status >= 600) return;
        const url = resp.url();
        if (SERVER_ERROR_IGNORE.some((re) => re.test(url))) return;
        errors.push({ status, method: resp.request().method(), url });
      });

      await use(errors);

      // Auto-assert at teardown — but only if the test would otherwise pass.
      // If it already failed, surface the original failure instead of
      // burying it under a server-error report.
      if (testInfo.status === 'passed' && errors.length > 0) {
        const detail = errors.map((e) => `  ${e.status} ${e.method} ${e.url}`).join('\n');
        throw new Error(
          `Test assertions passed but ${errors.length} server 5xx fired during the run:\n${detail}\n\n` +
            `If your test legitimately expects a 5xx (e.g. probing K21-class behaviour), ` +
            `inspect 'serverErrors' and clear it (errors.length = 0) before the test ends.`,
        );
      }
    },
    { auto: true },
  ],
  trackedMarkers: async ({ page }, use, testInfo) => {
    const markers: string[] = [];
    await use(markers);

    // Pass-through fast path: no cleanup work for happy-path runs.
    if (testInfo.status === 'passed' || markers.length === 0) return;

    // Best-effort cleanup of orphans left behind by the failed test.
    // Wrapped in try/catch so a cleanup failure doesn't mask the real test
    // failure already recorded above.
    try {
      const dashboard = new DashboardPage(page);
      await dashboard.goto();
      const clinicId = dashboard.getClinicId();
      const patients = new PatientsPage(page);

      for (const marker of markers) {
        await patients.gotoList(clinicId);
        await patients.search(marker);

        // Delete every match — a single marker may correspond to several
        // patients (e.g., the bulk test pushes one runId that fans out to
        // 10 records). Safety bound prevents infinite loops if the search
        // count somehow doesn't drop after a delete.
        let remaining = await patients.count();
        let guard = 0;
        while (remaining > 0 && guard < 25) {
          await patients.openByName(marker);
          await patients.delete(DEMO_USER.password);
          await patients.gotoList(clinicId);
          await patients.search(marker);
          remaining = await patients.count();
          guard++;
        }
      }
    } catch (e) {
      console.warn(`[trackedMarkers cleanup] non-fatal error: ${(e as Error).message}`);
    }
  },
});

export { expect };
