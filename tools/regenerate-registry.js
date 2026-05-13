// regenerate-registry.js
//
// Walks Manual/testplan/**/Testplan_*.txt (and SMOKE.001.txt etc.),
// parses the [META] block + counts TC lines, and rewrites
// Manual/Feature-Registry.csv with current numbers + totals.
//
// Run: node regenerate-registry.js
//
// A test plan file is recognised by starting with `[META]`. The script
// is idempotent and safe to run after any test-plan edit.

const fs = require('fs');
const path = require('path');

// Script lives in `tools/`; resolve REPO as one level up.
const REPO = path.resolve(__dirname, '..');
const PLAN_ROOT = path.join(REPO, 'Manual', 'testplan');
const OUT_FILE = path.join(REPO, 'Manual', 'Feature-Registry.csv');

// ── Walk for test plan files ────────────────────────────────────────────────

function findPlanFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPlanFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      // A plan file starts with `[META]` (we ignore manual TC files which
      // start with the `═══` banner).
      const head = fs.readFileSync(full, 'utf-8').slice(0, 16);
      if (head.startsWith('[META]')) out.push(full);
    }
  }
  return out;
}

// ── Parse a single plan file ────────────────────────────────────────────────

function parseTestplan(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');
  const meta = {};
  let inMeta = false;
  for (const line of lines) {
    if (line.trim() === '[META]') { inMeta = true; continue; }
    // First non-META section header ends META block
    if (inMeta && /^\[/.test(line.trim())) { inMeta = false; }
    if (!inMeta) continue;
    const m = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
    if (m) meta[m[1]] = m[2];
  }

  // Count test cases. A TC line starts with optional `<TBD>` prefix, then
  // `TC.<MODULE>.<NNN>` (and possibly more segments). Tag determines lane:
  //   <AUTOMATION>  + no <TBD>  → automated (already running)
  //   anything else (<MANUAL>, <TBD>...AUTOMATION, etc.) → manual / TBD
  let auto = 0, manual = 0;
  for (const line of lines) {
    // <SUB> is normally a digit run (e.g. 005) but can also be the literal
    // FLOW for cross-feature integration plans (e.g. PAT.FLOW.001).
    const m = line.match(/^\s*(<TBD>)?\s*(TC\.[A-Z]+\.(?:\d+|FLOW))/);
    if (!m) continue;
    const isTbd = !!m[1];
    const isAuto = /<AUTOMATION>/.test(line);
    if (isAuto && !isTbd) auto++;
    else manual++;
  }

  return { meta, auto, manual };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function priorityFromFlags(flags) {
  const m = (flags || '').match(/\bP[012]\b/);
  return m ? m[0] : '';
}

function featureNameFromLongname(longname) {
  // Longname is shaped like "DASH.001 (Time Period Filter)".
  const m = (longname || '').match(/\(([^)]+)\)/);
  return m ? m[1] : (longname || '');
}

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Build CSV ───────────────────────────────────────────────────────────────

function main() {
  const planFiles = findPlanFiles(PLAN_ROOT);

  const rows = planFiles.map((f) => {
    const { meta, auto, manual } = parseTestplan(f);
    return {
      module: meta.Module || '',
      featureId: meta.Testname || '',
      featureName: featureNameFromLongname(meta.Longname),
      priority: priorityFromFlags(meta.Flags),
      total: auto + manual,
      auto,
      manual,
      planPath: path.relative(REPO, f).replace(/\\/g, '/'),
    };
  });

  // Sort by module then feature ID for stable output
  rows.sort((a, b) =>
    (a.module + ' ' + a.featureId).localeCompare(b.module + ' ' + b.featureId),
  );

  const totalCases = rows.reduce((s, r) => s + r.total, 0);
  const totalAuto = rows.reduce((s, r) => s + r.auto, 0);
  const totalManual = rows.reduce((s, r) => s + r.manual, 0);

  const csvLines = [
    'Module,Feature ID,Feature Name,Priority,Total Cases,Automated,Manual / TBD,Plan Path',
    ...rows.map((r) =>
      [
        csvEscape(r.module),
        csvEscape(r.featureId),
        csvEscape(r.featureName),
        csvEscape(r.priority),
        r.total,
        r.auto,
        r.manual,
        csvEscape(r.planPath),
      ].join(','),
    ),
    `,,,Totals,${totalCases},${totalAuto},${totalManual},`,
  ];

  fs.writeFileSync(OUT_FILE, csvLines.join('\n') + '\n');
  console.log(`Wrote ${rows.length} rows → ${path.relative(REPO, OUT_FILE)}`);
  console.log(
    `Totals: ${totalCases} cases · ${totalAuto} automated · ${totalManual} manual / TBD`,
  );
}

main();
