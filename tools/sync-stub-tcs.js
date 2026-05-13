// sync-stub-tcs.js
//
// Walks Manual/testplan/<Module>/<MODULE>.<NNN>/ folders and aligns the
// per-TC stub files with the current testplan:
//   • For each TC line in Testplan_<MODULE>.<NNN>.txt, ensure a matching
//     TC.<MODULE>.<NNN>.<MMM>.txt stub exists with the right title /
//     tags / section.
//   • For each existing TC.* stub whose ID is NOT in the plan anymore
//     (e.g. dropped during a merge), delete it.
//
// The plan is the source of truth. Stubs are regenerated to match if
// they're absent, mismatched, or stale.
//
// Run: node tools/sync-stub-tcs.js
//
// Idempotent. Safe to run repeatedly after any plan edit.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PLAN_ROOT = path.join(REPO, 'Manual', 'testplan');

// ── Plan parsing ────────────────────────────────────────────────────────────

function parsePlan(planPath) {
  const text = fs.readFileSync(planPath, 'utf-8');
  const lines = text.split('\n');

  const meta = {};
  const cases = []; // { id: '001', section: 'Default settings', title: '...', tags: '<AUTOMATION>' }

  let inMeta = false;
  let currentSection = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();

    if (trimmed === '[META]') { inMeta = true; continue; }
    if (inMeta && /^\[/.test(trimmed)) { inMeta = false; }

    if (inMeta) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
      if (m) meta[m[1]] = m[2];
      continue;
    }

    // Section header like "[Default settings]"
    const sec = trimmed.match(/^\[([^\]]+)\]$/);
    if (sec) { currentSection = sec[1]; continue; }

    // TC line. Optional <TBD> prefix, then TC.<MODULE>.<SUB>.<MMM> <title> <tag> [more tags] [# comment]
    // <SUB> is normally a digit run (e.g. 005) but can also be the literal
    // FLOW for cross-feature integration plans (e.g. PAT.FLOW.001).
    const tc = line.match(
      /^\s*(<TBD>)?\s*(TC\.[A-Z]+\.(?:\d+|FLOW)\.(\d+))\s+(.*?)(\s*<(?:AUTOMATION|MANUAL|BUG:[A-Z0-9]+)>(?:\s*<(?:AUTOMATION|MANUAL|BUG:[A-Z0-9]+)>)*)\s*(?:#.*)?$/,
    );
    if (!tc) continue;

    const isTbd = !!tc[1];
    const tcId = tc[2];
    const lastSeg = tc[3];
    const stripped = tc[4].replace(/^Verify\s+/i, '').replace(/\s+#.*$/, '').trim();
    const title = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    const tagBlock = tc[5].trim();
    const tags = (isTbd ? '<TBD> ' : '') + tagBlock;

    cases.push({
      id: lastSeg,
      tcId,
      section: currentSection,
      title,
      tags,
    });
  }

  return { meta, cases };
}

// ── Stub rendering ──────────────────────────────────────────────────────────

function renderStub({ tcId, section, title, tags, longname }) {
  return `═══════════════════════════════════════════════════════════════════════════════
 ${tcId} — ${title}
═══════════════════════════════════════════════════════════════════════════════
Sub-feature : ${longname}
Section     : [${section}]
Tags        : ${tags}
Status      : STUB — see [Steps] block below for status of detailed reproduction

[Preconfiguration]
  Account    = super-user (demo / Beautify Clinic, id=3)
  Browser    = Chrome (latest stable)
  Steps      = 1. Open https://staging.consentz.com/admin/login
               2. Log in with CONSENTZ_USERNAME / CONSENTZ_PASSWORD.
               3. Wait for /admin/clinics/3/dashboard.
               4. Dismiss "Welcome to Consentz" modal if present.

[Steps]
  STUB — to be expanded on first manual execution.
  Intent: ${title}

[Expected]
  STUB — to be filled in alongside the [Steps] block above.

[Postconfiguration]
  NA — case does not modify persistent state.
`;
}

// ── Per-plan sync ───────────────────────────────────────────────────────────

function syncPlan(planPath) {
  const dir = path.dirname(planPath);
  const { meta, cases } = parsePlan(planPath);

  // Build long-form sub-feature label e.g. "Widget Grid & Per-Widget Controls (DASH.006)"
  const longnameMatch = (meta.Longname || '').match(/^[^()]+\(([^)]+)\)/);
  const featureName = longnameMatch ? longnameMatch[1] : (meta.Longname || meta.Testname || '');
  const subFeature = `${featureName} (${meta.Testname || ''})`;

  const wantedIds = new Set(cases.map((c) => c.tcId));

  // Delete orphaned TC files (in folder but not in plan).
  let deleted = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith('TC.') || !entry.endsWith('.txt')) continue;
    const tcId = entry.slice(0, -4); // strip .txt
    if (!wantedIds.has(tcId)) {
      fs.unlinkSync(path.join(dir, entry));
      deleted++;
    }
  }

  // Create / refresh each surviving TC stub.
  let created = 0, refreshed = 0;
  for (const c of cases) {
    const filePath = path.join(dir, `${c.tcId}.txt`);
    const next = renderStub({
      tcId: c.tcId,
      section: c.section,
      title: c.title,
      tags: c.tags,
      longname: subFeature,
    });

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, next);
      created++;
      continue;
    }

    const current = fs.readFileSync(filePath, 'utf-8');

    // Only refresh if the current file is a stub (or out-of-date stub).
    // We detect stubs by the "Status      : STUB" marker. If a human has
    // expanded the file beyond stub state, leave it alone — only sync the
    // header lines (title / tags / section) without trampling the body.
    const isStub = /Status\s*:\s*STUB\b/.test(current);

    if (isStub) {
      if (current !== next) {
        fs.writeFileSync(filePath, next);
        refreshed++;
      }
    } else {
      // Non-stub: only patch the title / tags / section header lines so
      // we don't lose human-written reproduction steps. Walk the file
      // line by line — the title sits between the first two `═══`
      // dividers; the metadata lines have stable `Key : value` shape.
      const lines = current.split('\n');
      let firstDivider = -1, secondDivider = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^[─═]{5,}$/.test(lines[i])) {
          if (firstDivider === -1) firstDivider = i;
          else if (secondDivider === -1) { secondDivider = i; break; }
        }
      }

      let next = current;
      if (firstDivider >= 0 && secondDivider > firstDivider) {
        const newTitleLine = ` ${c.tcId} — ${c.title}`;
        const merged = [
          ...lines.slice(0, firstDivider + 1),
          newTitleLine,
          ...lines.slice(secondDivider),
        ].join('\n');
        next = merged;
      }

      next = next
        .replace(/^(Sub-feature\s*:\s*).*$/m, `$1${subFeature}`)
        .replace(/^(Section\s*:\s*).*$/m, `$1[${c.section}]`)
        .replace(/^(Tags\s*:\s*).*$/m, `$1${c.tags}`);

      if (next !== current) {
        fs.writeFileSync(filePath, next);
        refreshed++;
      }
    }
  }

  return { plan: path.relative(REPO, planPath), deleted, created, refreshed, total: cases.length };
}

// ── Walk for plans ──────────────────────────────────────────────────────────

function findPlans(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPlans(full));
    } else if (entry.isFile() && /^Testplan_.*\.txt$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const plans = findPlans(PLAN_ROOT);
  let totalDel = 0, totalNew = 0, totalRef = 0, totalCases = 0;
  for (const p of plans) {
    const r = syncPlan(p);
    totalDel += r.deleted;
    totalNew += r.created;
    totalRef += r.refreshed;
    totalCases += r.total;
    console.log(
      `${r.plan}: ${r.total} cases · ${r.deleted} deleted · ${r.created} created · ${r.refreshed} refreshed`,
    );
  }
  console.log(
    `\nTotal: ${totalCases} cases across ${plans.length} plans · ${totalDel} deleted · ${totalNew} created · ${totalRef} refreshed`,
  );
}

main();
