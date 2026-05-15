#!/usr/bin/env node
/**
 * tools/send-to-sentry.js
 *
 * Reads the in-flight dashboard payload (from build-dashboard-data.js) and
 * dispatches each Unknown failure + each "may be fixed" tripwire to our
 * Sentry project. Returns the issue URL per event and caches it locally
 * (via fingerprint) so we never send the same failure twice.
 *
 * Why: Sentry's Suggested Fix / Autofix work on top of stack traces +
 * source context. We send rich events (test source snippet, error stack,
 * tags, attachments) so their AI can analyse usefully and we get a per-bug
 * actionable fix URL on the dashboard.
 *
 * Env:
 *   SENTRY_DSN          required to actually transmit. Without it, the
 *                       script enters stub mode — captures every event to
 *                       a local log, never network calls. Lets us develop
 *                       and run CI without the secret while the team
 *                       finishes Sentry setup.
 *   SENTRY_ORG_SLUG     used to build the human-readable issue URL.
 *                       Defaults to 'piyush-singhal'.
 *   SENTRY_PROJECT_ID   ditto. Defaults to '4511393188085760'.
 *   GIT_SHA, GIT_BRANCH used as event tags. Workflow injects them.
 *
 * Module entry:
 *   const { enrichFailuresWithSentry } = require('./send-to-sentry');
 *   await enrichFailuresWithSentry(tests, opts);
 *   // mutates each failing test to attach `t.sentryIssueUrl`
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FINGERPRINT_CACHE = path.join(ROOT, 'dashboard/data/sentry-fingerprints.json');
const DEFAULT_ORG_SLUG = 'piyush-singhal';
const DEFAULT_PROJECT_ID = '4511393188085760';

// ---- Cache: fingerprint -> { issueUrl, firstSentAt } -------------------

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
  fs.mkdirSync(path.dirname(FINGERPRINT_CACHE), { recursive: true });
  fs.writeFileSync(FINGERPRINT_CACHE, JSON.stringify(cache, null, 2));
}

/** Stable per-failure identity. Same (test title × first-error-line) on
 *  every run yields the same fingerprint so Sentry groups them and our
 *  cache dedups. */
function fingerprintFor(test) {
  const title = test.title || '';
  const firstErr = (test.errors || [])[0] || '';
  const errStable = stripDynamic(firstErr);
  const seed = `${title}\n${errStable}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

/** Strip the volatile bits from error messages (timestamps, random IDs,
 *  millisecond timeouts that drift) so fingerprints stay stable run-to-run. */
function stripDynamic(s) {
  return String(s || '')
    .replace(/\b\d{13,}\b/g, '<ts>')             // unix-ms timestamps
    .replace(/\b[a-f0-9]{16,}\b/gi, '<hash>')    // hex hashes / uuids
    .replace(/Timeout\s+\d+ms/gi, 'Timeout <ms>') // timeout values
    .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<ip>')   // IPs
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** Predicate: which failures we send to Sentry. UNKNOWN regressions and
 *  unexpectedly-passing tripwires. We deliberately skip expected-failure
 *  tripwires (known K-bugs failing as designed) — Sentry's AI doesn't add
 *  value there; our K-bug catalogue already covers them. */
function shouldSend(test) {
  return (test.status === 'failed' && test.outcome === 'unexpected')
      || (test.status === 'passed' && test.expectedStatus === 'failed');
}

/** Build the Sentry event payload from a test record. Rich context = better
 *  AI analysis. */
function buildEvent(test, opts) {
  const isUnexpectedPass = test.status === 'passed' && test.expectedStatus === 'failed';
  const firstErr = (test.errors || [])[0] || '';
  const summary = isUnexpectedPass
    ? `[tripwire fired — bug may be fixed] ${test.title}`
    : test.title;

  // Read the spec file so Sentry has source context for the AI. Best-effort.
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
      module: test.module || 'unknown',
      test_file: test.file || '',
      outcome: test.outcome || 'unknown',
      is_unexpected_pass: String(isUnexpectedPass),
      bug_id: test.bugId || 'none',
      env: opts.env || process.env.BASE_URL || 'unknown',
    },
    extras: {
      firstError: firstErr.slice(0, 4000),
      sourceSnippet: sourceSnippet || '(spec source unavailable)',
      reproSteps: test.aiAnalysis && test.aiAnalysis.reproSteps,
      rootCause: test.aiAnalysis && test.aiAnalysis.rootCause,
      suggestedFix: test.aiAnalysis && test.aiAnalysis.suggestedFix,
      attachments: (test.attachments || []).map((a) => a.path),
    },
    fingerprint: [fingerprintFor(test), test.title || 'no-title'],
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

function issueUrlForEventId(eventId, orgSlug, projectId) {
  // Sentry's deep-link to the issue (which they auto-create from the event
  // grouped by fingerprint). The /issues/?query=id:... form is robust across
  // org configs and avoids guessing the project slug.
  return `https://${orgSlug}.sentry.io/issues/?query=id%3A${eventId}&project=${projectId}`;
}

// ---- Main entry --------------------------------------------------------

/**
 * Walk a list of test records, send the ones that need analysis to Sentry,
 * and mutate each in place to attach `sentryIssueUrl`.
 *
 * @param {Array<object>} tests  Flattened test records (from build script).
 * @param {object} opts          { dsn?, orgSlug?, projectId?, env?, log? }
 */
async function enrichFailuresWithSentry(tests, opts = {}) {
  const dsn = opts.dsn || process.env.SENTRY_DSN;
  const orgSlug = opts.orgSlug || process.env.SENTRY_ORG_SLUG || DEFAULT_ORG_SLUG;
  const projectId = opts.projectId || process.env.SENTRY_PROJECT_ID || DEFAULT_PROJECT_ID;
  const log = opts.log || console.log.bind(console);

  const toSend = tests.filter(shouldSend);
  if (toSend.length === 0) {
    log('[sentry] no failures to send (no unknowns + no fired tripwires).');
    return { sent: 0, cached: 0, skipped: 0, mode: dsn ? 'live' : 'stub' };
  }

  const cache = loadCache();
  let sent = 0, cached = 0, skipped = 0;

  // ---- STUB MODE: no DSN configured ----
  // Run all the planning logic, attach a "(stub)" URL, but don't network-call.
  // Lets the rest of the pipeline + dashboard verify the wiring before the
  // real DSN ships in CI.
  if (!dsn) {
    log(`[sentry] STUB mode (no SENTRY_DSN set). Would send ${toSend.length} event(s).`);
    for (const t of toSend) {
      const fp = fingerprintFor(t);
      const cacheEntry = cache[fp];
      if (cacheEntry && cacheEntry.issueUrl) {
        t.sentryIssueUrl = cacheEntry.issueUrl;
        cached++;
      } else {
        const stubUrl = `#sentry-stub/${fp}`;
        t.sentryIssueUrl = stubUrl;
        cache[fp] = { issueUrl: stubUrl, firstSentAt: new Date().toISOString(), stub: true };
        skipped++;
      }
      t.sentryFingerprint = fp;
    }
    saveCache(cache);
    log(`[sentry] STUB: ${cached} cached, ${skipped} would-be-new (stub URLs attached).`);
    return { sent: 0, cached, skipped, mode: 'stub' };
  }

  // ---- LIVE MODE: real DSN, real network call ----
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    tracesSampleRate: 0,    // we don't need APM, just events
    autoSessionTracking: false,
    debug: false,
    environment: opts.env || process.env.BASE_URL || 'staging',
    release: process.env.GIT_SHA || undefined,
  });

  for (const t of toSend) {
    const fp = fingerprintFor(t);
    t.sentryFingerprint = fp;

    // Cache hit — don't re-send, just reattach the existing issue URL.
    if (cache[fp] && cache[fp].issueUrl && !cache[fp].stub) {
      t.sentryIssueUrl = cache[fp].issueUrl;
      cached++;
      continue;
    }

    const evt = buildEvent(t, opts);
    const eventId = Sentry.captureEvent({
      message: evt.message,
      level: evt.level,
      tags: evt.tags,
      extra: evt.extras,
      fingerprint: evt.fingerprint,
    });
    if (!eventId) {
      log(`[sentry] captureEvent returned no id for "${t.title}" — skipped`);
      skipped++;
      continue;
    }
    const issueUrl = issueUrlForEventId(eventId, orgSlug, projectId);
    t.sentryIssueUrl = issueUrl;
    cache[fp] = { issueUrl, firstSentAt: new Date().toISOString(), eventId };
    sent++;
  }

  // Flush before exit so the events actually leave the runner.
  try {
    await Sentry.close(5000);
  } catch (e) {
    log(`[sentry] flush warning: ${e.message}`);
  }

  saveCache(cache);
  log(`[sentry] LIVE: ${sent} new event(s) sent, ${cached} from cache.`);
  return { sent, cached, skipped, mode: 'live' };
}

module.exports = { enrichFailuresWithSentry, fingerprintFor, shouldSend };

// CLI helper: walk a results JSON and print what would be sent.
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
