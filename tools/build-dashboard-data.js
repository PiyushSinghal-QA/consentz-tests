#!/usr/bin/env node
/**
 * tools/build-dashboard-data.js
 *
 * Reads:
 *   - Automation/test-results/results.json   (Playwright JSON reporter output)
 *   - bug-severity.json                       (severity assignments + weights)
 *
 * Writes:
 *   - dashboard/data/results.json             (consumed by dashboard/app.js)
 *
 * Run after every test run:
 *   node tools/build-dashboard-data.js
 *
 * The dashboard frontend (dashboard/index.html) fetches the output JSON and
 * renders everything client-side, so the script is the only piece of
 * pipeline. No backend, no database.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PW_RESULTS = path.join(ROOT, 'Automation/test-results/results.json');
const BUG_SEVERITY = path.join(ROOT, 'bug-severity.json');
const OUT = path.join(ROOT, 'dashboard/data/results.json');
const ARCHIVE_DIR = path.join(ROOT, 'dashboard/data/history');

// ---- Helpers -----------------------------------------------------------

/** Map a spec file path to a module name.
 *  e.g. "tests/patients/patients-search.spec.ts" → "Patients"
 *       "tests/calendar/calendar-booking.spec.ts" → "Calendar"
 *       "tests/auth/login.spec.ts"                → "Login"
 *       "tests/dashboard/dashboard.spec.ts"       → "Dashboard"
 */
function moduleFromPath(specPath) {
  const norm = specPath.replace(/\\/g, '/');
  // Playwright JSON paths can be either "tests/<folder>/foo.spec.ts" OR
  // "<folder>/foo.spec.ts" (the `tests/` prefix is stripped by the JSON
  // reporter on some runs). Match both shapes.
  const m = norm.match(/(?:^|tests\/)([^\/]+)\/[^\/]+\.spec\.ts$/);
  if (!m) return 'Other';
  const folder = m[1].toLowerCase();
  return {
    auth: 'Login',
    patients: 'Patients',
    calendar: 'Calendar',
    dashboard: 'Dashboard',
  }[folder] || cap(folder);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Walk the Playwright JSON tree (suites contain suites contain specs contain tests). */
function flattenTests(suite, accum = [], specPath = null) {
  const currentPath = suite.file || suite.title || specPath;
  for (const sub of suite.suites || []) flattenTests(sub, accum, currentPath);
  for (const spec of suite.specs || []) {
    // Skip Playwright `*.setup.ts` projects — they're auth bootstrap, not tests
    if (/\.setup\.ts$/.test(spec.file || currentPath || '')) continue;
    for (const t of spec.tests || []) {
      const lastResult = (t.results || [])[t.results.length - 1] || {};
      accum.push({
        title: spec.title,
        file: spec.file || currentPath,
        line: spec.line,
        status: lastResult.status || t.status || 'unknown',
        durationMs: lastResult.duration || 0,
        retries: (t.results || []).length - 1,
        errors: (lastResult.errors || []).map((e) => stripAnsi(e.message || '').slice(0, 600)),
        attachments: (lastResult.attachments || [])
          .filter((a) => /^image\//.test(a.contentType || ''))
          .map((a) => ({
            name: a.name,
            // Relative path from project root if Playwright wrote it that way;
            // else keep the absolute one and let the dashboard decide.
            path: (a.path || '').replace(/\\/g, '/'),
          })),
      });
    }
  }
  return accum;
}

function stripAnsi(s) {
  return s.replace(/\[[0-9;]*[a-zA-Z]/g, '');
}

// ---- Main --------------------------------------------------------------

function main() {
  // 1. Load Playwright results — tolerate missing/empty
  let pwRaw = null;
  try {
    pwRaw = JSON.parse(fs.readFileSync(PW_RESULTS, 'utf8'));
  } catch (e) {
    console.warn(`[dashboard] No Playwright results at ${PW_RESULTS} (${e.code || e.message}). Generating with empty test data.`);
    pwRaw = { stats: {}, suites: [] };
  }

  // 2. Load bug-severity
  const severity = JSON.parse(fs.readFileSync(BUG_SEVERITY, 'utf8'));

  // 3. Flatten tests
  const tests = [];
  for (const s of pwRaw.suites || []) flattenTests(s, tests);

  // 4. Group by module
  const byModule = {};
  for (const t of tests) {
    const mod = moduleFromPath(t.file || '');
    byModule[mod] ??= { name: mod, tests: [] };
    byModule[mod].tests.push(t);
  }

  // 5. Pinned modules from bug-severity.modules always appear, even with
  //    0 tests / 0 bugs. Also create modules from any bug's `module` field.
  for (const m of severity.modules || []) {
    if (!byModule[m]) byModule[m] = { name: m, tests: [] };
  }
  for (const [bugId, bug] of Object.entries(severity.bugs)) {
    if (!byModule[bug.module]) byModule[bug.module] = { name: bug.module, tests: [] };
  }

  // 6. Compute module-level stats. Preserve pinned-list order so the dashboard
  //    grid matches the user's mental nav order (Login, Dashboard, Calendar, …)
  //    instead of alphabetising it.
  const pinnedOrder = severity.modules || [];
  const modules = Object.values(byModule).map((m) => {
    const pass = m.tests.filter((t) => t.status === 'passed').length;
    const fail = m.tests.filter((t) => t.status === 'failed').length;
    const skipped = m.tests.filter((t) => t.status === 'skipped').length;
    const bugs = Object.entries(severity.bugs)
      .filter(([, b]) => b.module === m.name)
      .map(([id, b]) => ({ id, ...b }));
    return {
      name: m.name,
      pass,
      fail,
      skipped,
      total: m.tests.length,
      tests: m.tests,
      bugs,
    };
  });
  modules.sort((a, b) => {
    const ai = pinnedOrder.indexOf(a.name);
    const bi = pinnedOrder.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // 7. Overall stats
  const overall = {
    pass: tests.filter((t) => t.status === 'passed').length,
    fail: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    total: tests.length,
    durationMs: tests.reduce((s, t) => s + (t.durationMs || 0), 0),
    runStarted: pwRaw.stats?.startTime || null,
    runDuration: pwRaw.stats?.duration || null,
  };

  // 8. Emit
  const payload = {
    generatedAt: new Date().toISOString(),
    severityConfig: {
      weights: severity.weights,
      thresholds: severity.thresholds,
    },
    overall,
    modules,
    bugs: Object.entries(severity.bugs).map(([id, b]) => ({ id, ...b })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  // 9. Archive a copy for trend tracking
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}.json`), JSON.stringify(payload, null, 2));

  console.log(`[dashboard] Wrote ${OUT}`);
  console.log(`[dashboard] Tests: ${overall.pass}/${overall.total} passed, ${overall.fail} failed, ${overall.skipped} skipped`);
  console.log(`[dashboard] Modules: ${modules.map((m) => `${m.name}(${m.pass}/${m.total})`).join(', ')}`);
  console.log(`[dashboard] Bugs: ${payload.bugs.length} across ${new Set(payload.bugs.map((b) => b.module)).size} modules`);
}

main();
