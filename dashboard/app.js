// Consentz dashboard — client-side renderer.
// Reads dashboard/data/results.json, applies localStorage severity overrides,
// renders the page. No build step.

const LS_KEY = 'consentz.dashboard.severityOverrides';
const SEVERITY_VALUES = ['critical', 'major', 'minor'];
const SEVERITY_RANK = { critical: 3, major: 2, minor: 1 };

// Blended health weights mirrored from build-dashboard-data.js so the
// client-side recompute (which honors localStorage overrides) matches the
// server-side number stored in payload.overall.health.
const HEALTH_BUG_WEIGHT = 0.6;
const HEALTH_PASS_WEIGHT = 0.4;

let state = {
  data: null,
  trend: null,     // { points: [...] } from data/trend.json
  overrides: {},   // bugId -> severity (string)
  charts: {},      // canvasId -> Chart instance
};

// ---- Boot --------------------------------------------------------------

// Live-update poll interval. Cron runs every 12 hours; polling every 5 min
// when the tab is visible catches fresh CI runs within minutes of deploy.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

(async function init() {
  state.overrides = loadOverrides();
  try {
    state.data = await fetchJson(cacheBust('data/results.json'));
  } catch (e) {
    showError(`Could not load data/results.json (${e.message}). Run \`node tools/build-dashboard-data.js\` first.`);
    return;
  }
  // trend.json is optional — first-ever run won't have it
  state.trend = await fetchJson(cacheBust('data/trend.json')).catch(() => ({ points: [] }));
  bindControls();
  render();
  startLivePolling();
})();

function cacheBust(url) {
  // Force a fresh fetch each poll — GH Pages aggressively caches data/*.json.
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Date.now()}`;
}

// Polls for a fresh results.json. If generatedAt changes, re-render.
function startLivePolling() {
  let polling = false;
  setInterval(async () => {
    if (document.hidden || polling) return;
    polling = true;
    try {
      const fresh = await fetchJson(cacheBust('data/results.json'));
      if (fresh.generatedAt && fresh.generatedAt !== state.data.generatedAt) {
        state.data = fresh;
        state.trend = await fetchJson(cacheBust('data/trend.json')).catch(() => ({ points: [] }));
        flashLiveUpdate();
        render();
      }
    } catch {
      // Network blip — silent. Next poll will retry.
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);
}

function flashLiveUpdate() {
  const stamp = document.getElementById('generated-at');
  if (!stamp) return;
  stamp.classList.add('live-update-flash');
  setTimeout(() => stamp.classList.remove('live-update-flash'), 2_500);
}

function fetchJson(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function showError(msg) {
  document.querySelector('main').innerHTML = `<div style="background:#fee2e2;color:#991b1b;padding:24px;border-radius:10px;margin:24px 0"><strong>Dashboard error.</strong><br/>${msg}</div>`;
}

// ---- Severity override persistence -------------------------------------

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOverrides() {
  localStorage.setItem(LS_KEY, JSON.stringify(state.overrides));
}

function severityFor(bug) {
  return state.overrides[bug.id] || bug.severity;
}

// ---- Health math -------------------------------------------------------

/** Pure bug-load score: 100 minus weighted severity sum, clamped to 0. */
function bugScore(bugList, weights) {
  let deduction = 0;
  for (const b of bugList) {
    const sev = severityFor(b);
    deduction += weights[sev] || 0;
  }
  return Math.max(0, 100 - deduction);
}

/** Blended per-module health: 60% bug load + 40% pass rate.
 *  Returns null (N/A) when total tests = 0 AND total bugs = 0 — no signal. */
function moduleHealth(m, weights) {
  const hasTests = (m.total || 0) > 0;
  const hasBugs = (m.bugs || []).length > 0;
  if (!hasTests && !hasBugs) return null;

  const bs = bugScore(m.bugs, weights);
  if (!hasTests) return Math.round(bs);
  const passRate = (m.pass / m.total) * 100;
  return Math.round(HEALTH_BUG_WEIGHT * bs + HEALTH_PASS_WEIGHT * passRate);
}

function healthClass(score, thresholds) {
  if (score === null) return 'health-na';
  if (score >= thresholds.green) return 'health-green';
  if (score >= thresholds.yellow) return 'health-yellow';
  return 'health-red';
}

// ---- Render ------------------------------------------------------------

function render() {
  const d = state.data;
  const weights = d.severityConfig.weights;
  const thresholds = d.severityConfig.thresholds;

  // Top metadata
  const gen = new Date(d.generatedAt);
  document.getElementById('generated-at').textContent = `Last update: ${gen.toLocaleString()}`;
  renderRunDelta(d);
  document.getElementById('w-critical').textContent = weights.critical;
  document.getElementById('w-major').textContent = weights.major;
  document.getElementById('w-minor').textContent = weights.minor;

  // Hero stats — split failures into known-bug tripwires vs unknown regressions.
  // Server-side fields preferred when present; fall back to client-side derivation
  // from per-test `outcome` for backward compatibility with older payloads.
  const unknownFailures = d.overall.unknownFailures != null ? d.overall.unknownFailures : countTests(d, (t) => t.status === 'failed' && t.outcome === 'unexpected');
  const expectedFailures = d.overall.expectedFailures != null ? d.overall.expectedFailures : countTests(d, (t) => t.status === 'failed' && t.outcome === 'expected');
  document.getElementById('overall-pass').textContent = d.overall.pass;
  document.getElementById('overall-unknown').textContent = unknownFailures;
  document.getElementById('overall-expected').textContent = expectedFailures;
  document.getElementById('overall-skipped').textContent = d.overall.skipped;
  document.getElementById('overall-total').textContent = d.overall.total;

  // Overall health = average of per-module health scores. Modules with
  // no tests AND no bugs are N/A (excluded from the average) so empty
  // modules don't dilute the number toward 100. Client recomputes using
  // localStorage overrides; the canonical (override-free) value is in
  // payload.overall.health.
  const moduleScoresWithNA = d.modules.map((m) => moduleHealth(m, weights));
  const rated = moduleScoresWithNA.filter((s) => s !== null);
  const overallScore = rated.length
    ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length)
    : null;
  const ring = document.getElementById('overall-health-ring');
  const cls = healthClass(overallScore, thresholds);
  ring.classList.remove('health-green', 'health-yellow', 'health-red', 'health-na');
  ring.classList.add(cls);
  document.getElementById('overall-health-score').textContent = overallScore === null ? 'N/A' : overallScore;

  // Drive the SVG ring arc (circumference = 2π × r=42 ≈ 263.89)
  const arc = document.getElementById('overall-health-arc');
  if (arc) {
    const circumference = 263.89;
    arc.style.strokeDasharray = circumference;
    arc.style.strokeDashoffset = overallScore === null ? circumference : circumference * (1 - overallScore / 100);
  }

  // Trend section: 4 pies (prev vs current × tests + bugs)
  renderTrendCharts(d);

  // Health-over-time line chart from the archived history
  renderTrendLine();

  // Module grid
  renderModules(d.modules, weights, thresholds);

  // Bug list (+ module filter populated from data)
  renderBugFilters(d.modules);
  renderBugs(d.bugs);

  // Failed tests
  renderFailures(d.modules);
}

// ---- Run delta (header indicator) --------------------------------------

function renderRunDelta(d) {
  const el = document.getElementById('run-delta');
  if (!el) return;
  if (!d.previous || !d.previous.overall) { el.textContent = ''; return; }

  const cur = d.overall || {};
  const prev = d.previous.overall || {};
  const dPass = (cur.pass || 0) - (prev.pass || 0);
  const dFail = (cur.fail || 0) - (prev.fail || 0);

  const arrow = (n) => n > 0 ? '▲' : n < 0 ? '▼' : '•';
  const cls = (n, goodIfNeg) => n === 0 ? 'delta-flat' : (goodIfNeg ? (n < 0 ? 'delta-good' : 'delta-bad') : (n > 0 ? 'delta-good' : 'delta-bad'));

  el.innerHTML = `
    <span class="${cls(dPass, false)}">${arrow(dPass)} ${dPass >= 0 ? '+' : ''}${dPass} pass</span>
    <span class="${cls(dFail, true)}">${arrow(dFail)} ${dFail >= 0 ? '+' : ''}${dFail} fail</span>
  `;
}

// ---- Trend section: 4 pies ---------------------------------------------

function renderTrendCharts(d) {
  const meta = document.getElementById('trends-meta');
  if (d.previous && d.previous.generatedAt) {
    meta.textContent = `Previous run: ${new Date(d.previous.generatedAt).toLocaleString()}. Current run: ${new Date(d.generatedAt).toLocaleString()}.`;
  } else {
    meta.textContent = 'No previous run snapshot yet — the previous-run charts will populate on the next CI run.';
  }

  // Group A: Test outcome (pass / fail / skipped)
  const currTestCounts = pickTests(d.overall);
  const prevTestCounts = pickTests(d.previous && d.previous.overall);
  drawPie('chart-prev-tests', testLabels, prevTestCounts, testColors, prevTestCounts ? 'Pass / Fail / Skip' : 'No data');
  drawPie('chart-curr-tests', testLabels, currTestCounts, testColors, 'Pass / Fail / Skip');

  // Group B: Bug severity (critical / major / minor)
  const currBugCounts = bugSeverityCounts(d.bugs);
  const prevBugCounts = bugSeverityCounts(d.previous && d.previous.bugs);
  drawPie('chart-prev-bugs', bugLabels, prevBugCounts, bugColors, prevBugCounts ? 'Severity' : 'No data');
  drawPie('chart-curr-bugs', bugLabels, currBugCounts, bugColors, 'Severity');
}

const testLabels = ['Passed', 'Failed', 'Skipped'];
const testColors = ['#34d399', '#f87171', '#94a3b8'];
const bugLabels  = ['Critical', 'Major', 'Minor'];
const bugColors  = ['#f87171', '#fbbf24', '#818cf8'];

// Shared Chart.js look-and-feel for the dark theme — used by every chart on
// the page so they all match the rest of the UI.
const CHART_TEXT       = '#f1f5f9';
const CHART_TEXT_MUTED = 'rgba(241, 245, 249, 0.45)';
const CHART_GRID       = 'rgba(255, 255, 255, 0.05)';
const CHART_TOOLTIP_BG = 'rgba(15, 20, 40, 0.96)';

function pickTests(overall) {
  if (!overall) return null;
  return [overall.pass || 0, overall.fail || 0, overall.skipped || 0];
}

function bugSeverityCounts(bugs) {
  if (!bugs) return null;
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const b of bugs) {
    // Previous-snapshot bugs don't have user overrides applied — they're
    // canonical at that snapshot time. Current bugs respect overrides.
    const sev = b.id && state.overrides[b.id] ? state.overrides[b.id] : (b.severity || 'minor');
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return [counts.critical, counts.major, counts.minor];
}

function drawPie(canvasId, labels, data, colors, subtitle) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  // No data — render an empty grey pie with explanatory subtitle.
  const display = data && data.some((n) => n > 0) ? data : [1];
  const labelsToUse = data && data.some((n) => n > 0) ? labels : ['No data'];
  const colorsToUse = data && data.some((n) => n > 0) ? colors : ['#e5e7eb'];

  const total = (data || []).reduce((s, n) => s + n, 0);
  state.charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labelsToUse,
      datasets: [{
        data: display,
        backgroundColor: colorsToUse,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: CHART_TEXT, boxWidth: 12, font: { size: 11, family: 'Inter' } } },
        title: { display: true, text: total ? `${subtitle} (${total})` : subtitle, color: CHART_TEXT_MUTED, padding: 4, font: { size: 12, family: 'Inter' } },
        tooltip: {
          backgroundColor: CHART_TOOLTIP_BG,
          titleColor: CHART_TEXT,
          bodyColor: 'rgba(241, 245, 249, 0.8)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            label: (ctx) => {
              const n = data ? data[ctx.dataIndex] : 0;
              const pct = total ? Math.round((n / total) * 100) : 0;
              return `${ctx.label}: ${n} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderModules(modules, weights, thresholds) {
  const grid = document.getElementById('module-grid');
  grid.innerHTML = '';

  for (const m of modules) {
    const score = moduleHealth(m, weights);
    const isNA = score === null;
    const cls = healthClass(score, thresholds);
    const counts = { critical: 0, major: 0, minor: 0 };
    for (const b of m.bugs) counts[severityFor(b)] = (counts[severityFor(b)] || 0) + 1;
    const unverified = m.bugs.filter((b) => b.unverified).length;
    const automated = m.bugs.filter((b) => b.test).length;
    const mayBeFixed = m.bugs.filter((b) => b.tripwireFired).length;

    const card = document.createElement('div');
    card.className = `module-card ${cls}`;
    card.innerHTML = `
      <h3>
        <span>${escapeHtml(m.name)}</span>
        <span class="health" title="${isNA ? 'No tests + no bugs — module is unrated' : ''}">${isNA ? 'N/A' : score}</span>
      </h3>
      <div class="bar"><div style="width:${isNA ? 0 : score}%"></div></div>
      <div class="module-stats">
        <span>${m.pass}/${m.total} passing</span>
        ${m.fail ? `<span style="color:var(--red)">${m.fail} failed</span>` : ''}
        ${m.skipped ? `<span>${m.skipped} skipped</span>` : ''}
      </div>
      <div class="module-stats" style="margin-top:6px">
        ${counts.critical ? `<span class="badge critical">${counts.critical} critical</span>` : ''}
        ${counts.major ? `<span class="badge major">${counts.major} major</span>` : ''}
        ${counts.minor ? `<span class="badge minor">${counts.minor} minor</span>` : ''}
        ${m.bugs.length === 0 ? `<span style="color:var(--text-muted);font-size:13px">${isNA ? 'Unrated — no tests yet' : 'No tracked defects'}</span>` : ''}
      </div>
      ${m.bugs.length ? `<div class="module-stats" style="margin-top:6px;font-size:12px;color:var(--text-muted)">
        <span title="Bugs with an automated tripwire test">${automated}/${m.bugs.length} automated</span>
        ${unverified ? `<span class="badge unverified" title="Original report needs reproduction on current build">${unverified} unverified</span>` : ''}
        ${mayBeFixed ? `<span class="badge tripwire-fired" title="Tripwire fired — these bugs may be fixed">🎉 ${mayBeFixed} may be fixed</span>` : ''}
      </div>` : ''}
    `;
    grid.appendChild(card);
  }
}

function renderBugFilters(modules) {
  const sel = document.getElementById('filter-module');
  // Reset
  sel.innerHTML = '<option value="">All modules</option>';
  for (const m of modules.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = m.name;
    sel.appendChild(o);
  }
}

function renderBugs(bugs) {
  const tbody = document.getElementById('bugs-tbody');
  const fMod = document.getElementById('filter-module').value;
  const fSev = document.getElementById('filter-severity').value;
  tbody.innerHTML = '';

  // Build a lookup of previous-run bugs so we can show what changed.
  const prevById = {};
  for (const b of (state.data?.previous?.bugs || [])) prevById[b.id] = b;

  const filtered = bugs.filter((b) => {
    if (fMod && b.module !== fMod) return false;
    if (fSev && severityFor(b) !== fSev) return false;
    return true;
  });
  // Sort: critical first, then major, minor; alphabetical id within group
  const order = { critical: 0, major: 1, minor: 2 };
  filtered.sort((a, b) => {
    const sa = order[severityFor(a)] ?? 9;
    const sb = order[severityFor(b)] ?? 9;
    return sa - sb || a.id.localeCompare(b.id);
  });

  for (const b of filtered) {
    const tr = document.createElement('tr');
    const sev = severityFor(b);
    const overridden = !!state.overrides[b.id];
    if (b.unverified) tr.classList.add('bug-unverified');
    tr.innerHTML = `
      <td><span class="bug-id">${b.id}</span></td>
      <td>${escapeHtml(b.module)}</td>
      <td>${escapeHtml(b.title)}${b.unverified ? ' <span class="badge unverified" title="Original report needs reproduction on the current build">unverified</span>' : ''}${fixedBadge(b)}</td>
      <td>${coverageBadge(b)}</td>
      <td>${improvementCell(b, prevById)}</td>
      <td>
        <select class="severity-select ${sev}" data-bug="${b.id}">
          ${SEVERITY_VALUES.map((v) => `<option value="${v}"${v === sev ? ' selected' : ''}>${cap(v)}</option>`).join('')}
        </select>
        ${overridden ? '<span class="override-marker" title="Manually overridden"></span>' : ''}
      </td>
    `;
    tr.querySelector('td:nth-child(3)').addEventListener('click', () => openBugDetail(b));
    tr.querySelector('.severity-select').addEventListener('change', (e) => {
      const newSev = e.target.value;
      if (newSev === b.severity) delete state.overrides[b.id];
      else state.overrides[b.id] = newSev;
      saveOverrides();
      render();
    });
    tbody.appendChild(tr);
  }
}

function coverageBadge(bug) {
  if (bug.test) {
    // Hover shows the specific test title (testName) when available so
    // a failure on the dashboard can be traced back to a bug at a glance.
    const tip = bug.testName ? `${bug.testName}\n— ${bug.test}` : bug.test;
    return `<span class="badge coverage-auto" title="${escapeHtml(tip)}">🤖 automated</span>`;
  }
  if (bug.manualTC) {
    return `<span class="badge coverage-manual" title="Manual TC: ${escapeHtml(bug.manualTC)}">📝 manual TC</span>`;
  }
  return `<span class="badge coverage-none" title="No test maps to this defect yet">⚠ no test</span>`;
}

function fixedBadge(bug) {
  if (!bug.tripwireFired) return '';
  return `<span class="badge tripwire-fired" title="The tripwire test passed (unexpected). The underlying bug may be fixed — investigate and, if confirmed, drop this bug from BUGS.md + bug-severity.json.">🎉 may be fixed</span>`;
}

/** Improvement column: per-bug change indicator vs the previous run.
 *  Priority order (only one indicator shown):
 *   - 🎉 may be fixed (tripwire passed unexpectedly this run)
 *   - ⬇ severity downgraded
 *   - ⬆ severity upgraded
 *   - ✨ new (not in previous run)
 *   - — no change */
function improvementCell(bug, prevById) {
  if (bug.tripwireFired) {
    return `<span class="improvement improvement-fixed" title="Tripwire fired — investigate fix">🎉 may be fixed</span>`;
  }
  const prev = prevById[bug.id];
  if (!prev) {
    // No prior data OR a brand-new bug — distinguish by checking if we
    // have any previous data at all.
    if (Object.keys(prevById).length === 0) {
      return `<span class="improvement improvement-na" title="No previous run snapshot to compare against">—</span>`;
    }
    return `<span class="improvement improvement-new" title="New since the previous run">✨ new</span>`;
  }
  const curSev = severityFor(bug);
  const prevSev = prev.severity;
  const curRank = SEVERITY_RANK[curSev] || 0;
  const prevRank = SEVERITY_RANK[prevSev] || 0;
  if (curRank < prevRank) {
    return `<span class="improvement improvement-down" title="Severity downgraded from ${prevSev} to ${curSev}">⬇ ${prevSev} → ${curSev}</span>`;
  }
  if (curRank > prevRank) {
    return `<span class="improvement improvement-up" title="Severity upgraded from ${prevSev} to ${curSev}">⬆ ${prevSev} → ${curSev}</span>`;
  }
  return `<span class="improvement improvement-flat" title="No change since previous run">—</span>`;
}

// ---- Health-over-time line chart ---------------------------------------

function renderTrendLine() {
  const ctx = document.getElementById('trend-line-canvas');
  if (!ctx) return;
  const points = (state.trend && state.trend.points) || [];
  const meta = document.getElementById('trend-line-meta');
  if (state.charts['trend-line-canvas']) state.charts['trend-line-canvas'].destroy();

  if (points.length === 0) {
    meta.textContent = 'No archived runs yet — the trend line will populate once a few CI runs have completed.';
    return;
  }
  meta.textContent = `${points.length} archived run${points.length === 1 ? '' : 's'}. Health = 100 − weighted bug counts. Hover for run details.`;

  const labels = points.map((p) => new Date(p.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
  const healthData = points.map((p) => p.health);
  const passRateData = points.map((p) => p.passRate);
  const bugTotalData = points.map((p) => p.bugs.total);

  state.charts['trend-line-canvas'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Health score',
          data: healthData,
          yAxisID: 'y',
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129, 140, 248, 0.18)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#818cf8',
          pointBorderColor: '#0c1226',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        },
        {
          label: 'Pass rate %',
          data: passRateData,
          yAxisID: 'y',
          borderColor: '#34d399',
          borderDash: [4, 4],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: 'Bug count',
          data: bugTotalData,
          yAxisID: 'y2',
          borderColor: '#f472b6',
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: CHART_TEXT, boxWidth: 12, font: { size: 12, family: 'Inter', weight: '500' } } },
        tooltip: {
          backgroundColor: CHART_TOOLTIP_BG,
          titleColor: CHART_TEXT,
          bodyColor: 'rgba(241, 245, 249, 0.85)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            afterBody: (ctx) => {
              const i = ctx[0]?.dataIndex ?? 0;
              const p = points[i];
              if (!p) return '';
              return [
                `Tests: ${p.pass}/${p.total} passed, ${p.fail} failed, ${p.skipped} skipped`,
                `Bugs: ${p.bugs.critical} critical, ${p.bugs.major} major, ${p.bugs.minor} minor`,
              ];
            },
          },
        },
      },
      scales: {
        y:  { position: 'left',  min: 0, max: 100, title: { display: true, text: 'Health / Pass rate (%)', color: CHART_TEXT_MUTED, font: { family: 'Inter' } }, ticks: { color: CHART_TEXT_MUTED, font: { family: 'Inter' } }, grid: { color: CHART_GRID } },
        y2: { position: 'right', min: 0, beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Bug count', color: CHART_TEXT_MUTED, font: { family: 'Inter' } }, ticks: { color: CHART_TEXT_MUTED, font: { family: 'Inter' } } },
        x:  { ticks: { color: CHART_TEXT_MUTED, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { family: 'Inter' } }, grid: { color: CHART_GRID } },
      },
    },
  });
}

// ---- Failures + lightbox -----------------------------------------------

function countTests(d, pred) {
  let n = 0;
  for (const m of d.modules || []) for (const t of m.tests || []) if (pred(t)) n++;
  return n;
}

/** Resolve which K-bug a test maps to, if any. Matches by exact testName first
 *  (the canonical traceability field), then falls back to `[Kxx]` prefix in the
 *  title. Returns the bug ID or null. */
function bugIdForTest(t, allBugs) {
  for (const b of allBugs || []) {
    if (b.testName && b.testName === t.title) return b.id;
  }
  const m = (t.title || '').match(/^\[\s*(K\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function renderFailures(modules) {
  const unknownList = document.getElementById('failures-unknown-list');
  const knownList = document.getElementById('failures-known-list');
  const summary = document.getElementById('failures-summary');
  unknownList.innerHTML = '';
  knownList.innerHTML = '';

  const allBugs = (state.data && state.data.bugs) || [];

  const unknown = [];
  const known = [];
  for (const m of modules) {
    for (const t of m.tests || []) {
      if (t.status !== 'failed') continue;
      const item = { ...t, module: m.name, bugId: bugIdForTest(t, allBugs) };
      // Classification: outcome takes precedence (server-emitted). Fall back to
      // the bug-id heuristic: a [Kxx] tag implies known, no tag implies unknown.
      const isKnown = item.outcome === 'expected' || (item.outcome == null && !!item.bugId);
      if (isKnown) known.push(item); else unknown.push(item);
    }
  }

  // Section summary line
  if (unknown.length === 0 && known.length === 0) {
    summary.textContent = 'No failed tests on this run.';
  } else {
    summary.textContent = `${unknown.length} unknown · ${known.length} known-bug tripwire${known.length === 1 ? '' : 's'} firing`;
  }

  // Render counts in the group summaries
  document.getElementById('failures-unknown-count').textContent = unknown.length;
  document.getElementById('failures-known-count').textContent = known.length;

  // Unknown group is open by default + visible only when it has content; we
  // collapse it to a "no unknowns" note if empty so the panel doesn't look
  // alarmingly red when there's nothing wrong.
  const unknownGroup = document.getElementById('failures-unknown-group');
  unknownGroup.classList.toggle('is-empty', unknown.length === 0);
  if (unknown.length === 0) {
    unknownList.innerHTML = '<p class="failures-empty">🎉 No real regressions on this run — every failure is an expected tripwire.</p>';
  } else {
    for (const t of unknown) unknownList.appendChild(buildFailureCard(t, 'unknown'));
  }
  for (const t of known) knownList.appendChild(buildFailureCard(t, 'known'));
}

function buildFailureCard(t, kind) {
  const card = document.createElement('div');
  card.className = `failure-card failure-${kind}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Open failure details for ${t.title}`);

  const firstErr = stripCtrl((t.errors || [])[0] || '');
  const errPreview = firstErr.split('\n').slice(0, 3).join('\n');
  const thumbCount = (t.attachments || []).length;
  const bugTag = t.bugId
    ? `<span class="failure-bug-tag" title="Maps to bug ${t.bugId}">${t.bugId}</span>`
    : (kind === 'unknown' ? `<span class="failure-bug-tag failure-bug-tag-unknown">UNKNOWN</span>` : '');

  // AI-style triage preview: severity chip + 1-line root cause. Only shown
  // when the analyzer ran (unknown failures + may-be-fixed tripwires).
  const ai = t.aiAnalysis;
  const aiBlock = ai ? `
    <div class="failure-ai-preview" data-severity="${escapeHtml(ai.severity)}">
      <span class="ai-sev ai-sev-${escapeHtml(ai.severity)}">${escapeHtml(ai.severity)}</span>
      <span class="ai-cause">${escapeHtml(truncate(ai.rootCause, 160))}</span>
    </div>` : '';
  // sentrySent=true → real event dispatched, link to a populated Sentry search.
  // sentrySent=false → URL is a fingerprint placeholder; flag it so the user
  // doesn't expect AI fixes that haven't been generated yet (no DSN in CI).
  const sentryLink = t.sentryIssueUrl
    ? (t.sentrySent
        ? `<a class="failure-sentry-link" href="${escapeHtml(t.sentryIssueUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔗 AI fix on Sentry</a>`
        : `<span class="failure-sentry-link failure-sentry-link-stub" title="No SENTRY_DSN in CI yet — event not dispatched. Add the secret to populate AI fixes.">🔗 Sentry pending</span>`)
    : '';

  card.innerHTML = `
    <h4>${bugTag}${escapeHtml(t.title)} <small class="failure-mod">— ${escapeHtml(t.module)}</small></h4>
    <div class="file">${escapeHtml(t.file || '')}${t.line ? ':' + t.line : ''}</div>
    ${t.retries ? `<div class="retries">Retried ${t.retries}×</div>` : ''}
    ${aiBlock}
    ${errPreview ? `<pre class="err-preview">${escapeHtml(errPreview)}${firstErr.split('\n').length > 3 ? '\n…' : ''}</pre>` : ''}
    <div class="failure-meta">
      ${thumbCount ? `<span class="failure-thumb-count">📷 ${thumbCount} screenshot${thumbCount === 1 ? '' : 's'}</span>` : '<span class="muted">no screenshot</span>'}
      ${sentryLink}
      <span class="failure-open">Open details →</span>
    </div>
  `;
  card.addEventListener('click', () => openFailureDetail(t));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFailureDetail(t); }
  });
  return card;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function openFailureDetail(t) {
  const dlg = document.getElementById('failure-detail');
  const body = document.getElementById('failure-detail-body');
  const errors = (t.errors || []).map(stripCtrl);
  const attachments = t.attachments || [];

  const ai = t.aiAnalysis;
  const sentryUrl = t.sentryIssueUrl;
  const sentryCta = sentryUrl
    ? (t.sentrySent
        ? `<a class="ai-sentry-cta" href="${escapeHtml(sentryUrl)}" target="_blank" rel="noopener">View AI fix on Sentry →</a>`
        : `<span class="ai-sentry-cta ai-sentry-cta-stub" title="Sentry integration is wired — needs SENTRY_DSN in CI for events to dispatch. Once set, this link will show the AI fix.">Sentry pending (no DSN in CI yet)</span>`)
    : '';
  const aiSection = ai ? `
    <div class="ai-panel ai-panel-${escapeHtml(ai.severity)}">
      <div class="ai-panel-head">
        <span class="ai-panel-title">🔍 Failure analysis</span>
        <span class="ai-sev ai-sev-${escapeHtml(ai.severity)}">${escapeHtml(ai.severity)}</span>
        <span class="ai-source" title="${escapeHtml(ai.source)} engine">${escapeHtml(ai.source === 'heuristic' ? 'heuristic (Sentry AI when wired)' : ai.source)}</span>
        ${sentryCta}
      </div>
      <div class="ai-section">
        <h5>Root cause</h5>
        <p>${escapeHtml(ai.rootCause || '')}</p>
      </div>
      ${(ai.reproSteps && ai.reproSteps.length) ? `
        <div class="ai-section">
          <h5>How to reproduce manually</h5>
          <ol class="repro-steps">
            ${ai.reproSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
          </ol>
        </div>` : ''}
      ${ai.suggestedFix ? `
        <div class="ai-section">
          <h5>Suggested fix</h5>
          <p class="ai-fix">${escapeHtml(ai.suggestedFix)}</p>
        </div>` : ''}
    </div>` : '';

  body.innerHTML = `
    <h3>${escapeHtml(t.title)}</h3>
    <p class="failure-detail-sub"><strong>${escapeHtml(t.module)}</strong> · <code>${escapeHtml(t.file || '')}${t.line ? ':' + t.line : ''}</code>${t.retries ? ` · retried ${t.retries}×` : ''}${t.durationMs ? ` · ${Math.round(t.durationMs / 1000)}s` : ''}</p>
    ${aiSection}
    ${errors.length ? `<h4>Raw error</h4>${errors.map((e) => `<pre class="err-full">${escapeHtml(e)}</pre>`).join('')}` : ''}
    ${attachments.length ? `
      <h4>Screenshots <small class="muted">(click to enlarge)</small></h4>
      <div class="screenshot-grid">
        ${attachments.map((a) => `
          <figure class="shot" data-path="${escapeHtml(a.path)}" data-name="${escapeHtml(a.name || '')}">
            <img src="${escapeHtml(a.path)}" alt="${escapeHtml(a.name || 'screenshot')}" loading="lazy" />
            <figcaption>${escapeHtml(a.name || '')}</figcaption>
          </figure>
        `).join('')}
      </div>` : ''}
  `;
  body.querySelectorAll('.shot').forEach((fig) => {
    fig.addEventListener('click', () => openImageLightbox(fig.dataset.path, fig.dataset.name));
  });
  dlg.showModal();
}

function openImageLightbox(path, name) {
  const dlg = document.getElementById('image-lightbox');
  const img = document.getElementById('image-lightbox-img');
  const cap = document.getElementById('image-lightbox-caption');
  img.src = path;
  img.alt = name || '';
  cap.textContent = name || '';
  dlg.showModal();
}

function stripCtrl(s) {
  // Strip ANSI escape sequences + carriage returns that Playwright leaves
  // in JSON error messages.
  return String(s).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

function openBugDetail(bug) {
  const dlg = document.getElementById('bug-detail');
  const body = document.getElementById('bug-detail-body');
  const sev = severityFor(bug);
  body.innerHTML = `
    <h3><span class="bug-id">${bug.id}</span> <span class="badge ${sev}">${sev}</span>${bug.unverified ? ' <span class="badge unverified">unverified</span>' : ''}${bug.tripwireFired ? ' <span class="badge tripwire-fired">🎉 may be fixed</span>' : ''}</h3>
    <p>${escapeHtml(bug.title)}</p>
    <dl>
      <dt>Module</dt><dd>${escapeHtml(bug.module)}</dd>
      <dt>Default severity</dt><dd>${escapeHtml(bug.severity)}</dd>
      <dt>Effective severity</dt><dd>${escapeHtml(sev)}${state.overrides[bug.id] ? ' <em>(overridden in this browser)</em>' : ''}</dd>
      <dt>Automated tripwire</dt><dd>${bug.test ? `<code>${escapeHtml(bug.test)}</code>` : '<em>none yet — defect has no automated coverage</em>'}</dd>
      ${bug.testName ? `<dt>Test name</dt><dd><code>${escapeHtml(bug.testName)}</code></dd>` : ''}
      <dt>Manual TC</dt><dd>${bug.manualTC ? `<code>${escapeHtml(bug.manualTC)}</code>` : '<em>none</em>'}</dd>
    </dl>
    <p style="margin-top:16px;font-size:13px;color:var(--text-muted)">Full description, repro steps, and surfacing test live in <code>BUGS.md</code>.</p>
  `;
  dlg.showModal();
}

// ---- Controls -----------------------------------------------------------

function bindControls() {
  document.getElementById('reset-overrides').addEventListener('click', () => {
    if (!Object.keys(state.overrides).length) return;
    if (!confirm('Reset all severity overrides in this browser to the defaults from bug-severity.json?')) return;
    state.overrides = {};
    saveOverrides();
    render();
  });
  document.getElementById('filter-module').addEventListener('change', () => renderBugs(state.data.bugs));
  document.getElementById('filter-severity').addEventListener('change', () => renderBugs(state.data.bugs));
}

// ---- Helpers ------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
