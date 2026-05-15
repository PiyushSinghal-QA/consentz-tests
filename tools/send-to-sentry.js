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
const DEFAULT_ORG_SLUG = 'piyush-singhal';
const DEFAULT_PROJECT_ID = '4511393188085760';
const FINGERPRINT_TAG = 'consentz_fingerprint';

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
  const summary = isUnexpectedPass
    ? `[tripwire fired — bug may be fixed] ${test.title}`
    : test.title;

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

  return {
    message: summary,
    level: severityToLevel(test.aiAnalysis && test.aiAnalysis.severity),
    tags: {
      [FINGERPRINT_TAG]: test.__fp,
      module: test.module || 'unknown',
      test_file: test.file || '',
      outcome: test.outcome || 'unknown',
      is_unexpected_pass: String(isUnexpectedPass),
      bug_id: test.bugId || 'none',
      env: opts.env || process.env.BASE_URL || 'unknown',
      git_sha: process.env.GIT_SHA || 'unknown',
      git_branch: process.env.GIT_BRANCH || 'unknown',
    },
    extra: {
      firstError: firstErr.slice(0, 4000),
      sourceSnippet: sourceSnippet || '(spec source unavailable)',
      reproSteps: test.aiAnalysis && test.aiAnalysis.reproSteps,
      rootCause: test.aiAnalysis && test.aiAnalysis.rootCause,
      suggestedFix: test.aiAnalysis && test.aiAnalysis.suggestedFix,
      attachments: (test.attachments || []).map((a) => a.path),
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
  let Sentry;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      autoSessionTracking: false,
      debug: false,
      environment: opts.env || process.env.BASE_URL || 'staging',
      release: process.env.GIT_SHA || undefined,
    });
    log('[sentry] SDK initialised');
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
      const eventId = Sentry.captureEvent(evt);
      if (!eventId) {
        log(`[sentry] captureEvent returned no id for "${t.title.slice(0, 60)}" — keeping fallback URL`);
        skipped++;
        continue;
      }
      // Upgrade the fallback URL to the actual event/issue search URL.
      // We use search-by-event-id rather than direct /issues/<id>/ because
      // event-id and issue-id are different in Sentry; the search URL is
      // robust against that distinction.
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
