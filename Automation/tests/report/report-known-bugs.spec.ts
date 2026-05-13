import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// `test.fail()` tripwires don't need retries.
test.describe.configure({ retries: 0 });

// Tracked-bug tripwires for Report.
//
// K7  — Report › Custom Reports: 2× 404s on report icons.
// K12 — Dashboard ↔ Reports metric mismatch: same metric returns different
//       numbers on Dashboard widget vs Reports module for the same date
//       range. Tagged `unverified` in bug-severity.json because it's
//       data-dependent — the tripwire below catches the canonical case
//       (Dashboard "Total Patients" widget vs Reports patient count).

test.fail('[K7] Report › Custom Reports should not return 404s on report icons', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  const fourOhFours: string[] = [];
  page.on('response', (resp) => {
    if (resp.status() === 404 && /\/images\/custom_reports\/.*\.svg/i.test(resp.url())) {
      fourOhFours.push(resp.url());
    }
  });

  for (const p of [
    `/admin/clinics/${clinicId}/reports/custom`,
    `/admin/clinics/${clinicId}/report/custom-reports`,
    `/admin/clinics/${clinicId}/reports`,
  ]) {
    await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    await page.waitForTimeout(1_500);
  }

  expect(fourOhFours, `Custom Report icons should load (got: ${fourOhFours.join(', ')})`).toEqual([]);
});

test.fail('[K12] Dashboard widget metric should equal the same metric on Reports for the same date range', async ({ page }) => {
  test.setTimeout(120_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Read a numeric metric from a dashboard widget. We try "Total Patients"
  // since it's stable across clinics and uses an integer value.
  await page.waitForTimeout(3_000);
  const widgetCandidates = [
    'main :has-text("Total Patients") + *',
    'main [data-widget*="patient" i] [class*="value" i]',
    'main [class*="widget" i]:has-text("Patients") [class*="value" i], main [class*="widget" i]:has-text("Patients") .number',
  ];
  let dashboardMetric: number | null = null;
  for (const sel of widgetCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    const text = await loc.innerText().catch(() => '');
    const m = text.match(/[\d,]+/);
    if (m) {
      dashboardMetric = parseInt(m[0].replace(/,/g, ''), 10);
      break;
    }
  }
  if (dashboardMetric === null) {
    throw new Error('Could not read a "Total Patients" metric from any dashboard widget — selector needs work');
  }
  console.log(`[K12] dashboard "Total Patients" = ${dashboardMetric}`);

  // Now navigate to the Reports module and read the equivalent metric.
  for (const p of [
    `/admin/clinics/${clinicId}/reports`,
    `/admin/clinics/${clinicId}/reports/patients`,
    `/admin/clinics/${clinicId}/report/patients`,
  ]) {
    const resp = await page.goto(p, { waitUntil: 'commit' }).catch(() => null);
    if (resp && resp.status() < 400) break;
  }
  await page.waitForTimeout(3_000);

  const reportsCandidates = [
    'main :has-text("Total Patients") + *',
    'main [class*="total" i]:has-text("Patients") [class*="value" i]',
    'main table tr:has-text("Total Patients") td:last-child',
  ];
  let reportsMetric: number | null = null;
  for (const sel of reportsCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    const text = await loc.innerText().catch(() => '');
    const m = text.match(/[\d,]+/);
    if (m) {
      reportsMetric = parseInt(m[0].replace(/,/g, ''), 10);
      break;
    }
  }
  if (reportsMetric === null) {
    throw new Error('Could not read a "Total Patients" metric from any Reports view — selector needs work');
  }
  console.log(`[K12] reports "Total Patients" = ${reportsMetric}`);

  // Expected post-fix: dashboard and reports agree.
  expect(dashboardMetric, `Dashboard vs Reports metric mismatch (dashboard=${dashboardMetric}, reports=${reportsMetric})`).toBe(reportsMetric);
});
