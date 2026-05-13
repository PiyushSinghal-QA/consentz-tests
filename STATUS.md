# Consentz Test Automation — Status Report

**Project:** Consentz E2E Test Suite (staging.consentz.com)
**Author:** Piyush Singhal
**Last updated:** 2026-05-06
**Audience:** Engineering & QA stakeholders

---

## 1. Executive summary

A Playwright-based E2E test suite has been bootstrapped against `staging.consentz.com` covering authentication, the entire dashboard module, and breadth-coverage page smokes for every super-user-reachable URL (59 pages across 12 modules). The framework runs in headless / headed mode, records video + traces on failure, integrates with Allure reporting, and includes a four-channel error-capture helper (console, HTTP, page-error, UI flash via MutationObserver).

The suite has surfaced **20 application defects** (K1-K20 in §6) that were not previously tracked. 13 of them have automated regression tests; the remaining 7 are tracked manual-only either because the affected module isn't yet in the automation scope (K12 Reports parity; K14/K15 Subscription; K16/K17 Auth) or because the failure mode needs a deterministic repro / stable selector before automation pays off (K11 chart-init race; K18 Library "selected" indicator). The suite stays green by tagging known defects as expected-failure (`test.fail()`) — any regression to a passing state OR a new break is detected automatically. Every K-bug has a detailed manual reproduction document.

A formal test plan covers the dashboard exhaustively: **247 one-liner test cases** organised across 9 sub-features and 11 quality dimensions, with per-TC manual reproduction stub files. A recent consolidation pass clubbed structurally-redundant cases (e.g. cross-browser + responsive viewport into a single cross-cutting case) without dropping coverage.

---

## 2. Headline metrics

| Metric | Value |
|---|---|
| Automated tests in suite | **140** automated TC IDs (auth + dashboard + calendar + patients + cross-cutting smokes) |
| Pages covered by smoke | **59 of 59** (every super-user-reachable URL) |
| Defects discovered & tracked | **20** (K1-K20) — every K-bug has a manual TC; 13 also have automated regressions |
| Browsers configured | Chromium (Firefox/Edge/Safari pending re-enable) |
| Average full-suite run time | ~12 minutes |
| Catalogued test cases | 247 (Dashboard) + 282 (Calendar / Patients / Messaging — drafted 2026-05-07) + 59 (Smoke) = **588** |
| Suite-level auto coverage | **24%** (140 / 588) — denominator grew with the new CTO-priority modules |
| Modules with test plans drafted | Auth, Dashboard, Calendar, Patients, Messaging, Smoke (cross-cutting) |

> All numbers in this document are auto-derived from `Manual/Feature-Registry.csv`, which is regenerated from the testplan files via `node tools/regenerate-registry.js`.

---

## 3. Test suite inventory

```
Consentz/
├─ Automation/                 ← all Playwright code (cd here to run tests)
│   ├─ tests/
│   │   ├─ auth/                   3 specs   (login, logout, negative cases)
│   │   ├─ dashboard/              specs for time-period, page-identity,
│   │   │                                     refresh, robustness, widget library,
│   │   │                                     known-bug regressions (widgets +
│   │   │                                     clinic switch)
│   │   ├─ page-smokes.spec.ts     1 spec    (parametrized — 59 pages)
│   │   └─ utils/                  page-checks + page-noise helpers
│   ├─ scripts/explore/             env-gated crawlers — NOT run by `npm test`,
│   │                               invoked via `npm run explore:*`
│   │                               (see playwright.explore.config.ts)
│   │   └─ utils/
│   │       ├─ page-checks.ts      assertPageLoaded helper (URL + content)
│   │       └─ page-noise.ts       four-channel error capture (console / HTTP /
│   │                              page-error / UI flash via MutationObserver)
│   ├─ pages/                      Page Object Models (LoginPage, DashboardPage)
│   ├─ test-data/
│   │   ├─ users.ts                demo / invalid user fixtures
│   │   └─ widgets.ts              26-widget WIDGET_LIBRARY catalogue +
│   │                              KNOWN_BROKEN_WIDGETS allow-list (K2/K3/K4)
│   ├─ playwright.config.ts        single-worker (demo session quirk), Allure +
│   │                              HTML reporting, 1 retry locally / 2 in CI
│   └─ tsconfig.json               ES2020 / strict
├─ Manual/                     ← test plan + manual reproduction docs
│   ├─ TESTPLAN.md             IEEE-829-style master plan + K-bug catalogue
│   ├─ Feature-Registry.csv    auto-regenerated index of every plan + counts
│   └─ testplan/
│       ├─ TEMPLATE.txt            page test plan template
│       ├─ TEMPLATE_TC.txt         manual test case template
│       ├─ Dashboard/
│       │   ├─ DASH.001/           Time Period Filter   — Testplan + 35 TC files
│       │   ├─ DASH.002/           Page Identity        — Testplan + 24 TC files
│       │   ├─ ...                 (sub-features 003-009, one folder each)
│       │   └─ DASH.009/           Robustness           — Testplan + 22 TC files
│       └─ Smoke/
│           └─ SMOKE.001/          Per-Page Load Smoke  — Testplan + 59 TC files
├─ tools/
│   ├─ regenerate-registry.js  refresh Feature-Registry.csv from plans
│   └─ sync-stub-tcs.js        keep per-TC stub files aligned with plan edits
├─ STATUS.md                   project-level status (this document)
├─ CLAUDE.md                   repo-level engineering notes
└─ README.md                   project overview
```

---

## 4. Coverage scorecard — Dashboard module

| Sub-feature                       | Cases | Automated | Manual / TBD | Auto % |
|----------------------------------|------:|----------:|-------------:|-------:|
| **Dashboard module**             |       |           |              |        |
| .001 Time Period Filter          |    35 |        11 |           24 |    31% |
| .002 Page Identity & Chrome      |    25 |        10 |           15 |    40% |
| .003 Refresh Button              |    19 |         7 |           12 |    37% |
| .004 Export PDF                  |    25 |         2 |           23 |     8% |
| .005 Add Widget / Widget Library |    38 |        17 |           21 |    45% |
| .006 Widget Grid & Per-Widget    |    31 |         3 |           28 |    10% |
| .007 Welcome Modal & Watch Intro |    25 |         0 |           25 |     0% |
| .008 Clinic Switcher             |    27 |        10 |           17 |    37% |
| .009 Robustness                  |    22 |         2 |           20 |     9% |
| **Dashboard subtotal**           | **247** |    **62** |      **185** | **25%** |
| **Calendar module** *(new, CTO-priority)* | | | | |
| CAL.001 Book Appointment         |    54 |         5 |           49 |     9% |
| CAL.002 Calendar Grid & Nav      |    23 |         4 |           19 |    17% |
| **Calendar subtotal**            | **77**  |     **9** |       **68** | **12%** |
| **Patients module** *(new, CTO-priority)* | | | | |
| PAT.001 Patients List Page       |    21 |         7 |           14 |    33% |
| PAT.002 Add Patient              |    44 |         0 |           44 |     0% |
| PAT.003 Patient Search           |    32 |         3 |           29 |     9% |
| **Patients subtotal**            | **97**  |    **10** |       **87** | **10%** |
| **Messaging module** *(new, CTO-priority — plans only)* | | | | |
| MSG.001 Per-record Send Icons    |    40 |         0 |           40 |     0% |
| MSG.002 Email Builder            |    20 |         0 |           20 |     0% |
| MSG.003 Campaign Manager         |    23 |         0 |           23 |     0% |
| MSG.004 Correspondence Log       |    14 |         0 |           14 |     0% |
| MSG.005 Settings → Messaging     |    11 |         0 |           11 |     0% |
| **Messaging subtotal**           | **108** |     **0** |      **108** |     0% |
| Page-load smoke (cross-cutting)  |    59 |        59 |            0 |   100% |
| **Suite total**                  | **588** |   **140** |      **448** |  **24%** |

> Counts above are auto-regenerated from `Manual/testplan/**/Testplan_*.txt` by `tools/regenerate-registry.js`. Full breakdown also lives in `Manual/Feature-Registry.csv` (open in Excel / Sheets).

**Coverage philosophy.** Automation prioritises the **Default settings** and **Functionality** sections (highest-frequency regression points). **Accessibility**, **Cross-browser**, **Performance**, and **Security** sections are intentionally manual until a separate accessibility scan project (axe / Lighthouse) and a multi-browser test matrix are stood up — automating those poorly is worse than tracking them as scheduled manual passes.

**Bug discipline.** Per project policy, every defect has BOTH lanes: an automated regression test (where automation is feasible) AND a detailed manual reproduction document. K2/K3/K4 (widget silent-fails) and K9/K10 (clinic-switch JS exceptions) each got dedicated automated regressions in this pass.

---

## 5. What the automation actually catches

Every dashboard automated test is tagged with its TC ID for traceability. To filter by sub-feature:

```bash
npx playwright test --grep "@TC.DASH.001"   # Time Period Filter only
npx playwright test --grep "@TC.DASH.005"   # Widget Library only
npx playwright test --grep "@TC.SMOKE.001"  # Every page smoke
npx playwright test --grep "@BUG:K1"        # K1 regression only
```

Concrete classes of regression caught:
- **Page-render-blank bugs** — every page asserts URL + visible content; an empty 200 fails the smoke.
- **Network and console noise** — any 4xx/5xx XHR or `console.error` triggers a fail (with documented third-party ignore list).
- **UI error flashes** — a `MutationObserver` catches any `.alert-danger` / `.toast-error` / `[role="alert"]` element ever inserted into the DOM, even if it auto-dismisses in <2 seconds.
- **Widget add/remove regressions** — DASH.005.037 walks all 26 Library widgets and verifies each can be added → renders → removed. Per-widget bug regressions (K2/K3/K4) sit alongside in `known-bug-widgets.spec.ts`.
- **Clinic-switch JS exceptions** — K9/K10 each have a dedicated `pageerror` listener test in `known-bug-clinic-switch.spec.ts`; the broader noise check explicitly ignores them so it can still detect new regressions.
- **K-bug regressions** — every known defect has a tagged test that's expected-fail; if the defect is fixed, the test reports an **unexpected pass** so we can update the catalogue.

---

## 6. Defect catalogue (K-bugs)

> **Canonical location:** [`BUGS.md`](BUGS.md) — full table of K1–K22 with severity, surfacing test refs, and triage notes. Maintain there.

Summary as of the latest update:

- **22 defects open** (K1–K22)
- **4 Critical**: K8 (CKEditor missing), K12 (metric drift dashboard↔reports), K15 (default payment card deletable), K21 (Add Patient 5xx on firstName ≥46 chars)
- **13 surfaced by automated regression tests** — the others are tracked manual-only because the affected module is out of automation scope or the failure mode isn't deterministic enough yet

---

## 7. Roadmap

> **2026-05-07 update.** Sprint 2 was redirected by direct CTO escalation — see §11 below for the customer-pain prioritisation that now drives the next 6 weeks.

### Sprint 2 (next) — DRIVEN BY CTO ESCALATION
| Module | Priority | Why |
|---|---|---|
| **API/data factory layer** | P0 | Hard precondition for every CTO-priority surface — patient/appointment/message creation + tag-based teardown |
| **Calendar — Book Appointment** | P0 | Highest business risk: wrong-time bookings = lost customers (CTO concern #3) |
| **Patients — Add + Search** | P0 | Patient is upstream of every other flow (CTO concerns #4, #5, #6) |

### Sprint 2 (originally planned — now folded into Sprint 3+)
| Module | Priority | Why |
|---|---|---|
| **Topbar** | P0 | "Refer a Clinic" + icon row appear on every page; covering once de-risks every other module |
| **Auth – additional negatives** | P1 | Edge cases (locked accounts, password reset, MFA if enabled) |

### Sprint 3-4
- Calendar (appointment CRUD)
- Invoices / Payments / Refunds
- Multi-browser project re-enabled (Firefox + Edge)

### Sprint 5-6
- Cross-module user journey tests (`tests/flows/`) — book appointment → send consent → receive payment
- Mobile / tablet viewport project
- Accessibility automation (axe-playwright integration)

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Single demo account, single-session enforcement | High | `workers: 1` config; 4 staging quirks documented in memory; per-worker auth blocked until additional demo accounts exist. |
| Staging rate limit (4-5 logins / 3 min) | Medium | `LoginPage` auto-detects and waits; tests bump timeout to `LOGIN_TEST_TIMEOUT` (5 min). |
| Page-render-blank bug class | Medium | `assertPageLoaded()` requires URL + visible content; smoke catches every nav-reachable page. |
| Transient UI errors that flash and auto-dismiss | Medium | `MutationObserver` injected via `addInitScript` records every error element insertion regardless of how briefly it stays in the DOM. |
| Single browser (Chromium only) | Medium | Cross-browser project re-enable scheduled Sprint 3-4. |
| K-bug count growing without fixes | Tracked | Each K-bug has a regression test + detailed manual TC. Recommend weekly triage with engineering. |

---

## 9. How to run the suite

All commands run from inside `Automation/`:

```bash
cd Automation

# Setup (one-time)
npm install
npx playwright install --with-deps
cp .env.example .env  # then fill in CONSENTZ_USERNAME / CONSENTZ_PASSWORD

# Full suite
npm test                    # headless
npm run test:headed         # visible browser
npm run test:ui             # Playwright UI mode (best for development)

# Filter by tag
npx playwright test --grep "@TC.DASH"
npx playwright test --grep "@TC.SMOKE.001"
npx playwright test --grep "@BUG:K"

# Crawlers (manual run, sourced for nav-tree + page exploration)
npm run explore:nav         # refreshes nav-tree.json (drives page-smokes)
npm run explore:all-pages   # dumps every reachable page's structure

# Reporting
npm run test:report         # HTML report
allure generate allure-results --clean -o allure-report && allure open
```

After any test plan edit, refresh both the registry and per-TC stubs:

```bash
node tools/regenerate-registry.js   # rewrites Manual/Feature-Registry.csv
node tools/sync-stub-tcs.js         # creates / updates / deletes per-TC stubs
```

---

## 10. Document references

- `Manual/TESTPLAN.md` — IEEE-829 master plan, scope, schedule, K-bug catalogue (formal)
- `Manual/Feature-Registry.csv` — one-row-per-feature index with current counts
- `Manual/testplan/Dashboard/DASH.<NNN>/Testplan_DASH.<NNN>.txt` — per-sub-feature plans (one per sub-feature)
- `Manual/testplan/Calendar/CAL.<NNN>/Testplan_CAL.<NNN>.txt` — Calendar plans (CTO-priority, drafted 2026-05-07)
- `Manual/testplan/Patients/PAT.<NNN>/Testplan_PAT.<NNN>.txt` — Patients plans (CTO-priority, drafted 2026-05-07)
- `Manual/testplan/Messaging/MSG.<NNN>/Testplan_MSG.<NNN>.txt` — Messaging plans (CTO-priority, drafted 2026-05-07)
- `Manual/testplan/<Module>/<MODULE>.<NNN>/TC.<MODULE>.<NNN>.<MMM>.txt` — per-TC manual reproduction stubs
- `Manual/testplan/Smoke/SMOKE.001/Testplan_SMOKE.001.txt` — page-load smoke catalogue
- `CLAUDE.md` — repo-level engineering notes
- `Automation/nav-tree.json` — captured side-nav tree (66 URLs)
- `Automation/cto-flows-probe.json` — full structural probe of CTO-flagged surfaces (regenerate via `npm run explore:cto`)

---

## 11. CTO escalation response — 2026-05-07

### 11.1 Scope

The Consentz CTO directly flagged five customer-pain areas as recurring breakage points:

1. *(de-prioritised by user)* Login + OTP
2. **Sending messages/emails** — high variance, especially in-record send icons on Patients / Prospects / Clinics
3. **Calendar Book Appointments** — double bookings, wrong-time bookings, confirmation emails not received
4. **Adding patients** — creation flow reportedly broken
5. **Patient search** — should be fast
6. **Calendar's in-line patient search + booking** — overlaps with #3 + #5 but typically a separate code path

### 11.2 What was done in the first 48 hours (2026-05-06 → 2026-05-07)

| Step | Artefact |
|---|---|
| Drove every flagged surface against staging — read-only, no data mutated | `Automation/scripts/explore/cto-flows.spec.ts` + `cto-flows-probe.json` (12 surfaces, 241 KB structural dump) |
| Drafted 10 new sub-feature test plans following existing META-block + section conventions | `Manual/testplan/{Calendar,Patients,Messaging}/...` — 282 new TCs catalogued |
| Shipped first concrete automation against Calendar + Patients | `Automation/pages/CalendarPage.ts` + `tests/calendar/booking-smoke.spec.ts` + `tests/patients/patients-smoke.spec.ts` (19 TCs, all green) |
| Identified K9 + K10 also fire on calendar load (broader scope than the original clinic-switch attribution) | Ignore list now sourced from `tests/known-bugs.ts` registry |
| Auto-reflected the new module structure in `Manual/Feature-Registry.csv` | `node tools/regenerate-registry.js` |

### 11.3 Sprint plan (6 weeks)

| Sprint | Window | Focus | Deliverable |
|---|---|---|---|
| **A** | Week 1-2 | Foundation + Calendar | API client + factories + mailbox adapter; CAL.001 happy path + DST/timezone matrix |
| **B** | Week 3-4 | Patients + email delivery | PAT.002/PAT.003 with perf budgets; CAL.001 confirmation email + double-booking via concurrent API POSTs |
| **C** | Week 5-6 | Messaging | MSG.001 (staff-chat icons) + MSG.002-003 (Email Builder + Campaign Manager) |

### 11.4 Open clarifications needed from CTO (blocking)

| # | Question | Why it blocks |
|---|---|---|
| 1 | What is "the icons on chat messaging labels (Patients / Prospects / Clinics)"? Staff-chat widget recipient-type tabs OR per-record send icons OR something else? | MSG.001 scope — week of work either way |
| 2 | Patient-search SLA — what number is "fast"? p95 ≤ 500 ms time-to-first-result is the suggested baseline | PAT.003 perf-budget assertions |
| 3 | Email-delivery verification — Mailtrap, MailHog, or existing test-SMTP infra? | CAL.001.019 confirmation email + MSG.001.016 delivery verification |

### 11.5 Open ask of the dev team

**Add `data-testid` attributes** to every send-icon, every modal close button, every primary action. Zero `data-testid` exist app-wide today (`testIds: []` on every probed surface). Form-input ids are stable; icon-only buttons and dropdown triggers are not. This selector debt slows every test we write and rots existing tests when CSS classes refactor.
