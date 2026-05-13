import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// Tracked-bug tripwires for Dashboard.
//
// Each `test.fail()` keeps the suite green while the bug exists; the
// moment the underlying defect is fixed, the assertions succeed and
// Playwright flips the test red — that's the signal to un-mark, drop
// the bug from BUGS.md / bug-severity.json, and turn this into a
// regression test.
//
// `test.fixme()` marks bugs whose accurate tripwire is blocked on
// dom-exploration / page-object work we haven't done yet (e.g. widget
// library selectors). They appear in the dashboard as "automated" but
// skipped, which is honest: we know what to write, we just don't have
// the selectors yet.

// ---------- K11: Widget graphs do not render on initial load ----------

test.fail('[K11] widget graphs should render on initial dashboard load (no need to refresh)', async ({ page }) => {
  test.setTimeout(60_000);

  // BUG K11: on initial dashboard load, no widget chart canvases render
  // pixels until the user toggles widgets or switches cards. Expected
  // post-fix: at least one chart canvas is non-empty by 8s after load.

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.assertLoaded();

  // Wait up to 8s for any canvas in the widget area to have actual pixels
  // (i.e. a non-default toDataURL). Doing it via `evaluate` lets us inspect
  // the canvas pixel buffer rather than trusting visibility, which can
  // report a "rendered" canvas that's actually empty.
  const anyCanvasRendered = await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    if (canvases.length === 0) return false;
    return canvases.some((c) => {
      try {
        const data = c.toDataURL();
        // Empty canvas toDataURL is a tiny, predictable string; rendered
        // ones are much larger.
        return data && data.length > 1500;
      } catch {
        return false;
      }
    });
  }, null, { timeout: 8_000 }).then(() => true).catch(() => false);

  expect(anyCanvasRendered, 'At least one widget chart should render pixels on initial load').toBe(true);
});

// ---------- K13: Brand logo is not a homepage hyperlink ----------

test.fail('[K13] clicking the brand logo should navigate to the dashboard, not open a gridmenu', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const startUrl = page.url();

  // Navigate to a non-dashboard page so a real homepage-link click would
  // produce a visible URL change.
  await page.goto(`/admin/clinics/${dashboard.getClinicId()}/patients`, { waitUntil: 'commit' });
  await page.waitForTimeout(500);

  // Try several likely logo selectors — the bug is "logo opens gridmenu",
  // so the logo IS present, just bound to the wrong handler.
  const logoCandidates = [
    'header .brand img',
    'header .logo',
    'header img[alt*="consentz" i]',
    '[class*="logo"] img',
    'a[href="/"] img',
  ];
  let clicked = false;
  for (const sel of logoCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click({ noWaitAfter: true }).catch(() => null);
      clicked = true;
      break;
    }
  }
  expect(clicked, 'Should find a brand logo element to click').toBe(true);
  await page.waitForTimeout(1_500);

  // Expected post-fix: clicking the logo lands us on /dashboard.
  await expect(page).toHaveURL(/\/admin\/clinics\/\d+\/dashboard/);
});

// ---------- K9 / K10: Clinic-switch uncaught JS exceptions ----------

test.fail('[K9, K10] switching clinics should not raise uncaught JS exceptions', async ({ page }) => {
  test.setTimeout(120_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  // Find the clinic switcher (Consentz topbar uses a dropdown). Try a few
  // common selectors; if none match, fail fast so the human knows to
  // teach the selector.
  const switcherCandidates = [
    'header [class*="clinic" i] button',
    'header select[name*="clinic" i]',
    '[data-clinic-switch]',
    'a:has-text("Switch clinic")',
  ];
  let switcher = page.locator('xxx-placeholder');
  for (const sel of switcherCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) { switcher = loc; break; }
  }
  expect(await switcher.count(), 'Clinic switcher should be discoverable').toBeGreaterThan(0);

  await switcher.click({ noWaitAfter: true }).catch(() => null);
  await page.waitForTimeout(500);

  // Pick the first option that's not the current clinic.
  const altOption = page.locator('a[href*="/admin/clinics/"]:not([href*="/dashboard"])').first();
  if ((await altOption.count()) > 0) {
    await altOption.click({ noWaitAfter: true }).catch(() => null);
    await page.waitForTimeout(4_000);
  }

  // K9/K10 specifics — match either message
  const expected = pageErrors.filter((m) =>
    /cannot convert undefined or null to object|no method named 'destroy'/i.test(m),
  );
  expect(expected, `Clinic switch raised uncaught JS exceptions: ${expected.join('; ')}`).toEqual([]);
});

// ---------- K2 / K3 / K4: Widget-Library add fails silently ----------

const SILENT_ADD_BUG_WIDGETS: Array<{ id: string; title: string; libraryLabel: RegExp }> = [
  { id: 'K2', title: 'Patient Referrals',  libraryLabel: /patient referrals/i },
  { id: 'K3', title: 'Receipts',           libraryLabel: /^receipts$/i },
  { id: 'K4', title: 'Revenue per Period', libraryLabel: /revenue per period/i },
];
for (const w of SILENT_ADD_BUG_WIDGETS) {
  test.fixme(`[${w.id}] adding the "${w.title}" widget from the library should put it on the dashboard`, async ({ page }) => {
    // BLOCKED: needs a verified locator for the Widget Library tile +
    // its add button, plus a way to assert the widget appears on the
    // dashboard. Once we have WidgetLibrary page object, the body
    // looks like:
    //
    //   await dashboard.goto();
    //   await dashboard.openLibrary();
    //   await dashboard.addWidget(w.libraryLabel);
    //   await expect(dashboard.widgetByTitle(w.title)).toBeVisible({ timeout: 5_000 });
    //
    // For now, recorded as test.fixme so the bug-to-test mapping is
    // captured and the dashboard tags this as automated-pending.
    void page; void w;
  });
}

// ---------- K18: Library does not visually mark "in-use" widgets ----------

test.fixme('[K18] widgets already on the dashboard should be visually distinct in the Library', async ({ page }) => {
  // BLOCKED: the bug *is* the absence of an indicator — we need product
  // to specify what the indicator will look like (CSS class? aria-pressed?
  // a badge?). Once the contract exists, the tripwire asserts that
  // tile.is(... selected/in-use marker ...).
  void page;
});

// ---------- K19: Re-clicking an added Library tile errors ----------

test.fixme('[K19] re-clicking a Library tile that is already on the dashboard should toggle/remove, not error', async ({ page }) => {
  // BLOCKED: needs the WidgetLibrary page object + a stable selector for
  // the in-tile error toast. Once available:
  //   await dashboard.openLibrary();
  //   const tile = dashboard.tileFor(/already added/i);
  //   await tile.click(); // first click: was already added by setup
  //   // expected post-fix: widget removed; library marks tile available
  //   await expect(tile).not.toHaveAttribute('class', /in-use/);
  void page;
});

// ---------- K20: Three stacked loading spinners on Widget Settings ----------

test.fixme('[K20] opening Widget Settings should show at most one loading spinner', async ({ page }) => {
  // BLOCKED: needs Widget Settings page object + a way to count
  // `.loading-spinner` (or whatever the class is) at modal-open time.
  void page;
});
