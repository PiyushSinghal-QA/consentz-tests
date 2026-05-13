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
const ARCHIVE_DIR = path.join(ROOT, 'dashboard/data/history');
const SCREENSHOTS_DIR = path.join(ROOT, 'dashboard/data/screenshots');
// In CI, the previous run is downloaded from GH Pages into this file before
// the build script runs (see .github/workflows/dashboard.yml). When present,
// it's the cross-run "previous"; otherwise we fall back to whatever is in
// dashboard/data/results.json (works locally where the file persists).
const PREV_FROM_CI = path.join(ROOT, 'Automation/.previous-results.json');

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
      accum.push({
        title: spec.title,
        file: spec.file || currentPath,
        line: spec.line,
        status: lastResult.status || t.status || 'unknown',
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
  // 1. Snapshot the PREVIOUS run BEFORE we overwrite results.json
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

  // 8. Overall stats
  const overall = {
    pass: tests.filter((t) => t.status === 'passed').length,
    fail: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    total: tests.length,
    durationMs: tests.reduce((s, t) => s + (t.durationMs || 0), 0),
    runStarted: pwRaw.stats?.startTime || null,
    runDuration: pwRaw.stats?.duration || null,
  };

  // 9. Emit
  const payload = {
    generatedAt: new Date().toISOString(),
    severityConfig: {
      weights: severity.weights,
      thresholds: severity.thresholds,
    },
    overall,
    modules,
    bugs: Object.entries(severity.bugs).map(([id, b]) => ({ id, ...b })),
    previous: previous ? { generatedAt: previous.generatedAt, overall: previous.overall, bugs: previous.bugs } : null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  // 10. Archive a copy for trend tracking
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${stamp}.json`), JSON.stringify(payload, null, 2));

  const screenshotCount = fs.existsSync(SCREENSHOTS_DIR) ? fs.readdirSync(SCREENSHOTS_DIR).length : 0;
  console.log(`[dashboard] Wrote ${OUT}`);
  console.log(`[dashboard] Tests: ${overall.pass}/${overall.total} passed, ${overall.fail} failed, ${overall.skipped} skipped`);
  console.log(`[dashboard] Modules: ${modules.map((m) => `${m.name}(${m.pass}/${m.total})`).join(', ')}`);
  console.log(`[dashboard] Bugs: ${payload.bugs.length} across ${new Set(payload.bugs.map((b) => b.module)).size} modules`);
  console.log(`[dashboard] Screenshots copied: ${screenshotCount}`);
  console.log(`[dashboard] Previous-run snapshot: ${previous ? `present (from ${previous.generatedAt})` : 'none'}`);
}

main();
