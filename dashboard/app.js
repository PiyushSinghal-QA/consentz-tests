// Consentz dashboard — client-side renderer.
// Reads dashboard/data/results.json, applies localStorage severity overrides,
// renders the page. No build step.

const LS_KEY = 'consentz.dashboard.severityOverrides';
const SEVERITY_VALUES = ['critical', 'major', 'minor'];

let state = {
  data: null,
  trend: null,     // { points: [...] } from data/trend.json
  overrides: {},   // bugId -> severity (string)
  charts: {},      // canvasId -> Chart instance
};

// ---- Boot --------------------------------------------------------------

(async function init() {
  state.overrides = loadOverrides();
  try {
    state.data = await fetchJson('data/results.json');
  } catch (e) {
    showError(`Could not load data/results.json (${e.message}). Run \`node tools/build-dashboard-data.js\` first.`);
    return;
  }
  // trend.json is optional — first-ever run won't have it
  state.trend = await fetchJson('data/trend.json').catch(() => ({ points: [] }));
  bindControls();
  render();
})();

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

function healthScore(bugList, weights) {
  let deduction = 0;
  for (const b of bugList) {
    const sev = severityFor(b);
    deduction += weights[sev] || 0;
  }
  return Math.max(0, 100 - deduction);
}

function healthClass(score, thresholds) {
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

  // Hero stats
  document.getElementById('overall-pass').textContent = d.overall.pass;
  document.getElementById('overall-fail').textContent = d.overall.fail;
  document.getElementById('overall-skipped').textContent = d.overall.skipped;
  document.getElementById('overall-total').textContent = d.overall.total;

  // Overall health = aggregate over ALL bugs
  const overallScore = healthScore(d.bugs, weights);
  const ring = document.getElementById('overall-health-ring');
  const cls = healthClass(overallScore, thresholds);
  ring.classList.remove('health-green', 'health-yellow', 'health-red');
  ring.classList.add(cls);
  document.getElementById('overall-health-score').textContent = overallScore;

  // Color the ring's conic-gradient (visual fill)
  const color = cls === 'health-green' ? '#10b981' : cls === 'health-yellow' ? '#f59e0b' : '#ef4444';
  const pct = overallScore;
  ring.style.background = `conic-gradient(${color} ${pct * 3.6}deg, var(--border) ${pct * 3.6}deg)`;

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
const testColors = ['#10b981', '#ef4444', '#9ca3af'];
const bugLabels  = ['Critical', 'Major', 'Minor'];
const bugColors  = ['#ef4444', '#f59e0b', '#6366f1'];

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
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        title: { display: true, text: total ? `${subtitle} (${total})` : subtitle, padding: 4, font: { size: 12 } },
        tooltip: {
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
    const score = healthScore(m.bugs, weights);
    const cls = healthClass(score, thresholds);
    const counts = { critical: 0, major: 0, minor: 0 };
    for (const b of m.bugs) counts[severityFor(b)] = (counts[severityFor(b)] || 0) + 1;
    const unverified = m.bugs.filter((b) => b.unverified).length;
    const automated = m.bugs.filter((b) => b.test).length;

    const card = document.createElement('div');
    card.className = `module-card ${cls}`;
    card.innerHTML = `
      <h3>
        <span>${escapeHtml(m.name)}</span>
        <span class="health">${score}</span>
      </h3>
      <div class="bar"><div style="width:${score}%"></div></div>
      <div class="module-stats">
        <span>${m.pass}/${m.total} passing</span>
        ${m.fail ? `<span style="color:var(--red)">${m.fail} failed</span>` : ''}
        ${m.skipped ? `<span>${m.skipped} skipped</span>` : ''}
      </div>
      <div class="module-stats" style="margin-top:6px">
        ${counts.critical ? `<span class="badge critical">${counts.critical} critical</span>` : ''}
        ${counts.major ? `<span class="badge major">${counts.major} major</span>` : ''}
        ${counts.minor ? `<span class="badge minor">${counts.minor} minor</span>` : ''}
        ${m.bugs.length === 0 ? `<span style="color:var(--text-muted);font-size:13px">No tracked defects</span>` : ''}
      </div>
      ${m.bugs.length ? `<div class="module-stats" style="margin-top:6px;font-size:12px;color:var(--text-muted)">
        <span title="Bugs with an automated tripwire test">${automated}/${m.bugs.length} automated</span>
        ${unverified ? `<span class="badge unverified" title="Original report needs reproduction on current build">${unverified} unverified</span>` : ''}
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
      <td>${escapeHtml(b.title)}${b.unverified ? ' <span class="badge unverified" title="Original report needs reproduction on the current build">unverified</span>' : ''}</td>
      <td>${coverageBadge(b)}</td>
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
    return `<span class="badge coverage-auto" title="Tripwire test: ${escapeHtml(bug.test)}">🤖 automated</span>`;
  }
  if (bug.manualTC) {
    return `<span class="badge coverage-manual" title="Manual TC: ${escapeHtml(bug.manualTC)}">📝 manual TC</span>`;
  }
  return `<span class="badge coverage-none" title="No test maps to this defect yet">⚠ no test</span>`;
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
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Pass rate %',
          data: passRateData,
          yAxisID: 'y',
          borderColor: '#10b981',
          borderDash: [4, 4],
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
        {
          label: 'Bug count',
          data: bugTotalData,
          yAxisID: 'y2',
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
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
        y:  { position: 'left',  min: 0, max: 100, title: { display: true, text: 'Health / Pass rate (%)' } },
        y2: { position: 'right', min: 0, beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Bug count' } },
        x:  { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      },
    },
  });
}

// ---- Failures + lightbox -----------------------------------------------

function renderFailures(modules) {
  const list = document.getElementById('failures-list');
  list.innerHTML = '';

  const failed = [];
  for (const m of modules) {
    for (const t of m.tests || []) {
      if (t.status === 'failed') failed.push({ ...t, module: m.name });
    }
  }

  if (failed.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted)">No failed tests on this run.</p>';
    return;
  }

  for (const t of failed) {
    const card = document.createElement('div');
    card.className = 'failure-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open failure details for ${t.title}`);

    const firstErr = stripCtrl((t.errors || [])[0] || '');
    const errPreview = firstErr.split('\n').slice(0, 3).join('\n');
    const thumbCount = (t.attachments || []).length;

    card.innerHTML = `
      <h4>${escapeHtml(t.title)} <small class="failure-mod">— ${escapeHtml(t.module)}</small></h4>
      <div class="file">${escapeHtml(t.file || '')}${t.line ? ':' + t.line : ''}</div>
      ${t.retries ? `<div class="retries">Retried ${t.retries}×</div>` : ''}
      ${errPreview ? `<pre class="err-preview">${escapeHtml(errPreview)}${firstErr.split('\n').length > 3 ? '\n…' : ''}</pre>` : ''}
      <div class="failure-meta">
        ${thumbCount ? `<span class="failure-thumb-count">📷 ${thumbCount} screenshot${thumbCount === 1 ? '' : 's'}</span>` : '<span class="muted">no screenshot</span>'}
        <span class="failure-open">Open details →</span>
      </div>
    `;
    card.addEventListener('click', () => openFailureDetail(t));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFailureDetail(t); }
    });
    list.appendChild(card);
  }
}

function openFailureDetail(t) {
  const dlg = document.getElementById('failure-detail');
  const body = document.getElementById('failure-detail-body');
  const errors = (t.errors || []).map(stripCtrl);
  const attachments = t.attachments || [];

  body.innerHTML = `
    <h3>${escapeHtml(t.title)}</h3>
    <p class="failure-detail-sub"><strong>${escapeHtml(t.module)}</strong> · <code>${escapeHtml(t.file || '')}${t.line ? ':' + t.line : ''}</code>${t.retries ? ` · retried ${t.retries}×` : ''}${t.durationMs ? ` · ${Math.round(t.durationMs / 1000)}s` : ''}</p>
    ${errors.length ? `<h4>Errors</h4>${errors.map((e) => `<pre class="err-full">${escapeHtml(e)}</pre>`).join('')}` : ''}
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
    <h3><span class="bug-id">${bug.id}</span> <span class="badge ${sev}">${sev}</span>${bug.unverified ? ' <span class="badge unverified">unverified</span>' : ''}</h3>
    <p>${escapeHtml(bug.title)}</p>
    <dl>
      <dt>Module</dt><dd>${escapeHtml(bug.module)}</dd>
      <dt>Default severity</dt><dd>${escapeHtml(bug.severity)}</dd>
      <dt>Effective severity</dt><dd>${escapeHtml(sev)}${state.overrides[bug.id] ? ' <em>(overridden in this browser)</em>' : ''}</dd>
      <dt>Automated tripwire</dt><dd>${bug.test ? `<code>${escapeHtml(bug.test)}</code>` : '<em>none yet — defect has no automated coverage</em>'}</dd>
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
