#!/usr/bin/env node
/**
 * tools/send-to-sentry.js
 *
 * Reads the in-flight dashboard payload (from build-dashboard-data.js) and
 * dispatches every failure / fired-tripwire to our Sentry project so the
 * dashboard can deep-link to Sentry's AI Suggested Fix per issue.
 *
 * Design guarantees (added 2026-05-15 after a CI run silently failed):
 *  - EVERY failure that we'd want to surface gets a `sentryIssueUrl`
 *    attached, even if the Sentry SDK init/captureEvent throws. The
 *    fallback URL is a Sentry search query on a tag we always set, so the
 *    deep link works the first time the user clicks it even before the
 *    real event ID is known.
 *  - SDK errors are caught per-event so one bad event can't poison the
 *    whole batch.
 *  - Logs are verbose by default — CI workflow output is the only place
 *    we'll see what happened, so we leave breadcrumbs.
 *
 * Env:
 *   SENTRY_DSN          required for live send. Without it, the script
 *                       runs in stub mode (URLs still attached, but they
 *                       point at the fingerprint-search fallback).
 *   SENTRY_ORG_SLUG     defaults to 'piyush-singhal'.
 *   SENTRY_PROJECT_ID   defaults to '4511393188085760'.
 *   GIT_SHA, GIT_BRANCH used as event tags.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FINGERPRINT_CACHE = path.join(ROOT, 'dashboard/data/sentry-fingerprints.json');
const SCREENSHOTS_DIR = path.join(ROOT, 'dashboard/data/screenshots');
const BUGS_MD = path.join(ROOT, 'BUGS.md');
const DEFAULT_ORG_SLUG = 'piyush-singhal';
const DEFAULT_PROJECT_ID = '4511393188085760';
const FINGERPRINT_TAG = 'consentz_fingerprint';

// ---- BUGS.md parser ----------------------------------------------------
// One-shot parse per build. We pull the human-written description, page/
// feature, severity, surfacing-test ref, and triage-notes paragraph for
// each K-bug so the Sentry event has the same context a human triager
// would read.

let _bugCatalogCache = null;
function loadBugCatalog() {
  if (_bugCatalogCache) return _bugCatalogCache;
  if (!fs.existsSync(BUGS_MD)) { _bugCatalogCache = {}; return _bugCatalogCache; }
  const src = fs.readFileSync(BUGS_MD, 'utf8');
  const catalog = {};

  // Open-defects table rows look like:
  //   | **K1**  | Logs › Blockers | ... | Major | `TC.SMOKE.001.050` |
  for (const line of src.split('\n')) {
    const idMatch = line.match(/^\|\s*\*\*(K\d+)\*\*\s*\|/);
    if (!idMatch) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 5) continue;
    catalog[idMatch[1]] = {
      pageFeature: cells[1],
      description: cells[2],
      severity: cells[3].replace(/\*\*/g, '').trim().toLowerCase(),
      surfacedBy: cells[4],
      triageNotes: '',
    };
  }

  // Triage notes block — paragraphs like "**K21 (Critical).** Surfaces a 500 ..."
  // Each paragraph belongs to the K-bug whose ID opens it.
  const notesIdx = src.indexOf('## Triage notes');
  if (notesIdx >= 0) {
    const notesEnd = src.indexOf('\n## ', notesIdx + 1);
    const notes = src.slice(notesIdx, notesEnd > 0 ? notesEnd : undefined);
    const re = /\*\*\s*(K\d+)\b[^*]*\*\*\s*([\s\S]*?)(?=\n\*\*\s*K\d+|\n## |\n---|\n$|$)/g;
    let m;
    while ((m = re.exec(notes))) {
      if (catalog[m[1]]) catalog[m[1]].triageNotes = m[2].trim();
    }
  }

  _bugCatalogCache = catalog;
  return catalog;
}

function bugIdFromTest(test) {
  if (test.bugId) return test.bugId;
  const m = (test.title || '').match(/^\[\s*(K\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Heuristic for which dev-code area is implicated. Helps Sentry's AI focus
 *  its fix suggestion even though it can't see the PHP source directly. */
function devCodeHintFor(bugId, pageFeature) {
  if (!bugId && !pageFeature) return null;
  const pf = (pageFeature || '').toLowerCase();
  if (/patient/.test(pf)) return 'Symfony backend (Patient controller / validator) + Patient search index';
  if (/calendar|booking|appointment/.test(pf)) return 'Symfony backend (Appointment controller) + FullCalendar JS bindings';
  if (/dashboard.*widget|widget.*library|widget.*render/.test(pf)) return 'Frontend (widget library + dashboard render pipeline)';
  if (/dashboard.*clinic.*switch|clinic switch/.test(pf)) return 'Frontend (clinic-switch lifecycle / jQuery plugin teardown)';
  if (/dashboard.*topbar|brand logo/.test(pf)) return 'Frontend (topbar component, logo anchor binding)';
  if (/marketing.*template|marketing.*ads/.test(pf)) return 'Backend asset paths + uploads dir';
  if (/report/.test(pf)) return 'Reports controller + custom-reports asset manifest';
  if (/t&c|set up|terms|conditions/.test(pf)) return 'Bundle assets (CKEditor) + Set Up T&C controller';
  if (/logs.*blockers/.test(pf)) return 'Symfony backend (clinic blockers controller — null-safety on clinic load)';
  if (/settings.*subscription/.test(pf)) return 'Subscription module (routing + payment-method delete confirmation)';
  return null;
}

// ---- Cache: fingerprint -> { issueUrl, firstSentAt, eventId? } ---------

function loadCache() {
  try {
    if (fs.existsSync(FINGERPRINT_CACHE)) {
      return JSON.parse(fs.readFileSync(FINGERPRINT_CACHE, 'utf8'));
    }
  } catch (e) {
    console.warn(`[sentry] cache parse error: ${e.message}`);
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(FINGERPRINT_CACHE), { recursive: true });
    fs.writeFileSync(FINGERPRINT_CACHE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn(`[sentry] cache write error: ${e.message}`);
  }
}

/** Stable per-failure identity. (title × first-error-line) so the same
 *  regression on every run yields the same fingerprint → Sentry groups
 *  the events and our cache dedups. */
function fingerprintFor(test) {
  const title = test.title || '';
  const firstErr = (test.errors || [])[0] || '';
  const errStable = stripDynamic(firstErr);
  const seed = `${title}\n${errStable}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function stripDynamic(s) {
  return String(s || '')
    .replace(/\b\d{13,}\b/g, '<ts>')
    .replace(/\b[a-f0-9]{16,}\b/gi, '<hash>')
    .replace(/Timeout\s+\d+ms/gi, 'Timeout <ms>')
    .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<ip>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** Predicate: which failures we surface in Sentry. EVERY failed test plus
 *  every tripwire-fired pass — known-bug tripwires firing as designed are
 *  included too so the dashboard CTA is consistent across all failure
 *  cards. Fingerprint dedup keeps the event volume tiny (each unique
 *  failure sent once, cached after). */
function shouldSend(test) {
  return test.status === 'failed'
      || (test.status === 'passed' && test.expectedStatus === 'failed');
}

/** Universal fallback URL: a Sentry search on the fingerprint tag we
 *  attach to every event. Works the moment we send our first event with
 *  the tag — and the URL is computable synchronously without a network
 *  round trip, so we can populate `sentryIssueUrl` before the SDK init
 *  even runs. */
function fallbackUrlFor(fp, orgSlug, projectId) {
  const q = encodeURIComponent(`${FINGERPRINT_TAG}:${fp}`);
  return `https://${orgSlug}.sentry.io/issues/?query=${q}&project=${projectId}`;
}

function buildEvent(test, opts) {
  const isUnexpectedPass = test.status === 'passed' && test.expectedStatus === 'failed';
  const firstErr = (test.errors || [])[0] || '';
  const bugId = bugIdFromTest(test);
  const catalog = loadBugCatalog();
  const bug = bugId && catalog[bugId];

  // Title format: "[K21 · CRITICAL] Add Patient — firstName ≥46 chars returns
  // HTTP 500 (Patients › Add Patient)" — so the Sentry feed list shows the
  // K-ID, severity, what's broken, and where, all in one line.
  const severity = (test.aiAnalysis && test.aiAnalysis.severity) || (bug && bug.severity) || 'major';
  const titleBase = bug
    ? bug.description.replace(/`[^`]+`/g, (m) => m.slice(1, -1)).slice(0, 140)
    : test.title;
  const tag = isUnexpectedPass ? 'TRIPWIRE FIRED' : bug ? `${bugId} · ${severity.toUpperCase()}` : 'UNKNOWN';
  const place = bug ? ` (${bug.pageFeature})` : '';
  const summary = `[${tag}] ${titleBase}${place}`;

  // Source snippet around the failing line — Sentry's AI can use this to
  // reason about test-side issues (selector drift, timeout boundaries, etc).
  let sourceSnippet = '';
  try {
    const specPath = resolveSpecPath(test.file);
    if (specPath && fs.existsSync(specPath)) {
      const src = fs.readFileSync(specPath, 'utf8').split('\n');
      const line = test.line || 1;
      const from = Math.max(0, line - 5);
      const to = Math.min(src.length, line + 15);
      sourceSnippet = src.slice(from, to).map((l, i) => `${(from + i + 1).toString().padStart(4)}  ${l}`).join('\n');
    }
  } catch {}

  // Single, unified description that gives Sentry's AI everything a human
  // triager would read.
  const devCodeHint = devCodeHintFor(bugId, bug && bug.pageFeature);
  const triageBlock = [
    bug ? `# Known bug ${bugId} — ${bug.severity.toUpperCase()}` : `# Failure (no K-bug catalogue entry)`,
    bug && `**Where:** ${bug.pageFeature}`,
    bug && `**Description:**\n${bug.description}`,
    bug && bug.surfacedBy && `**Surfaced by:** ${bug.surfacedBy}`,
    bug && bug.triageNotes && `**Triage notes:**\n${bug.triageNotes}`,
    devCodeHint && `**Likely dev-code area:** ${devCodeHint}`,
    test.aiAnalysis && test.aiAnalysis.rootCause && `**Heuristic root-cause:** ${test.aiAnalysis.rootCause}`,
    test.aiAnalysis && test.aiAnalysis.suggestedFix && `**Heuristic suggested fix:**\n${test.aiAnalysis.suggestedFix}`,
    isUnexpectedPass && `**⚠ Tripwire fired:** this test was expected to fail (it's a known-bug tripwire) but unexpectedly passed. The bug may be fixed — verify on the target environment before removing from the catalogue.`,
  ].filter(Boolean).join('\n\n');

  return {
    message: summary,
    level: severityToLevel(severity),
    tags: {
      [FINGERPRINT_TAG]: test.__fp,
      bug_id: bugId || 'none',
      bug_module: test.module || 'unknown',
      severity,
      outcome: test.outcome || 'unknown',
      is_unexpected_pass: String(isUnexpectedPass),
      is_known_bug: bug ? 'true' : 'false',
      page_feature: (bug && bug.pageFeature) || 'unknown',
      dev_code_area: devCodeHint || 'unknown',
      manual_tc: (bug && bug.surfacedBy) || 'none',
      test_file: test.file || '',
      env: opts.env || process.env.BASE_URL || 'unknown',
      git_sha: process.env.GIT_SHA || 'unknown',
      git_branch: process.env.GIT_BRANCH || 'unknown',
    },
    extra: {
      triageReport: triageBlock,
      testTitle: test.title,
      firstError: firstErr.slice(0, 4000),
      specSourceSnippet: sourceSnippet || '(spec source unavailable)',
      reproStepsList: (test.aiAnalysis && test.aiAnalysis.reproSteps) || [],
      attachmentsOnDashboard: (test.attachments || []).map((a) => a.path),
      ciRun: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    },
    fingerprint: [test.__fp, test.title || 'no-title'],
  };
}

function severityToLevel(sev) {
  switch (sev) {
    case 'critical': return 'fatal';
    case 'major':    return 'error';
    case 'minor':    return 'warning';
    default:         return 'error';
  }
}

function resolveSpecPath(file) {
  if (!file) return null;
  const norm = file.replace(/\\/g, '/');
  if (path.isAbsolute(norm)) return norm;
  const candidates = [
    path.join(ROOT, 'Automation', norm),
    path.join(ROOT, 'Automation/tests', norm.replace(/^tests\//, '')),
    path.join(ROOT, norm),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

// ---- Main entry --------------------------------------------------------

/**
 * Walk the test records, attach `sentryIssueUrl` (and fingerprint) to every
 * candidate. Best effort — if Sentry can't be reached we still get the
 * fallback URL on every record, so the dashboard always has something to
 * link to.
 */
async function enrichFailuresWithSentry(tests, opts = {}) {
  const dsn = opts.dsn || process.env.SENTRY_DSN;
  const orgSlug = opts.orgSlug || process.env.SENTRY_ORG_SLUG || DEFAULT_ORG_SLUG;
  const projectId = opts.projectId || process.env.SENTRY_PROJECT_ID || DEFAULT_PROJECT_ID;
  const log = opts.log || console.log.bind(console);
  const dsnPresent = Boolean(dsn);

  log(`[sentry] enrichment starting · DSN ${dsnPresent ? 'present' : 'MISSING (stub mode)'} · org=${orgSlug} · project=${projectId}`);

  const toSend = tests.filter(shouldSend);
  if (toSend.length === 0) {
    log('[sentry] no failures to surface (nothing matched shouldSend).');
    return { sent: 0, cached: 0, attempted: 0, skipped: 0, mode: dsnPresent ? 'live' : 'stub' };
  }
  log(`[sentry] ${toSend.length} candidate failure(s) → will attach URLs to every one`);

  const cache = loadCache();
  let sent = 0, cached = 0, attempted = 0, skipped = 0;

  // ---- STEP 1: attach a URL to every candidate, synchronously. ----
  // Either from cache (we've seen this fingerprint before) or from the
  // fallback search-by-tag URL. This guarantees the dashboard never has
  // a failure without a Sentry link, even if the SDK is broken.
  //
  // sentrySent = true means we've actually dispatched a real Sentry event
  // for this fingerprint at some point (so the fallback search will land
  // on real data). false means the URL is purely a placeholder and the
  // dashboard should label it as "pending."
  for (const t of toSend) {
    const fp = fingerprintFor(t);
    t.__fp = fp;
    t.sentryFingerprint = fp;
    if (cache[fp] && cache[fp].issueUrl && !cache[fp].stub) {
      t.sentryIssueUrl = cache[fp].issueUrl;
      t.sentrySent = true;
      cached++;
    } else {
      t.sentryIssueUrl = fallbackUrlFor(fp, orgSlug, projectId);
      t.sentrySent = false;
    }
  }
  log(`[sentry] step 1 done — ${cached} URLs from cache, ${toSend.length - cached} fallback URLs`);

  // ---- STEP 2: if no DSN, we stop here. ----
  // Fallback URLs are already attached; the dashboard renders them as
  // "Search Sentry" links until a real DSN-equipped run upgrades them.
  if (!dsnPresent) {
    log(`[sentry] stub mode: kept ${toSend.length} fallback URLs. Set SENTRY_DSN to send real events.`);
    saveCache(cache);
    return { sent: 0, cached, attempted: 0, skipped: 0, mode: 'stub' };
  }

  // ---- STEP 3: actually send the new events. ----
  // Wrap init in try/catch — if Sentry can't init for ANY reason (bad DSN,
  // network), we keep the fallback URLs and report the failure clearly.
  // @sentry/node is installed in Automation/node_modules — this script
  // lives in tools/ which Node's resolution algorithm doesn't link to.
  // require.resolve with an explicit paths list searches the places we
  // know the SDK might land (Automation deps first, then any local
  // tools/node_modules or root node_modules) so we don't depend on
  // working-directory being any particular thing.
  let Sentry;
  try {
    const sentryEntry = require.resolve('@sentry/node', {
      paths: [
        path.join(ROOT, 'Automation', 'node_modules'),
        path.join(ROOT, 'node_modules'),
        path.join(__dirname, 'node_modules'),
      ],
    });
    Sentry = require(sentryEntry);
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      autoSessionTracking: false,
      debug: false,
      environment: opts.env || process.env.BASE_URL || 'staging',
      release: process.env.GIT_SHA || undefined,
    });
    log(`[sentry] SDK initialised (loaded from ${path.relative(ROOT, sentryEntry)})`);
  } catch (e) {
    log(`[sentry] SDK init failed — keeping fallback URLs: ${e.message}`);
    saveCache(cache);
    return { sent: 0, cached, attempted: 0, skipped: toSend.length, mode: 'init-failed' };
  }

  for (const t of toSend) {
    const fp = t.__fp;
    if (cache[fp] && cache[fp].issueUrl && !cache[fp].stub) continue; // already have a real URL

    attempted++;
    try {
      const evt = buildEvent(t, opts);

      // Wrap each event in its own scope so attachments + breadcrumbs we set
      // don't leak across iterations.
      const eventId = Sentry.withScope((scope) => {
        // Each repro step becomes a breadcrumb — Sentry's UI then shows a
        // numbered timeline of "what the test did" leading up to the error.
        const steps = (t.aiAnalysis && t.aiAnalysis.reproSteps) || [];
        steps.forEach((step, i) => {
          scope.addBreadcrumb({
            category: 'repro',
            type: 'navigation',
            message: `Step ${i + 1}: ${step}`,
            level: 'info',
            timestamp: Date.now() / 1000 - (steps.length - i),
          });
        });

        // Attach the failure screenshot if Playwright saved one. Sentry
        // shows attachments inline on the issue page — way better than a
        // path string the triager has to chase.
        for (const a of t.attachments || []) {
          const absPath = path.isAbsolute(a.path)
            ? a.path
            : path.join(ROOT, 'dashboard', a.path);
          if (fs.existsSync(absPath)) {
            try {
              scope.addAttachment({
                filename: path.basename(absPath),
                data: fs.readFileSync(absPath),
                contentType: 'image/png',
              });
            } catch (attachErr) {
              log(`[sentry] attachment skipped (${absPath}): ${attachErr.message}`);
            }
          }
        }

        return Sentry.captureEvent(evt);
      });

      if (!eventId) {
        log(`[sentry] captureEvent returned no id for "${t.title.slice(0, 60)}" — keeping fallback URL`);
        skipped++;
        continue;
      }
      // Upgrade the fallback URL to the actual event/issue search URL.
      const realUrl = `https://${orgSlug}.sentry.io/issues/?query=${encodeURIComponent(`event.id:${eventId}`)}&project=${projectId}`;
      t.sentryIssueUrl = realUrl;
      t.sentrySent = true;
      cache[fp] = { issueUrl: realUrl, firstSentAt: new Date().toISOString(), eventId, lastTitle: t.title };
      sent++;
    } catch (e) {
      log(`[sentry] captureEvent error on "${t.title.slice(0, 60)}": ${e.message} — keeping fallback URL`);
      skipped++;
    }
  }

  // Always flush so events leave the runner before exit.
  try {
    const flushed = await Sentry.close(5000);
    log(`[sentry] flush ${flushed ? 'succeeded' : 'timed out (events may be lost)'}`);
  } catch (e) {
    log(`[sentry] flush threw: ${e.message}`);
  }

  saveCache(cache);
  log(`[sentry] done — ${sent} new sent, ${cached} cached, ${skipped} skipped, ${toSend.length} total candidates`);
  return { sent, cached, attempted, skipped, mode: 'live' };
}

module.exports = { enrichFailuresWithSentry, fingerprintFor, shouldSend, fallbackUrlFor };

// CLI helper.
if (require.main === module) {
  const input = process.argv[2] || path.join(ROOT, 'dashboard/data/results.json');
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const tests = [];
  for (const m of data.modules || []) for (const t of m.tests || []) tests.push({ ...t, module: m.name });
  enrichFailuresWithSentry(tests, { log: console.log }).then((r) => {
    console.log('\nSummary:', r);
    for (const t of tests) {
      if (t.sentryIssueUrl) console.log(`  ${t.title.slice(0, 80)}\n    → ${t.sentryIssueUrl}`);
    }
  });
}
