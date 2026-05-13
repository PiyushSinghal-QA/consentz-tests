import { test, expect, type Page, type Locator } from '@playwright/test';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// Tracked-bug tripwires for Dashboard.
//
// Each `test.fail()` keeps the suite green while the bug exists; the
// moment the underlying defect is fixed, the assertions succeed and
// Playwright flips the test red — that's the signal to un-mark, drop
// the bug from BUGS.md / bug-severity.json, and turn this into a
// regression test.

// ---- Local widget-library helpers -------------------------------------
// We don't have a stable WidgetLibrary page object yet — these are
// best-effort discovery helpers. When the right selectors are pinned,
// promote into pages/dashboard/WidgetLibraryPage.ts.

async function openWidgetLibrary(page: Page): Promise<Locator> {
  // The library is class-toggled off-screen (per memory note). Find a
  // toggle button + click it. Multiple candidate selectors because we
  // haven't pinned the canonical one yet.
  const toggleCandidates = [
    'button:has-text("Add widget")',
    'button:has-text("Widget Library")',
    'button:has-text("Library")',
    '[data-target*="widget-library" i]',
    '[data-target*="widgetLibrary" i]',
    'aside.widget-library-toggle',
    '.add-widget',
  ];
  for (const sel of toggleCandidates) {
    const t = page.locator(sel).first();
    if ((await t.count()) > 0) {
      await t.click({ noWaitAfter: true }).catch(() => null);
      await page.waitForTimeout(500);
      break;
    }
  }

  // Discover the library panel itself
  const panelCandidates = [
    '#widget-library',
    '.widget-library',
    'aside.library',
    'aside[class*="library" i]',
    '[class*="WidgetLibrary" i]',
  ];
  for (const sel of panelCandidates) {
    const p = page.locator(sel).first();
    if ((await p.count()) > 0 && (await p.isVisible())) return p;
  }
  return page.locator('aside').first();
}

function libraryTile(library: Locator, label: RegExp): Locator {
  return library.locator(`[class*="tile" i], [class*="card" i], [data-widget], li, a, button`).filter({ hasText: label }).first();
}

function widgetOnDashboard(page: Page, label: RegExp): Locator {
  return page.locator(`main [class*="widget" i], main section, main article`).filter({ hasText: label }).first();
}

// ---------- K11: Widget graphs do not render on initial load ----------

test.fail('[K11] widget graphs should render on initial dashboard load', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.assertLoaded();

  const anyCanvasRendered = await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    if (canvases.length === 0) return false;
    return canvases.some((c) => {
      try {
        return (c.toDataURL() || '').length > 1500;
      } catch {
        return false;
      }
    });
  }, null, { timeout: 8_000 }).then(() => true).catch(() => false);

  expect(anyCanvasRendered, 'At least one widget chart should render pixels on initial load').toBe(true);
});

// ---------- K13: Brand logo is not a homepage hyperlink ----------

test.fail('[K13] clicking the brand logo should navigate to the dashboard', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();
  await page.goto(`/admin/clinics/${clinicId}/patients`, { waitUntil: 'commit' });
  await page.waitForTimeout(500);

  const logoCandidates = [
    'header .brand img',
    'header .logo',
    'header img[alt*="consentz" i]',
    '[class*="logo"] img',
    'a[href="/"] img',
    'header a:has(img):first-of-type',
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
  await expect(page).toHaveURL(/\/admin\/clinics\/\d+\/dashboard/);
});

// ---------- K9 / K10: Clinic-switch uncaught JS exceptions ----------

test.fail('[K9, K10] switching clinics should not raise uncaught JS exceptions', async ({ page }) => {
  test.setTimeout(120_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  const switcherCandidates = [
    'header [class*="clinic" i] button',
    'header select[name*="clinic" i]',
    '[data-clinic-switch]',
    'a:has-text("Switch clinic")',
    'header button:has-text(/clinic/i)',
  ];
  let switcher: Locator | null = null;
  for (const sel of switcherCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) { switcher = loc; break; }
  }
  expect(switcher, 'Clinic switcher should be discoverable').not.toBeNull();
  await switcher!.click({ noWaitAfter: true }).catch(() => null);
  await page.waitForTimeout(500);

  const altOption = page.locator('a[href*="/admin/clinics/"]:not([href*="/dashboard"])').first();
  if ((await altOption.count()) > 0) {
    await altOption.click({ noWaitAfter: true }).catch(() => null);
    await page.waitForTimeout(4_000);
  }

  const expected = pageErrors.filter((m) =>
    /cannot convert undefined or null to object|no method named 'destroy'/i.test(m),
  );
  expect(expected, `Clinic switch raised uncaught JS exceptions: ${expected.join('; ')}`).toEqual([]);
});

// ---------- K2 / K3 / K4: Widget-Library add fails silently ----------

const SILENT_ADD_BUGS: Array<{ id: string; title: string; label: RegExp }> = [
  { id: 'K2', title: 'Patient Referrals',  label: /patient referrals/i },
  { id: 'K3', title: 'Receipts',           label: /^receipts$/i },
  { id: 'K4', title: 'Revenue per Period', label: /revenue per period/i },
];
for (const w of SILENT_ADD_BUGS) {
  test.fail(`[${w.id}] adding the "${w.title}" widget from the library should put it on the dashboard`, async ({ page }) => {
    test.setTimeout(90_000);

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.assertLoaded();
    await page.waitForTimeout(2_000);

    const library = await openWidgetLibrary(page);
    const tile = libraryTile(library, w.label);
    await expect(tile, `Library tile for "${w.title}" should exist`).toHaveCount(1);

    await tile.click({ noWaitAfter: true }).catch(() => null);
    await page.waitForTimeout(3_000);

    const widget = widgetOnDashboard(page, w.label);
    await expect(widget, `"${w.title}" widget should appear on the dashboard after add`).toBeVisible({ timeout: 8_000 });
  });
}

// ---------- K18: Library does not mark "in-use" widgets ----------

test.fail('[K18] widgets already on the dashboard should be visually distinct in the Library', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await page.waitForTimeout(2_000);

  // Read which widgets are currently on the dashboard (collect their titles).
  const dashboardWidgetTitles = await page.locator(`main [class*="widget" i], main section`)
    .evaluateAll((els) => els.map((el) => (el.querySelector('h1,h2,h3,h4')?.textContent || '').trim()).filter(Boolean));

  if (dashboardWidgetTitles.length === 0) {
    throw new Error('No widgets detected on dashboard — cannot probe K18 without a baseline');
  }

  const library = await openWidgetLibrary(page);
  // For each on-dashboard title, look for the matching library tile and
  // assert it has SOME selected/in-use marker class or attribute. The bug
  // is the *absence* of any such marker.
  const tilesWithMarker: string[] = [];
  for (const title of dashboardWidgetTitles) {
    const tile = libraryTile(library, new RegExp(title.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
    if ((await tile.count()) === 0) continue;
    const markerScore = await tile.evaluate((el) => {
      const cls = (el.className || '').toLowerCase();
      const ariaPressed = el.getAttribute('aria-pressed');
      const dataInUse = el.getAttribute('data-in-use');
      const dataSelected = el.getAttribute('data-selected');
      return Number(
        /\b(selected|in-use|added|active|on-dashboard|disabled)\b/.test(cls) ||
        ariaPressed === 'true' ||
        dataInUse === 'true' ||
        dataSelected === 'true',
      );
    });
    if (markerScore) tilesWithMarker.push(title);
  }

  expect(tilesWithMarker.length, 'Library tiles for on-dashboard widgets should carry a selected/in-use marker').toBeGreaterThan(0);
});

// ---------- K19: Re-clicking a Library tile errors ----------

test.fail('[K19] re-clicking a Library tile that is already on the dashboard should toggle/remove, not error', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await page.waitForTimeout(2_000);

  const dashboardWidgetTitle = await page.locator(`main [class*="widget" i], main section`).first()
    .locator('h1,h2,h3,h4').innerText().catch(() => '');
  if (!dashboardWidgetTitle) {
    throw new Error('No widget visible on dashboard — cannot probe K19');
  }

  const library = await openWidgetLibrary(page);
  const tile = libraryTile(library, new RegExp(dashboardWidgetTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
  await expect(tile, `Library tile for already-added "${dashboardWidgetTitle}" should exist`).toHaveCount(1);

  // Listen for any error toast / inline error
  const errorTexts: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errorTexts.push(msg.text()); });

  await tile.click({ noWaitAfter: true }).catch(() => null);
  await page.waitForTimeout(3_000);

  // Expected post-fix: either the widget is removed (no longer on dashboard)
  // OR a clean toggle UI shows up. No error toast.
  const errorToast = await page.locator(':is([role="alert"], .toast-error, .alert-error, .error-message):visible').count();
  expect(errorToast, 'Re-clicking added widget should not show an error toast').toBe(0);
});

// ---------- K20: Three stacked loading spinners on Widget Settings ----------

test.fail('[K20] opening Widget Settings should show at most one loading spinner', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await page.waitForTimeout(2_000);

  // Find a settings icon/button on any widget
  const settingsTrigger = page.locator(
    'main [class*="widget" i] :is([class*="settings" i], [aria-label*="settings" i], [data-target*="settings" i]), button:has-text(/⚙|settings/i)',
  ).first();
  await expect(settingsTrigger, 'A widget settings trigger should exist').toHaveCount(1);
  await settingsTrigger.click({ noWaitAfter: true }).catch(() => null);

  // Sample spinner count quickly — the bug is "three spinners shown
  // simultaneously" right after opening, so check within the first 1s.
  let maxSpinners = 0;
  for (let i = 0; i < 5; i++) {
    const count = await page.locator(':is(.spinner, .loading, [class*="loading-spinner" i], [class*="loader" i]):visible').count();
    if (count > maxSpinners) maxSpinners = count;
    await page.waitForTimeout(200);
  }
  expect(maxSpinners, `Should show at most one loading spinner at a time (saw ${maxSpinners})`).toBeLessThanOrEqual(1);
});
