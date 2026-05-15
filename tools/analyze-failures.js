#!/usr/bin/env node
/**
 * tools/analyze-failures.js
 *
 * Failure triage engine. Reads a Playwright JSON results file and, for each
 * failed test, produces:
 *   { severity, rootCause, reproSteps[], suggestedFix, source }
 *
 * Today this is a rule-based heuristic — pattern-matches on the error and
 * pulls human-readable steps out of the spec source. Same output shape we'll
 * use when an Anthropic API key gets plugged in later, so the dashboard
 * renderer and the build pipeline don't need to change when we swap engines.
 *
 * Usage (programmatic):
 *   const { analyzeFailure } = require('./analyze-failures');
 *   const aiAnalysis = analyzeFailure(test, { specRoot: 'Automation' });
 */

const fs = require('fs');
const path = require('path');

// ---- Public entry ------------------------------------------------------

function analyzeFailure(test, opts = {}) {
  const specRoot = opts.specRoot || path.resolve(__dirname, '..', 'Automation');
  const errorBlob = (test.errors || []).join('\n');
  const cleanedError = stripAnsi(errorBlob);
  // Distinguish "test.fail() tripwire unexpectedly passed" (no error to
  // classify) from a real failure with an error.
  const isUnexpectedPass = test.status === 'passed' && test.expectedStatus === 'failed';
  const errClass = isUnexpectedPass ? TRIPWIRE_FIRED_CLASS : classifyError(cleanedError);
  const severity = inferSeverity(test, errClass);
  const rootCause = renderRootCause(test, errClass, cleanedError);
  const reproSteps = generateReproSteps(test, specRoot);
  const suggestedFix = suggestFix(test, errClass, cleanedError);
  return {
    severity,
    rootCause,
    reproSteps,
    suggestedFix,
    errorClass: errClass.name,
    source: 'heuristic', // 'claude-haiku' / 'claude-sonnet' when AI is wired
    generatedAt: new Date().toISOString(),
  };
}

// ---- Error classification ----------------------------------------------

const ERROR_PATTERNS = [
  {
    name: 'http-500',
    test: (e) => /5\d{2}\s+(internal\s+server\s+error|server\s+error)|status code\s+5\d{2}|http\s+5\d{2}/i.test(e),
    severityHint: 'critical',
    causeTemplate: 'Server returned an HTTP 5xx. The app errored before generating a response.',
    fixHints: [
      'Check the server logs for the stack trace at the time of failure.',
      'Common roots: null reference in the controller, missing config value, DB connection problem, unhandled exception in a service layer.',
      'If this is a known data shape, add input validation upstream so the server returns 4xx with a clear message instead of 5xx.',
    ],
  },
  {
    name: 'http-404',
    test: (e) => /not\s+found|404/i.test(e) && /\b(image|asset|svg|png|css|js|ckeditor)\b/i.test(e),
    severityHint: 'major',
    causeTemplate: 'A static asset request returned 404 — the asset URL doesn\'t resolve on this build.',
    fixHints: [
      'Check whether the asset filename or path has changed in a recent deploy.',
      'Confirm the asset is included in the build pipeline (webpack/asset manifest).',
      'If the asset has been removed intentionally, update the reference in the calling template.',
    ],
  },
  {
    name: 'selector-syntax',
    test: (e) => /unexpected token|css\.escape|while parsing css selector/i.test(e),
    severityHint: 'minor',
    causeTemplate: 'The Playwright selector string is syntactically invalid — usually a bracket / regex character that needs escaping.',
    fixHints: [
      'Inspect the locator string in the failing test. The offending character is shown in the "Unexpected token" message.',
      'If you need a regex match inside a CSS selector, use Playwright\'s `:text(/regex/i)` only when you mean to match text content, and CSS.escape() any user-supplied substring.',
      'For attribute matches with text patterns, prefer `locator.filter({ hasText: /…/i })` rather than embedding the regex in the CSS string.',
    ],
  },
  {
    name: 'timeout-waitfor',
    test: (e) => /timeout|exceeded.*waiting|waiting for selector/i.test(e),
    severityHint: 'major',
    causeTemplate: 'The test exceeded its wait budget — an element/URL/condition never reached the expected state.',
    fixHints: [
      'Open the trace.zip artifact and find the last screenshot. Either the page is genuinely slower than the timeout, or the locator never matched.',
      'If the page is right but the element is missing, the selector likely drifted (CSS class rename, DOM restructure).',
      'If the element is present but the test still times out, raise the timeout or wait for a more reliable readiness signal.',
    ],
  },
  {
    name: 'element-missing',
    test: (e) => /toHaveCount.*received.*0|locator resolved to 0|should exist|should be visible/i.test(e),
    severityHint: 'major',
    causeTemplate: 'A locator that the test expected to find did not match any element on the page.',
    fixHints: [
      'Verify the selector against the current rendered DOM (paste it into Chrome DevTools Console as `$$(\'…\')`).',
      'Most common roots: a CSS class was renamed, the element moved into a Shadow DOM, or the page hadn\'t finished loading before the locator query ran.',
      'Add a `waitFor({ state: "attached" })` if the element is JS-rendered.',
    ],
  },
  {
    name: 'navigation-aborted',
    test: (e) => /err_aborted|navigation interrupted|navigation aborted/i.test(e),
    severityHint: 'major',
    causeTemplate: 'A navigation was cancelled before it could complete — usually a second navigation started while the first was still in flight.',
    fixHints: [
      'Look for stacked `page.goto()` calls without awaits.',
      'On Consentz specifically: the `/` indirection redirects to the clinic dashboard; calling `dashboard.goto()` after another navigation has been observed to race. Prefer a direct URL.',
    ],
  },
  {
    name: 'console-error',
    test: (e) => /pageerror|uncaught.*exception|cannot read.*null|cannot convert.*null/i.test(e),
    severityHint: 'major',
    causeTemplate: 'An uncaught JavaScript exception fired in the page during the test.',
    fixHints: [
      'Open the trace.zip and inspect the Console panel at the failure timestamp.',
      'The stack trace usually points to a controller / page-init handler that referenced something that isn\'t there yet (race condition) or has been removed.',
    ],
  },
  {
    name: 'assertion-boolean',
    test: (e) => /expect.*toBe\b|to(Be|Equal|Truthy|Falsy|GreaterThan|LessThan)/i.test(e),
    severityHint: 'major',
    causeTemplate: 'A direct assertion failed — the actual value didn\'t match the expected.',
    fixHints: [
      'Read the "Expected" vs "Received" lines in the error to see what diverged.',
      'If the test is a `test.fail()` tripwire and Received is "true" instead of "false", the underlying bug may have been fixed — investigate before un-marking.',
    ],
  },
  {
    name: 'custom-thrown',
    test: (e) => /^Error: /m.test(e) && !/at \w+:\d/.test(e.split('\n')[0]),
    severityHint: 'minor',
    causeTemplate: 'The test threw a custom error — usually a defensive check the test author added.',
    fixHints: [
      'Read the error message — it was written by the test author to explain the assumption that broke.',
      'Often these are "selector / URL needs work" probes that need pinning before the real assertion can run.',
    ],
  },
];

function classifyError(errorText) {
  for (const p of ERROR_PATTERNS) if (p.test(errorText)) return p;
  return {
    name: 'unknown',
    severityHint: 'major',
    causeTemplate: 'The test failed but the error didn\'t match any known pattern. See the raw error for details.',
    fixHints: ['Read the raw error and stack. If the same shape repeats, add a pattern to tools/analyze-failures.js so future runs auto-classify it.'],
  };
}

// Special "no error to classify" entry — used when a test.fail() tripwire
// unexpectedly passes (the bug may be fixed). There's no error to parse.
const TRIPWIRE_FIRED_CLASS = {
  name: 'tripwire-fired',
  severityHint: 'minor', // not a regression — a *positive* surprise
  causeTemplate: 'The test.fail() tripwire passed — the underlying bug may be fixed.',
  fixHints: [],
};

// ---- Severity ----------------------------------------------------------

function inferSeverity(test, errClass) {
  // If the title carries a `[Kxx]` tag, the bug catalogue already knows the
  // severity — use the test name as a hint (we don't have bug-severity here,
  // but the test framing tells us). Otherwise fall back to the error class.
  const titleHint = /\bcritical\b/i.test(test.title) ? 'critical'
                  : /\bmajor\b/i.test(test.title) ? 'major'
                  : /\bminor\b/i.test(test.title) ? 'minor'
                  : null;
  return titleHint || errClass.severityHint || 'major';
}

// ---- Root cause --------------------------------------------------------

function renderRootCause(test, errClass, errorText) {
  const firstLine = (errorText.split('\n').find((l) => l.trim()) || '').slice(0, 200);
  // Append the first error line for specificity if it's substantive.
  const detail = firstLine && !/^Error:?$/i.test(firstLine.trim()) ? ` Detail: ${firstLine.trim()}` : '';
  return `${errClass.causeTemplate}${detail}`;
}

// ---- Reproduction steps -------------------------------------------------

function generateReproSteps(test, specRoot) {
  const specPath = resolveSpecPath(test.file, specRoot);
  const steps = ['Open the application at the BASE_URL configured for this environment.'];
  if (!specPath || !fs.existsSync(specPath)) {
    steps.push('Run the failing test manually by following the actions in the spec file.');
    return steps;
  }
  try {
    const src = fs.readFileSync(specPath, 'utf8');
    const testBody = extractTestBody(src, test.title, test.line);
    const parsed = parseActionsFromBody(testBody);
    if (parsed.length === 0) {
      steps.push('Walk through the steps in the spec file manually and observe where it fails.');
    } else {
      steps.push(...parsed);
    }
    steps.push('Observe the failure described in the error message.');
  } catch {
    steps.push('Could not auto-extract steps from the spec. Open the spec file and follow the actions in order.');
  }
  return steps;
}

function resolveSpecPath(fileFromJson, specRoot) {
  if (!fileFromJson) return null;
  // Playwright's JSON file paths can be either relative (`tests/...`) or
  // absolute. Normalize and try a couple of bases.
  const norm = fileFromJson.replace(/\\/g, '/');
  if (path.isAbsolute(norm)) return norm;
  const candidates = [
    path.join(specRoot, norm),
    path.join(specRoot, 'tests', norm.replace(/^tests\//, '')),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

/** Best-effort: pull the body of a `test(...)` / `test.fail(...)` block whose
 *  first arg matches the given title, starting near the given line number. */
function extractTestBody(src, title, hintLine) {
  const lines = src.split('\n');
  // Find a line near hintLine that looks like a test definition + matches the title.
  const startScan = Math.max(0, (hintLine || 1) - 3);
  let openLine = -1;
  for (let i = startScan; i < Math.min(lines.length, startScan + 8); i++) {
    if (/test(\.fail|\.skip|\.fixme)?\s*\(/.test(lines[i])) { openLine = i; break; }
  }
  if (openLine < 0) return '';
  // Walk forward to find the arrow function body, then balance braces.
  let braceDepth = 0;
  let inBody = false;
  let bodyStart = -1;
  for (let i = openLine; i < lines.length; i++) {
    for (let j = 0; j < lines[i].length; j++) {
      const c = lines[i][j];
      if (!inBody) {
        if (c === '{' && braceDepth === 0 && /async\s*\(?[^)]*\)?\s*=>\s*\{$/.test(lines[i].slice(0, j + 1).trim().slice(-40))) {
          inBody = true; braceDepth = 1; bodyStart = i + (j === lines[i].length - 1 ? 1 : 0);
        }
      } else {
        if (c === '{') braceDepth++;
        else if (c === '}') { braceDepth--; if (braceDepth === 0) return lines.slice(bodyStart, i + 1).join('\n'); }
      }
    }
  }
  return lines.slice(openLine, Math.min(lines.length, openLine + 50)).join('\n');
}

const ACTION_RULES = [
  // page.goto('...path...') / dashboard.goto() / patients.gotoList(clinicId)
  { re: /page\.goto\s*\(\s*[`'"]([^`'"]+)[`'"]/g,
    fn: (m) => `Navigate to ${m[1]}` },
  { re: /\b(\w+)\.goto\s*\(/g,
    fn: (m) => `Navigate to the ${humanize(m[1])} page`, skipIf: (m, src) => /page\.goto/.test(src.slice(m.index - 6, m.index)) },
  { re: /\b(\w+)\.gotoNew\s*\(/g,
    fn: (m) => `Open the "new ${humanize(m[1].replace(/s$/, ''))}" form` },
  { re: /\b(\w+)\.gotoList\s*\(/g,
    fn: (m) => `Open the ${humanize(m[1])} list page` },

  // login.login(user, password)
  { re: /\.login\s*\(/g, fn: () => 'Sign in with valid credentials' },

  // page.locator(...).click() / element.click()
  { re: /\.click\s*\(/g,
    fn: (m, src) => {
      // Try to find a label hint in the preceding 80 chars
      const pre = src.slice(Math.max(0, m.index - 120), m.index);
      const text = (pre.match(/has[-_]?[Tt]ext\s*:\s*[`'"\/]([^`'"\/]+)[`'"\/]/) ||
                    pre.match(/getByRole\s*\(\s*['"][^'"]+['"]\s*,\s*\{\s*name\s*:\s*\/?([^\/'"`}]+)\/?/) ||
                    pre.match(/getByText\s*\(\s*['"\/]([^'"`\/]+)/) ||
                    [])[1];
      return text ? `Click "${text.trim()}"` : 'Click the element';
    } },
  // Single-string .fill('...') — extract literal value
  { re: /\.fill\s*\(\s*[`'"]([^`'"\)]{1,60})[`'"]/g,
    fn: (m) => `Enter "${m[1].replace(/\s+/g, ' ').trim().slice(0, 60)}" in the form field` },
  // Multi-field .fill({ firstName: '...', ... }) — POM object-spread style
  { re: /(?:patients|calendar|booking)\.fill\s*\(\s*\{/g,
    fn: () => 'Fill in the form fields' },
  { re: /\.press\s*\(\s*[`'"]([^`'"]+)/g, fn: (m) => `Press the ${m[1]} key` },
  { re: /\.check\s*\(/g, fn: () => 'Tick the checkbox' },
  { re: /\.selectOption\s*\(\s*[`'"]?([^`'"\)]{1,60})/g, fn: (m) => `Select "${m[1]}" from the dropdown` },

  // Higher-level POM verbs
  { re: /patients\.save\s*\(/g, fn: () => 'Click Save on the patient form' },
  { re: /patients\.delete\s*\(/g, fn: () => 'Confirm deletion of the patient record' },
  { re: /calendar\.openBookingModal\s*\(/g, fn: () => 'Click "Book Appointment" to open the booking modal' },
  { re: /calendar\.saveBooking\s*\(/g, fn: () => 'Save the appointment' },

  // expects (treat as verification step)
  { re: /await\s+expect\([\s\S]{0,200}?\)\.(toHaveURL|toBeVisible|toHaveText|toContainText|toHaveCount|toBe|toEqual)\b/g,
    fn: (m) => `Verify: ${m[1].replace(/([A-Z])/g, ' $1').toLowerCase().trim()}` },
];

function parseActionsFromBody(body) {
  const steps = [];
  const seen = new Set();
  for (const rule of ACTION_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(body))) {
      if (rule.skipIf && rule.skipIf(m, body)) continue;
      const step = rule.fn(m, body);
      const key = `${m.index}:${step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push({ index: m.index, text: step });
    }
  }
  // Preserve source order; cap at 12 steps so the dialog stays scannable.
  steps.sort((a, b) => a.index - b.index);
  return steps.slice(0, 12).map((s) => s.text);
}

function humanize(s) {
  return s.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase()).trim();
}

// ---- Fix suggestions ---------------------------------------------------

function suggestFix(test, errClass, errorText) {
  const hints = errClass.fixHints || [];
  // Special-case test.fail() tripwires that unexpectedly passed — the
  // suggestion is "investigate fix" rather than "debug the failure."
  // Detect either via the explicit Playwright error text OR (more reliably,
  // when invoked from the build pipeline) via status/expectedStatus mismatch.
  const isUnexpectedPass =
    /expected to fail.*passed/i.test(errorText) ||
    (test.status === 'passed' && test.expectedStatus === 'failed');
  if (isUnexpectedPass) {
    return [
      'The test.fail() tripwire unexpectedly passed — the underlying bug may have been fixed.',
      '1. Manually verify the bug is gone on the target environment.',
      '2. If gone: un-mark this test (remove test.fail), drop the bug from BUGS.md, and turn the test into a regression check.',
      '3. If the test is passing vacuously (e.g. probing a URL that doesn\'t even load, so no relevant errors fire), fix the test\'s navigation/selectors first.',
    ].join('\n');
  }
  return hints.join(' ');
}

// ---- Helpers -----------------------------------------------------------

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

module.exports = { analyzeFailure };

// CLI: `node tools/analyze-failures.js [results.json]` — prints analysis for
// every failed test in the file (handy for manual sanity-checking).
if (require.main === module) {
  const input = process.argv[2] || path.join(__dirname, '..', 'Automation/test-results/results.json');
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const tests = [];
  (function walk(s) {
    for (const sub of s.suites || []) walk(sub);
    for (const spec of s.specs || []) {
      for (const t of spec.tests || []) {
        const lastResult = (t.results || [])[t.results.length - 1] || {};
        tests.push({
          title: spec.title,
          file: spec.file,
          line: spec.line,
          status: lastResult.status || t.status,
          errors: (lastResult.errors || []).map((e) => e.message || ''),
        });
      }
    }
  })({ suites: raw.suites || [] });
  const failures = tests.filter((t) => t.status === 'failed');
  console.log(`Analyzing ${failures.length} failures...\n`);
  for (const f of failures) {
    console.log('━'.repeat(80));
    console.log(`${f.title}\n  ${f.file}:${f.line}`);
    const a = analyzeFailure(f);
    console.log(`  severity: ${a.severity}  · errorClass: ${a.errorClass}`);
    console.log(`  rootCause: ${a.rootCause}`);
    console.log(`  reproSteps:`);
    a.reproSteps.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
    console.log(`  suggestedFix: ${a.suggestedFix}`);
  }
}
