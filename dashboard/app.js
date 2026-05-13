// Consentz dashboard — client-side renderer.
// Reads dashboard/data/results.json, applies localStorage severity overrides,
// renders the page. No build step.

const LS_KEY = 'consentz.dashboard.severityOverrides';
const SEVERITY_VALUES = ['critical', 'major', 'minor'];

let state = {
  data: null,
  overrides: {},   // bugId -> severity (string)
  doughnut: null,
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

  // Doughnut: severity distribution across all bugs
  renderDoughnut(d.bugs);

  // Module grid
  renderModules(d.modules, weights, thresholds);

  // Bug list (+ module filter populated from data)
  renderBugFilters(d.modules);
  renderBugs(d.bugs);

  // Failed tests
  renderFailures(d.modules);
}

function renderDoughnut(bugs) {
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const b of bugs) counts[severityFor(b)] = (counts[severityFor(b)] || 0) + 1;

  const ctx = document.getElementById('severity-doughnut');
  if (state.doughnut) state.doughnut.destroy();
  state.doughnut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'Major', 'Minor'],
      datasets: [{
        data: [counts.critical, counts.major, counts.minor],
        backgroundColor: ['#ef4444', '#f59e0b', '#6366f1'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        title: { display: true, text: `Bug severity (${bugs.length} total)`, padding: 8 },
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
    list.innerHTML = '<p style="color:var(--text-muted)">No failed tests on this run. 🎉</p>';
    return;
  }

  for (const t of failed) {
    const card = document.createElement('div');
    card.className = 'failure-card';
    card.innerHTML = `
      <h4>${escapeHtml(t.title)} <small style="color:var(--text-muted);font-weight:normal">— ${escapeHtml(t.module)}</small></h4>
      <div class="file">${escapeHtml(t.file || '')}${t.line ? ':' + t.line : ''}</div>
      ${t.retries ? `<div style="font-size:12px;color:var(--text-muted)">Retried ${t.retries}×</div>` : ''}
      ${t.errors && t.errors.length ? `<pre>${escapeHtml(t.errors.join('\n\n'))}</pre>` : ''}
      ${(t.attachments || []).map((a) => `<img src="../${escapeHtml(a.path)}" alt="${escapeHtml(a.name)}" />`).join('')}
    `;
    list.appendChild(card);
  }
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
