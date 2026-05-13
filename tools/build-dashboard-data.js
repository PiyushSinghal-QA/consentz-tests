#!/usr/bin/env node
/**
 * tools/build-dashboard-data.js
 *
 * Reads:
 *   - Automation/test-results/results.json   (Playwright JSON reporter output)
 *   - bug-severity.json                       (severity assignments + weights)
 *   - dashboard/data/results.json             (PREVIOUS run, for trend deltas)
 *
 * Writes:
 *   - dashboard/data/results.json             (consumed by dashboard/app.js)
 *   - dashboard/data/previous.json            (snapshot of the prior run)
 *   - dashboard/data/screenshots/<id>.png     (copied failure screenshots)
 *   - dashboard/data/history/<stamp>.json     (archived for trend tracking)
 *
 * Run after every test run:
 *   node tools/build-dashboard-data.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PW_RESULTS = path.join(ROOT, 'Automation/test-results/results.json');
const PW_TEST_RESULTS_DIR = path.join(ROOT, 'Automation/test-results');
const BUG_SEVERITY = path.join(ROOT, 'bug-severity.json');
const OUT = path.join(ROOT, 'dashboard/data/results.json');
const PREV_OUT = path.join(ROOT, 'dashboard/data/previous.json');
const TREND_OUT = path.join(ROOT, 'dashboard/data/trend.json');
const ARCHIVE_DIR = path.join(ROOT, 'dashboard/data/history');
const SCREENSHOTS_DIR = path.join(ROOT, 'dashboard/data/screenshots');
const TREND_MAX_POINTS = 30;
// In CI, the previous run + previous trend are downloaded from GH Pages
// before the build script runs (see .github/workflows/dashboard.yml).
// When present, those are the cross-run history; otherwise we fall back
// to local files (works locally where they persist).
const PREV_FROM_CI = path.join(ROOT, 'Automation/.previous-results.json');
const PREV_TREND_FROM_CI = path.join(ROOT, 'Automation/.previous-trend.json');

// Health-formula weights: bug load contributes 60%, test pass rate 40%.
// Modules with zero tests AND zero bugs are N/A (excluded from the overall
// average) — they carry no signal so we don't pretend they're healthy.
const HEALTH_BUG_WEIGHT = 0.6;
const HEALTH_PASS_WEIGHT = 0.4;

// ---- Helpers -----------------------------------------------------------

function moduleFromPath(specPath) {
  const norm = specPath.replace(/\\/g, '/');
  const m = norm.match(/(?:^|tests\/)([^\/]+)\/[^\/]+\.spec\.ts$/);
  if (!m) return 'Other';
  const folder = m[1].toLowerCase();
  // Folder names use kebab/lowercase (filesystem-safe). The display label
  // must match the pinned module list in bug-severity.json EXACTLY — so
  // "setup" maps to "Set Up" (with space), not "Setup". Any folder not
  // listed falls back to title-case so a stray spec folder doesn't error.
  return {
    auth: 'Login',
    patients: 'Patients',
    calendar: 'Calendar',
    dashboard: 'Dashboard',
    website: 'Website',
    marketing: 'Marketing',
    'stock-control': 'Stock Control',
    business: 'Business',
    report: 'Report',
    setup: 'Set Up',
    settings: 'Settings',
    logs: 'Logs',
    help: 'Help',
  }[folder] || cap(folder);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripAnsi(s) {
  return s.replace(/\[[0-9;]*[a-zA-Z]/g, '');
}

/** Blended per-module health: 60% bug-load score + 40% test pass rate.
 *  Returns null (N/A) when the module has 0 tests AND 0 bugs — no signal. */
function computeModuleHealth(bugs, pass, total, weights) {
  const hasTests = total > 0;
  const hasBugs = bugs.length > 0;
  if (!hasTests && !hasBugs) return null;

  const deduction = bugs.reduce((s, b) => s + (weights[b.severity] || 0), 0);
  const bugScore = Math.max(0, 100 - deduction);

  // When a module has bugs but no tests run, fall back to pure bug score.
  if (!hasTests) return Math.round(bugScore);

  const passRate = (pass / total) * 100;
  return Math.round(HEALTH_BUG_WEIGHT * bugScore + HEALTH_PASS_WEIGHT * passRate);
}

function safeFilename(s) {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/** Copy a Playwright attachment into dashboard/data/screenshots/ and return
 *  the dashboard-relative path. Returns null if the source is missing. */
function copyScreenshot(srcAbsPath, testTitle, attachmentName, index) {
  if (!srcAbsPath || !fs.existsSync(srcAbsPath)) return null;
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const ext = path.extname(srcAbsPath) || '.png';
  const stem = safeFilename(`${testTitle}__${attachmentName || 'shot'}__${index}`);
  const destName = `${stem}${ext}`;
  const destAbs = path.join(SCREENSHOTS_DIR, destName);
  try {
    fs.copyFileSync(srcAbsPath, destAbs);
    return `data/screenshots/${destName}`; // relative to dashboard/ root
  } catch (e) {
    console.warn(`[dashboard] Could not copy screenshot ${srcAbsPath}: ${e.message}`);
    return null;
  }
}

/** Resolve a Playwright attachment path to absolute. Playwright writes them
 *  relative to its outputDir (Automation/test-results/) by default. */
function resolveAttachmentPath(rawPath) {
  if (!rawPath) return null;
  const norm = rawPath.replace(/\\/g, '/');
  if (path.isAbsolute(norm)) return norm;
  // Try relative to repo root first, then relative to test-results/.
  const candidates = [
    path.join(ROOT, norm),
    path.join(PW_TEST_RESULTS_DIR, norm),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function flattenTests(suite, accum = [], specPath = null) {
  const currentPath = suite.file || suite.title || specPath;
  for (const sub of suite.suites || []) flattenTests(sub, accum, currentPath);
  for (const spec of suite.specs || []) {
    if (/\.setup\.ts$/.test(spec.file || currentPath || '')) continue;
    for (const t of spec.tests || []) {
      const lastResult = (t.results || [])[t.results.length - 1] || {};
      const imageAttachments = (lastResult.attachments || [])
        .filter((a) => /^image\//.test(a.contentType || ''));
      const copiedAttachments = imageAttachments
        .map((a, i) => {
          const abs = resolveAttachmentPath(a.path);
          const dashPath = copyScreenshot(abs, spec.title, a.name, i);
          return dashPath ? { name: a.name, path: dashPath } : null;
        })
        .filter(Boolean);
      const status = lastResult.status || t.status || 'unknown';
      // Playwright JSON: `t.expectedStatus` is 'failed' for test.fail() specs,
      // 'passed' for everything else. The outcome (expected vs unexpected)
      // is what lets the dashboard split "known bug tripwire firing as
      // designed" from "real regression — should not have failed."
      const expectedStatus = t.expectedStatus || 'passed';
      const outcome = status === expectedStatus ? 'expected' : (status === 'skipped' ? 'skipped' : 'unexpected');
      accum.push({
        title: spec.title,
        file: spec.file || currentPath,
        line: spec.line,
        status,
        expectedStatus,
        outcome,
        durationMs: lastResult.duration || 0,
        retries: (t.results || []).length - 1,
        errors: (lastResult.errors || []).map((e) => stripAnsi(e.message || '').slice(0, 600)),
        attachments: copiedAttachments,
      });
    }
  }
  return accum;
}

/** Read the prior run's summary (overall + per-module pass/fail + bug counts)
 *  for trend comparison. Returns null if no prior data is available. */
function loadPreviousSnapshot() {
  // Prefer CI-fetched snapshot (cross-run via GH Pages), then local
  // dashboard/data/results.json from a prior invocation on this machine.
  for (const src of [PREV_FROM_CI, OUT]) {
    if (fs.existsSync(src)) {
      try {
        const prior = JSON.parse(fs.readFileSync(src, 'utf8'));
        return {
          generatedAt: prior.generatedAt || null,
          overall: prior.overall || null,
          modules: (prior.modules || []).map((m) => ({
            name: m.name,
            pass: m.pass,
            fail: m.fail,
            skipped: m.skipped,
            total: m.total,
          })),
          bugs: (prior.bugs || []).map((b) => ({
            id: b.id,
            severity: b.severity,
            module: b.module,
          })),
        };
      } catch (e) {
        console.warn(`[dashboard] Could not parse previous snapshot at ${src}: ${e.message}`);
      }
    }
  }
  return null;
}

// ---- Main --------------------------------------------------------------

function main() {
  // 1. Snapshot the PREVIOUS run BEFORE we overwrite results.json.
  //    dashboard/data/ is gitignored, so on a fresh CI checkout the dir
  //    doesn't exist yet — create it before any write.
  fs.mkdirSync(path.join(ROOT, 'dashboard/data'), { recursive: true });
  const previous = loadPreviousSnapshot();
  if (previous) fs.writeFileSync(PREV_OUT, JSON.stringify(previous, null, 2));

  // 2. Load Playwright results — tolerate missing/empty
  let pwRaw = null;
  try {
    pwRaw = JSON.parse(fs.readFileSync(PW_RESULTS, 'utf8'));
  } catch (e) {
    console.warn(`[dashboard] No Playwright results at ${PW_RESULTS} (${e.code || e.message}). Generating with empty test data.`);
    pwRaw = { stats: {}, suites: [] };
  }

  // 3. Load bug-severity
  const severity = JSON.parse(fs.readFileSync(BUG_SEVERITY, 'utf8'));

  // 4. Reset screenshots dir for a clean run
  if (fs.existsSync(SCREENSHOTS_DIR)) {
    for (const f of fs.readdirSync(SCREENSHOTS_DIR)) {
      try { fs.unlinkSync(path.join(SCREENSHOTS_DIR, f)); } catch {}
    }
  }

  // 5. Flatten tests (this is also where screenshots get copied)
  const tests = [];
  for (const s of pwRaw.suites || []) flattenTests(s, tests);

  // 6. Group by module
  const byModule = {};
  for (const t of tests) {
    const mod = moduleFromPath(t.file || '');
    byModule[mod] ??= { name: mod, tests: [] };
    byModule[mod].tests.push(t);
  }

  for (const m of severity.modules || []) {
    if (!byModule[m]) byModule[m] = { name: m, tests: [] };
  }
  for (const [, bug] of Object.entries(severity.bugs)) {
    if (!byModule[bug.module]) byModule[bug.module] = { name: bug.module, tests: [] };
  }

  // 7. Compute module-level stats in pinned-nav order
  const pinnedOrder = severity.modules || [];
  const modules = Object.values(byModule).map((m) => {
    const pass = m.tests.filter((t) => t.status === 'passed').length;
    const fail = m.tests.filter((t) => t.status === 'failed').length;
    const skipped = m.tests.filter((t) => t.status === 'skipped').length;
    const total = m.tests.length;
    const bugs = Object.entries(severity.bugs)
      .filter(([, b]) => b.module === m.name)
      .map(([id, b]) => ({ id, ...b }));
    const health = computeModuleHealth(bugs, pass, total, severity.weights);
    return {
      name: m.name,
      pass,
      fail,
      skipped,
      total,
      tests: m.tests,
      bugs,
      health, // null when N/A (no tests + no bugs)
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

  // 8. Overall stats — health is the average of non-N/A module scores so
  //    modules with no signal don't dilute the number.
  const ratedScores = modules.map((m) => m.health).filter((h) => h !== null);
  const overallHealth = ratedScores.length
    ? Math.round(ratedScores.reduce((a, b) => a + b, 0) / ratedScores.length)
    : null;
  // unknownFailures = tests that should have passed but didn't (real regressions).
  // expectedFailures = `test.fail()` tripwires firing as designed (known bugs).
  // tripwireFired = `test.fail()` tests that unexpectedly passed (bugs may be fixed).
  const unknownFailures = tests.filter((t) => t.status === 'failed' && t.outcome === 'unexpected').length;
  const expectedFailures = tests.filter((t) => t.status === 'failed' && t.outcome === 'expected').length;
  const tripwiresFired = tests.filter((t) => t.status === 'passed' && t.expectedStatus === 'failed').length;

  const overall = {
    pass: tests.filter((t) => t.status === 'passed').length,
    fail: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    total: tests.length,
    unknownFailures,
    expectedFailures,
    tripwiresFired,
    durationMs: tests.reduce((s, t) => s + (t.durationMs || 0), 0),
    runStarted: pwRaw.stats?.startTime || null,
    runDuration: pwRaw.stats?.duration || null,
    health: overallHealth,
    ratedModulesCount: ratedScores.length, // how many modules had signal
  };

  // 9. Detect tripwires that fired — a `test.fail()` test that
  //    UNEXPECTEDLY PASSED. The right check is `expectedStatus='failed'
  //    && status='passed'` (the previous regex-on-error check was wrong
  //    because Playwright reports unexpected-pass with status='passed'
  //    and empty errors). Mark the matching bug so the dashboard can
  //    show "🎉 may be fixed" for human review.
  const tripwireFiredBugIds = new Set();
  for (const t of tests) {
    if (!(t.expectedStatus === 'failed' && t.status === 'passed')) continue;
    for (const [id, b] of Object.entries(severity.bugs)) {
      if (b.testName && b.testName === t.title) { tripwireFiredBugIds.add(id); break; }
    }
  }

  // 10. Emit
  const payload = {
    generatedAt: new Date().toISOString(),
    severityConfig: {
      weights: severity.weights,
      thresholds: severity.thresholds,
    },
    overall,
    modules,
    bugs: Object.entries(severity.bugs).map(([id, b]) => ({
      id,
      ...b,
      tripwireFired: tripwireFiredBugIds.has(id),
    })),
    previous: previous ? { generatedAt: previous.generatedAt, overall: previous.overall, bugs: previous.bugs } : null,
  };
  // Mirror the flag into each module's bugs list too so the module card
  // can show a fixed-count.
  for (const m of payload.modules) {
    for (const b of m.bugs) b.tripwireFired = tripwireFiredBugIds.has(b.id);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  // 10. Archive a copy for trend tracking
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}.json`), JSON.stringify(payload, null, 2));

  // 11. Persist the trend series across runs by reading the prior trend.json
  //     (downloaded from GH Pages in CI; local file otherwise), appending
  //     the current run as a new point, and slicing the last TREND_MAX_POINTS.
  //     This is needed because `dashboard/data/history/*.json` is gitignored
  //     and the CI checkout doesn't see prior history.
  const trend = appendToTrend(payload);
  fs.writeFileSync(TREND_OUT, JSON.stringify(trend, null, 2));

  const screenshotCount = fs.existsSync(SCREENSHOTS_DIR) ? fs.readdirSync(SCREENSHOTS_DIR).length : 0;
  console.log(`[dashboard] Wrote ${OUT}`);
  console.log(`[dashboard] Tests: ${overall.pass}/${overall.total} passed, ${overall.fail} failed (${unknownFailures} unknown + ${expectedFailures} known-bug tripwires), ${overall.skipped} skipped, ${tripwiresFired} tripwires fired (may be fixed)`);
  console.log(`[dashboard] Modules: ${modules.map((m) => `${m.name}(${m.pass}/${m.total}, h=${m.health === null ? 'N/A' : m.health})`).join(', ')}`);
  console.log(`[dashboard] Overall health: ${overall.health === null ? 'N/A' : overall.health} (avg of ${overall.ratedModulesCount} rated modules)`);
  console.log(`[dashboard] Bugs: ${payload.bugs.length} across ${new Set(payload.bugs.map((b) => b.module)).size} modules`);
  console.log(`[dashboard] Screenshots copied: ${screenshotCount}`);
  console.log(`[dashboard] Previous-run snapshot: ${previous ? `present (from ${previous.generatedAt})` : 'none'}`);
  console.log(`[dashboard] Trend points: ${trend.points.length} (last ${TREND_MAX_POINTS})`);
  console.log(`[dashboard] Tripwires fired (bug may be fixed): ${tripwireFiredBugIds.size > 0 ? [...tripwireFiredBugIds].join(', ') : 'none'}`);
}

function appendToTrend(payload) {
  // Load prior trend: prefer CI-downloaded, then local. If neither exists,
  // start fresh.
  let prior = { points: [] };
  for (const src of [PREV_TREND_FROM_CI, TREND_OUT]) {
    if (!fs.existsSync(src)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (Array.isArray(data.points)) { prior = data; break; }
    } catch (e) {
      console.warn(`[dashboard] could not parse prior trend at ${src}: ${e.message}`);
    }
  }

  // Build the current run's point
  const bugCounts = { critical: 0, major: 0, minor: 0 };
  for (const b of payload.bugs || []) bugCounts[b.severity] = (bugCounts[b.severity] || 0) + 1;
  const overall = payload.overall || {};
  const passRate = overall.total ? Math.round((overall.pass / overall.total) * 100) : 0;
  const point = {
    generatedAt: payload.generatedAt,
    health: overall.health,
    pass: overall.pass || 0,
    fail: overall.fail || 0,
    skipped: overall.skipped || 0,
    total: overall.total || 0,
    passRate,
    bugs: { total: (payload.bugs || []).length, ...bugCounts },
  };

  // Append, then dedupe by generatedAt (in case the build runs twice with
  // the same timestamp), then keep the last TREND_MAX_POINTS sorted by time.
  const seen = new Set();
  const merged = [...prior.points, point]
    .filter((p) => p && p.generatedAt)
    .filter((p) => {
      if (seen.has(p.generatedAt)) return false;
      seen.add(p.generatedAt);
      return true;
    })
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
    .slice(-TREND_MAX_POINTS);

  return { points: merged };
}

main();
