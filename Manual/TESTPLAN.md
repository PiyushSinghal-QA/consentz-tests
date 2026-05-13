# Test Plan — Consentz E2E Automation

## 1. Document control

| Item            | Value                                              |
|-----------------|----------------------------------------------------|
| Document        | Consentz E2E Test Plan                             |
| Version         | 1.0 (initial draft)                                |
| Date            | 2026-05-04                                         |
| Author          | Piyush Singhal                                     |
| Status          | Draft — pending review                             |
| Application     | Consentz Web App — `https://staging.consentz.com`  |
| Repository      | `C:\Consentz` (Playwright + TypeScript)            |
| Reviewer / Approver | TBD                                            |

### 1.1 Revision history

| Version | Date       | Author   | Change                                |
|---------|------------|----------|---------------------------------------|
| 1.0     | 2026-05-04 | A. Singhal | Initial draft based on staging crawl |

---

## 2. Introduction

### 2.1 Purpose

This document defines the strategy, scope, environment, and execution
plan for end-to-end automated testing of the Consentz web application
using Playwright. It is the reference for what we test, how we test,
when a build is releasable, and how defects flow.

### 2.2 Audience

Engineers writing or maintaining E2E tests; the QA lead reviewing
coverage; engineering management approving releases against this plan.

### 2.3 Background

Consentz is a clinic-management SaaS used by aesthetic / medical clinics
for appointments, patients, billing, marketing, and stock control. The
web app is clinic-scoped — every URL takes the form
`/admin/clinics/{clinicId}/<section>` — and is currently tested only
against the **staging** environment.

The automation framework (Playwright 1.44 + TypeScript) is already in
place with the auth and dashboard suites passing. This plan captures the
strategy to extend coverage to the rest of the super-user surface area,
informed by a structural crawl of 63 super-user pages dumped to
`pages-explore.ndjson`.

### 2.4 References

- `README.md` — framework setup
- `CLAUDE.md` — agent guidance for working with this repo
- `Automation/scripts/explore/all-pages.spec.ts` — the crawler (run via `npm run explore:all-pages`)
- `pages-explore.ndjson` — raw structural dump (gitignored)
- `dashboard-structure.json`, `dashboard-screenshot.png`,
  `dashboard-html.html` — dashboard-specific exploration outputs
- Memory files in `~/.claude/projects/C--Consentz/memory/`:
  - `staging_auth.md`
  - `staging_dashboard.md`
  - `demo_account.md`
  - `feedback_page_load_assertions.md`

### 2.5 Glossary

| Term | Meaning |
|------|---------|
| AUT | Application Under Test (Consentz staging) |
| POM | Page Object Model |
| CRUD | Create, Read, Update, Delete |
| GRN | Goods Received Note |
| PS  | PaymentSense (payment-processor integration) |
| CQC | Care Quality Commission (UK clinical compliance reports) |

---

## 3. Scope

### 3.1 In scope

- All UI surfaces reachable from the **super-user** demo account's
  navigation: 63 pages across Dashboard, Top-bar, Marketing, Stock,
  Business, Reports, Setup, Settings, Logs, and the user dropdown.
- Authentication flows (login, logout, session expiry, post-logout
  redirects).
- Cross-cutting concerns: page-load integrity, modals, clinic switching,
  redirects.
- Regression coverage for known staging defects (e.g. the Blockers 500).
- Reporting via Playwright HTML and Allure.

### 3.2 Out of scope (this revision)

- **Non-super-user roles** — Practitioner, Coordinator, Patient-facing
  portal. Their screens differ; covering them requires additional test
  accounts and is planned for a later revision.
- **Patient-facing public widget** at the unauthenticated booking URL.
- **Mobile / tablet viewports** — desktop Chromium only. Firefox is
  configured but commented out until Chromium is fully stable.
- **Stripe billing portal** at `billing.stripe.com` — the
  `/admin/profile/subscription` redirect lands there; we assert the host
  but do not interact with Stripe's UI.
- **Performance / load testing** — different tool, different effort.
- **Accessibility (a11y) auditing** — not yet automated; can be added
  later via `@axe-core/playwright`.
- **Visual / screenshot regression** — snapshot diffs are out of scope
  until the markup is more stable.
- **Backend API contract testing** — separate effort.
- **Production environment** — tests target staging only.

### 3.3 Assumptions

- The staging demo credentials (`demo` / `password`) and the demo clinic
  (`Beautify Clinic`, id `3`) remain valid for the duration of this plan.
- Staging is broadly available during business hours, with intermittent
  slowness already accounted for in our timeouts.
- The framework's existing rate-limit / single-session mitigations
  (`workers: 1`, `LoginPage.LOGIN_TEST_TIMEOUT`, multi-strategy submit)
  remain in place until a second test account is provisioned.

---

## 4. Test approach

### 4.1 Test levels

| Level | Coverage | Tool |
|-------|----------|------|
| Unit  | Out of scope for this plan | (handled in app codebase) |
| Integration | Out of scope | (handled in app codebase) |
| **End-to-End** | **In scope** — full browser, real staging | Playwright |
| Manual exploratory | Ad-hoc, by author | Browser |

### 4.2 Test types

| Type | Approach |
|------|----------|
| Smoke | Page loads + key elements render. P0 priority for every section. |
| Functional | Primary user journeys (CRUD, search, filter, tab switching). |
| Regression | Bugs we've seen and fixed get a permanent test (e.g. the multi-strategy login submit, the K1 500). |
| Negative | Invalid inputs, empty submissions, expired sessions, missing permissions. |
| Cross-browser | Chromium now; Firefox / WebKit phased in once Chromium suite is stable. |
| Visual | Out of scope this revision (markup churn too high). |

### 4.3 Test design

- **Page Object Model** — every page gets a POM in `Automation/pages/`. Tests
  consume POM methods, not raw selectors.
- **Shared base helpers** to avoid duplication across the dozens of
  list-style pages: introduce `ListPagePOM`, `TabbedPagePOM`,
  `EntityFormPOM` once two or more concrete POMs exist that need them.
- **Page-load assertions** must check URL **and** that visible content
  rendered, never URL alone — see `Automation/tests/utils/page-checks.ts`. This is
  enforced because Consentz pages have been observed to serve a correct
  URL with an empty body when JS bootstrap fails.
- **Test data isolation** — entities created by tests are prefixed with
  `pwt-` and a short UUID, then cleaned up at end of test. Prevents
  cross-test pollution on the shared demo clinic.
- **Independent tests** — each test sets up its own state; tests must
  not depend on the order of execution.

### 4.4 Selector strategy

Priority order for picking a locator:

1. Stable IDs (`#refresh-dashboard`, `#add-widget-btn`, …) — observed
   to be plentiful on Consentz.
2. ARIA roles via `getByRole(...)`.
3. Visible text via `getByText(...)` with strict regex.
4. Distinctive class names (`.navbar-avatar`, `.widget-container`).
5. Avoid fragile DOM-position selectors (`nth-child`, deep CSS chains).

**`data-testid` attributes are absent from Consentz markup.** All
selectors lean on whatever stable hooks the app already provides.

### 4.5 Conventions

- Each spec is < ~10 tests. One area, one file.
- `test.beforeEach` performs minimum setup; heavy setup goes in
  fixtures (`test.extend`) or dedicated setup projects.
- No hard `waitForTimeout` calls except where Bootstrap animations
  genuinely need it — auto-retrying assertions are preferred.
- No `console.log` in committed tests.
- Comments explain *why*, not *what*.

---

## 5. Test environment

### 5.1 Application under test

- **URL**: `https://staging.consentz.com`
- **Default landing**: `/admin/clinics/3/dashboard` (Beautify Clinic)
- **Demo account**: `demo` / `password` (super-user across 9 clinics)

### 5.2 Framework

| Item | Value |
|------|-------|
| Test runner | `@playwright/test` ^1.44 |
| Language | TypeScript (target ES2020, strict mode) |
| Node | ≥ 20 |
| Workers | 1 (locked until a second demo account is available) |
| Retries | 1 locally, 2 in CI |
| Timeouts | 60 s per test, 20 s per action, 45 s per navigation |
| Auth state | Persisted to `playwright/.auth/user.json` by `auth.setup.ts` |

### 5.3 Browsers / devices

- **Chromium** (Desktop Chrome) — active.
- **Firefox** (Desktop Firefox) — configured but commented out in
  `Automation/playwright.config.ts` until Chromium is rock-solid.
- **WebKit** — not configured yet.
- **Mobile viewports** — out of scope.

### 5.4 Reporters

- `list` — terminal output.
- `html` — Playwright HTML report (`playwright-report/`).
- `allure-playwright` — Allure results (`allure-results/`); rendered
  with `npm run allure:report` (requires Java for the CLI).

### 5.5 Test data and accounts

- Single demo user (`demo` / `password`).
- 9 clinics on the demo account; default is `Beautify Clinic` (id 3).
- Tests create their own throwaway data with a `pwt-` prefix and
  clean up afterwards.
- Sensitive data is **not** committed: `.env` is gitignored;
  `.env.example` provides the template.

### 5.6 Known environment constraints

These are documented in detail in the memory files; in summary:

| Constraint | Impact | Mitigation |
|------------|--------|-----------|
| Demo account allows only one active session | Parallel logins kill each other mid-test | `workers: 1`; logout tests do their own login |
| Login rate limit ≈ 4–5 attempts per ~3 min | Suite can lock itself out | `LoginPage.login()` detects "Too many attempts" and hard-waits; tests using UI login extend their per-test timeout to `LOGIN_TEST_TIMEOUT` (5 min) |
| Staging login form occasionally silently no-ops | Submit click eaten before JS attaches | `LoginPage.submitLoginForm` rotates 3 strategies (Enter → click → DOM `form.submit()`) |
| Pages can load with empty body | URL match passes but UI is broken | All page-load assertions use `assertPageLoaded(page, { url, content? })` from `Automation/tests/utils/page-checks.ts` |
| `load` event slow due to analytics scripts | `goto` times out at 45 s on healthy pages | Use `waitUntil: 'domcontentloaded'` in navigation |
| Welcome modal can pop on any page | Blocks clicks on subsequent actions | `dashboard.dismissWelcomeModal()`; promote to a base POM |

---

## 6. Roles and responsibilities

| Role | Responsibility |
|------|---------------|
| **Test Engineer** | Write specs, maintain POMs, triage failures, keep the suite green. |
| **QA Lead / Reviewer** | Review test plan and significant additions; sign off on releases against this plan. |
| **Engineering** | Fix application defects raised by automation; provide stable hooks (`data-testid`) where requested. |
| **DevOps / Platform** | Provision the second demo account; raise / lower rate-limit thresholds for test users; CI configuration. |

(Names are TBD until the team is staffed.)

---

## 7. Entry and exit criteria

### 7.1 Entry criteria — when a build is testable

A build is ready for E2E testing once **all** of the following hold:

- Staging is deployed and `staging.consentz.com` serves HTTP 200 on
  `/admin/login`.
- Demo credentials successfully authenticate manually (single sanity
  login).
- Demo account is **not** currently rate-limited.
- The framework's `auth.setup.ts` succeeds within its retry budget.

### 7.2 Exit criteria — when testing is complete for a release

A release passes the E2E gate once **all** of the following hold:

- 100 % of P0 scenarios pass (no flaky retries permitted).
- ≥ 95 % of P1 scenarios pass on first attempt (flaky retries allowed
  but flagged in Allure).
- All scenarios linked to known regression bugs (currently K1) pass.
- No new P0 or P1 defects are open with `severity: blocker`.
- Allure report is generated, archived, and reviewed.

### 7.3 Suspension criteria — stop testing if

- Staging returns 5xx on the login page or dashboard for > 10 min.
- Demo account is rate-limited for > 1 hour and cannot be cleared.
- A previously green P0 starts failing across all branches —
  investigate before continuing.
- The framework itself becomes unstable (e.g. a Playwright upgrade
  breaks fixtures); halt and fix the framework.

### 7.4 Resumption criteria

Testing resumes once the suspension cause is cleared and a smoke run
of all P0 scenarios passes.

---

## 8. Pass / fail criteria

### 8.1 Test-level

- **Pass**: all assertions pass without manual intervention; test
  completes within its timeout; no unhandled console errors.
- **Fail**: any assertion fails, the test times out, or the test
  raises an unhandled exception.
- **Flaky**: passes only on retry. Allowed for P2 scenarios; tracked
  and addressed for P0 / P1.

### 8.2 Suite-level

A suite passes when every P0 and P1 test passes; P2 flakes do not
block the suite but produce a tracking issue.

### 8.3 Release-level

See § 7.2.

---

## 9. Risks and mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | Single demo account creates rate-limit and session-conflict bottlenecks | High | Slows suite, flakes | `workers: 1`, auto-wait on rate limit; long-term: provision second account |
| R2 | Markup changes break selectors | Medium | Cascading failures | Lean on stable IDs; isolate selectors in POMs; ask engineering for `data-testid`s on new components |
| R3 | Staging instability (5xx, timeouts) | Medium | False-negative failures | Retries on transient failures; suspension criteria; recoverable timeout config |
| R4 | Test data pollution on demo clinic | Medium | Order-dependent flakes | `pwt-` prefix + cleanup; idempotent reads where possible |
| R5 | New super-user features added without test coverage | Medium | Coverage debt | Quarterly re-crawl with `npm run explore:all-pages`; diff against this plan |
| R6 | Framework / Playwright upgrade breaks suite | Low | Blocked progress | Pin versions; staged upgrades on a branch |
| R7 | Allure CLI Java requirement absent in CI | Low | No HTML report | Document requirement; fall back to Playwright HTML if Java unavailable |
| R8 | Demo account password rotated / clinic deleted | Low | Whole suite breaks | Document re-provisioning; keep `.env.example` accurate |

---

## 10. Defect management

### 10.1 Severity levels

| Level | Definition | Example |
|-------|-----------|---------|
| **Blocker** | Core flow unusable; release impossible | Login broken; dashboard 500; cannot create invoice |
| **Critical** | Major feature broken with no workaround | Cannot create patient; payment refund fails |
| **Major** | Feature broken with workaround OR cosmetic on a P0 path | Search returns wrong results but listing works |
| **Minor** | Cosmetic; doesn't affect functionality | Misaligned button; typo |

### 10.2 Defect flow

1. Test fails → Allure / HTML report captured automatically.
2. Engineer reviews the trace + screenshot + video; classifies as:
   - **Test bug** → fix the test.
   - **Application bug** → file ticket; link Allure attachment.
   - **Environment / data** → flag and rerun.
3. Application bugs link back to the failing test ID (e.g. `K1`,
   `INV-A1`). When the bug is fixed, the existing test serves as the
   regression guard — no new test needed.
4. Blocker / Critical bugs trigger the suspension criteria in § 7.3.

### 10.3 Known open defects

> **Canonical location:** [`BUGS.md`](../BUGS.md) holds the full K-bug catalogue (severity, surfacing test, triage notes). This testplan no longer duplicates the table — link out to keep one source of truth.

22 defects open (K1–K22); 4 Critical (K8, K12, K15, K21).

---

## 11. Test deliverables

This effort produces:

| Deliverable | Location |
|-------------|----------|
| Test plan (this document) | `Manual/TESTPLAN.md` |
| Per-feature one-liner plans | `Manual/testplan/<Module>/<MODULE>.<NNN>/Testplan_<MODULE>.<NNN>.txt` |
| Per-test-case manual files | `Manual/testplan/<Module>/<MODULE>.<NNN>/TC.<MODULE>.<NNN>.<NNN>.txt` |
| Feature index (CSV) | `Manual/Feature-Registry.csv` |
| Framework code | `Automation/playwright.config.ts`, `Automation/pages/`, `Automation/tests/` |
| Page object models | `Automation/pages/*.ts` |
| Test specs | `Automation/tests/<section>/<feature>.spec.ts` |
| Reusable utilities | `Automation/tests/utils/*.ts` |
| Exploration tools | `Automation/scripts/explore/nav.spec.ts`, `Automation/scripts/explore/all-pages.spec.ts` (via `npm run explore:*`) |
| Test reports | `Automation/playwright-report/` (HTML), `Automation/allure-report/` (Allure) |
| Project memory | `~/.claude/projects/C--Consentz/memory/` |

---

## 12. Schedule and milestones

The work is organized as 7 rolling sprints. Each sprint adds one or two
sections; smoke tests for the new section ship on day one and depth
follows.

| Sprint | Focus | Rationale |
|--------|-------|-----------|
| **1** | Auth ✅, Dashboard ✅, **K1 regression**, **section-URLs smoke**, **Patients (full CRUD)** | Build the patterns; lock in the broken Blockers page; Patients is the foundation many flows touch |
| **2** | Calendar, Invoices, Stock | Highest business risk — money + scheduling |
| **3** | Treatments, Price List, Forms, Questionnaires, Team | Setup data the higher-priority flows depend on |
| **4** | Marketing (Prospects → Pipeline → Campaign Manager → Email Builder → Template Library) | End-to-end marketing journey |
| **5** | Reports, CQC, Settings (Profile, Licences, Online Booking, Messaging) | Lower frequency but compliance-critical |
| **6** | Logs / Archives, Messages, Help, Website, AI | Smoke + read-only checks; lighter-weight |
| **7** | Edge cases: bulk actions, exports, file uploads, Zoom integration, Stripe redirect | Polish |

Sprint length is intentionally not pinned to a calendar — each sprint
ends when its acceptance criteria pass three consecutive runs.

---

## 13. Reporting and metrics

### 13.1 Metrics

| Metric | Definition | Target |
|--------|-----------|--------|
| P0 pass rate | P0 tests passing on first attempt | 100 % |
| P1 pass rate | P1 tests passing on first attempt | ≥ 95 % |
| Flake rate | Tests that needed a retry to pass | < 5 % |
| Coverage by section | Sections with at least smoke + 1 functional test | grows per § 12 |
| Mean test duration | (informational) | < 30 s avg |

### 13.2 Reports

- **Per run**: Allure HTML (rich, with attachments) and Playwright HTML
  (lighter).
- **Per sprint**: text summary in PR description: tests added /
  modified, defects raised, flake rate.
- **Per release**: pre-release sign-off summary against § 7.2.

### 13.3 Cadence

- Tests run on every push (once CI is wired up).
- Manual full-suite run before any production deploy.
- Quarterly re-crawl with the explore spec to detect new pages or URL
  changes.

---

## 14. Test scenario catalog

Each scenario carries a stable ID (e.g. `PAT-C1`) to anchor traceability
between the plan, the spec file, and any defect tickets.

Priority key: **P0** must pass on every CI run · **P1** should pass on
every CI run · **P2** nice to have.

### 14.1 Cross-cutting (every page)

| ID | Scenario | Priority |
|----|----------|----------|
| X1 | Page loads with HTTP 200 (not 4xx / 5xx) | P0 |
| X2 | URL matches expected pattern AND content renders — `assertPageLoaded` | P0 |
| X3 | Welcome intro-video modal can be dismissed and stays dismissed for the session | P1 |
| X4 | Global "Schedule a Demo / Update Photo / Incoming Call Request" pop-ups don't block primary actions | P2 |
| X5 | User stays authenticated across navigation | P0 |
| X6 | Unauthenticated requests redirect to `/admin/login` | P0 |
| X7 | Top-bar avatar shows "Demo Consentz" via the dropdown's `.user-text-hold` | P1 |
| X8 | Clinic switcher navigates between the 9 demo clinics; new clinic's dashboard renders | P1 |
| X9 | Browser back button after navigation lands on the previous page | P2 |
| X10 | Page refresh (F5) preserves session and re-renders the same page | P1 |

### 14.2 Known regression locks

| ID | Description | Priority |
|----|-------------|----------|
| K1 | `/admin/clinics/3/blockers` must return HTTP 200 (currently 500) | P0 — regression |
| K2 | `/admin/profile/subscription` redirects to host `billing.stripe.com` | P1 — regression |
| K3 | `/admin/profile` redirects to `/admin/organisations/users/{userId}/edit` | P1 — regression |
| K4 | `LoginPage.login()` recovers from "Too many attempts" by hard-waiting and retrying | P0 — regression |
| K5 | `LoginPage.submitLoginForm` rotates submit strategies and never silently no-ops | P0 — regression |

### 14.3 Authentication (covered)

Implemented in `Automation/tests/auth/login.spec.ts` and `Automation/tests/auth/logout.spec.ts`.

| ID | Scenario | Priority |
|----|----------|----------|
| AUTH-L1 | Valid credentials → land on dashboard | P0 |
| AUTH-L2 | Invalid credentials → stay on login page | P0 |
| AUTH-L3 | Empty submission rejected by HTML5 validation OR server error | P0 |
| AUTH-O1 | Logout → redirect to login page | P0 |
| AUTH-O2 | Protected routes after logout → redirect to login | P0 |

### 14.4 Dashboard (covered)

Implemented across `Automation/tests/dashboard/*.spec.ts` (dashboard.spec.ts, time-period-filter.spec.ts, page-identity.spec.ts, refresh.spec.ts, robustness.spec.ts, widget-library-coverage.spec.ts, widget-library-categories.spec.ts).

| ID | Scenario | Priority |
|----|----------|----------|
| DASH-S1..6 | Smoke (URL, title, H1, toolbar, default widgets, user menu) | P0 |
| DASH-W1..4 | Widget library (open, categories, close, per-widget controls) | P1 |
| DASH-C1..2 | Clinic switcher (lists clinics, switching navigates) | P1 |
| DASH-N1..2 | Top-nav navigation (Calendar, Patients) | P1 |
| DASH-T1 | Refresh keeps us on the dashboard | P1 |

### 14.5 Top-bar pages

#### Calendar — `/admin/clinics/3/appointments/calendar`

| ID | Scenario | Priority |
|----|----------|----------|
| CAL-S1 | Calendar grid renders (table with month + day headers) | P0 |
| CAL-S2 | Day / Week / Month view toggle switches grid | P1 |
| CAL-S3 | Date picker chevrons navigate months and years | P1 |
| CAL-S4 | "Today" returns to current date | P2 |
| CAL-A1 | "Book Appointment" opens booking modal | P0 |
| CAL-A2 | "Book Meeting" opens meeting modal | P1 |
| CAL-A3 | "Instant Meeting" creates immediate meeting | P2 |
| CAL-F1 | Filter by Treatment / Status / Practitioner | P1 |
| CAL-F2 | Multi-select Practitioner / Rooms filters | P1 |
| CAL-F3 | "Full Screen" toggle | P2 |
| CAL-F4 | "Private Mode" hides patient names | P1 |
| CAL-D1 | Drag appointment to new slot updates start time (advanced) | P2 |
| CAL-D2 | Click appointment opens edit modal | P1 |
| CAL-D3 | Delete appointment removes from grid AND Appointments log | P1 |

#### Patients — `/admin/clinics/3/patients`

| ID | Scenario | Priority |
|----|----------|----------|
| PAT-S1 | Patient table renders (Patient, Telephone, Email, Status) | P0 |
| PAT-S2 | "Add Patient" opens patient creation form | P0 |
| PAT-C1 | Create patient with required fields → appears in list | P0 |
| PAT-C2 | Invalid form data → validation errors | P1 |
| PAT-C3 | Duplicate email → handled gracefully | P1 |
| PAT-R1 | Click row → patient detail page | P0 |
| PAT-U1 | Edit patient persists | P1 |
| PAT-D1 | Delete patient (confirmation modal) | P1 |
| PAT-F1 | Search by name | P0 |
| PAT-F2 | Search by email | P1 |
| PAT-F3 | No-match search shows empty state | P1 |
| PAT-F4 | Status filter narrows list | P1 |
| PAT-F5 | Pagination | P1 |
| PAT-X1 | "Copy Email" copies to clipboard | P2 |
| PAT-X2 | Column sort reverses order | P2 |

#### Website — `/admin/website/3`

| ID | Scenario | Priority |
|----|----------|----------|
| WEB-S1 | All four tabs render (Free Website, Booking Widget, Custom Website, Events) | P0 |
| WEB-T1 | Tab switching renders correct sub-content | P1 |
| WEB-W1 | Edit Widget Button modal saves | P1 |
| WEB-W2 | Edit Booking Button modal saves | P1 |
| WEB-E1 | Preview links open public widget | P2 |
| WEB-E2 | Events tab lists event-module records | P2 |

#### AI — `/admin/clinics/3/ai`

| ID | Scenario | Priority |
|----|----------|----------|
| AI-S1 | Page loads with chatbot heading | P1 |
| AI-A1 | "New Chat" creates conversation | P1 |
| AI-A2 | "History" shows past conversations | P2 |
| AI-A3 | Send message returns a response | P1 |

#### Messages — `/admin/message/index/3`

| ID | Scenario | Priority |
|----|----------|----------|
| MSG-S1 | Three thread tabs render: Clinic, Patients, Prospects | P1 |
| MSG-A1 | Send message in Clinic chat → appears in thread | P1 |
| MSG-A2 | Insert link / image / video modals open | P2 |
| MSG-F1 | Search filters messages | P2 |

#### Help — `/admin/help/3`

| ID | Scenario | Priority |
|----|----------|----------|
| HELP-S1 | Page loads with non-empty `<main>` | P2 |

### 14.6 Marketing

#### Prospects — `/admin/clinics/3/lead-capture`

| ID | Scenario | Priority |
|----|----------|----------|
| PRO-S1 | Prospects table renders | P0 |
| PRO-C1 | "Add New Lead" creates prospect | P0 |
| PRO-U1 | Edit prospect persists | P1 |
| PRO-U2 | Move through pipeline stages | P1 |
| PRO-D1 | Delete prospect | P1 |
| PRO-F1 | Search by name | P1 |
| PRO-F2 | Filter by Stage / Source | P1 |
| PRO-X1 | Convert prospect → patient | P1 |
| PRO-A1 | Archived prospects appear in Logs | P1 |

#### Custom Form Data — `/admin/customformdata/3`

| ID | Scenario | Priority |
|----|----------|----------|
| CFM-S1 | Custom form names listed as buttons | P1 |
| CFM-A1 | Click form shows submitted entries (Name, Email, Phone, Address, Date) | P1 |
| CFM-X1 | Export form data | P2 |

#### Event Form Data — `/admin/eventformdata/3`

| ID | Scenario | Priority |
|----|----------|----------|
| EFM-S1 | Event names listed | P1 |
| EFM-A1 | Click event shows submitted entries | P1 |

#### Waiting List — `/admin/clinics/3/waiting-list`

| ID | Scenario | Priority |
|----|----------|----------|
| WL-S1 | Table renders | P1 |
| WL-C1 | "Add New" creates entry | P1 |
| WL-D1 | Delete entry | P1 |
| WL-F1 | Search by Availability / Treatments / Practitioners | P1 |

#### Correspondence — `/admin/clinics/3/correspondence`

| ID | Scenario | Priority |
|----|----------|----------|
| COR-S1 | Correspondence table renders | P1 |
| COR-F1 | Search by name / email | P1 |
| COR-F2 | Search Patient modal | P2 |
| COR-X1 | Click row opens detail / preview | P2 |

#### Campaign Manager — `/admin/clinics/3/campaign`

| ID | Scenario | Priority |
|----|----------|----------|
| CMP-S1 | Campaigns table renders | P1 |
| CMP-C1 | "Add New" creates campaign | P1 |
| CMP-U1 | Edit campaign updates row | P1 |
| CMP-D1 | Delete campaign | P1 |
| CMP-A1 | Activate / pause reflects in Status | P1 |

#### Email Builder — `/admin/clinics/3/systemEmails`

| ID | Scenario | Priority |
|----|----------|----------|
| EMB-S1 | Both tabs render (System Emails / Campaign Emails) | P1 |
| EMB-A1 | Click email title opens editor | P1 |
| EMB-A2 | Save edited email persists | P1 |

#### Template Library — `/admin/clinics/3/templates`

| ID | Scenario | Priority |
|----|----------|----------|
| TPL-S1 | Both tabs render (Templates / My Templates) | P1 |
| TPL-A1 | Search filters templates | P1 |
| TPL-A2 | Pagination works | P1 |
| TPL-A3 | Open template / clone to "My Templates" | P1 |

#### Pipeline — `/admin/clinics/3/lead-capture-pipeline/`

| ID | Scenario | Priority |
|----|----------|----------|
| PIP-S1 | Pipeline columns render with cards | P1 |
| PIP-A1 | "Add Lead" creates a card in the first stage | P1 |
| PIP-A2 | Drag-and-drop card between stages updates stage | P2 |
| PIP-F1 | Search filters cards | P2 |

#### Lists — `/admin/clinics/3/filter`

| ID | Scenario | Priority |
|----|----------|----------|
| LST-S1 | Lists table renders | P1 |
| LST-C1 | "Add New" creates saved search | P1 |
| LST-D1 | Delete saved search | P1 |

#### Ads — `/admin/clinics/3/ads`

| ID | Scenario | Priority |
|----|----------|----------|
| ADS-S1 | Page loads without 5xx | P2 |
| ADS-X1 | Connect ad account, list ads, check spend (skipped on demo) | P3 |

### 14.7 Stock Control

#### Stock — `/admin/clinics/3/stock/`

| ID | Scenario | Priority |
|----|----------|----------|
| STK-S1 | Stock List tab renders | P0 |
| STK-S2 | Stock History tab renders | P1 |
| STK-A1 | "Adjust Stock" modal opens per product | P0 |
| STK-A2 | Adjusting stock updates Balance | P0 |
| STK-A3 | Adjustment shows in Stock History | P1 |
| STK-F1 | Search by product name | P1 |
| STK-F2 | Below-Minimum items flagged | P1 |

#### Batch — `/admin/clinics/3/batch`

| ID | Scenario | Priority |
|----|----------|----------|
| BAT-S1 | Active tab renders | P1 |
| BAT-S2 | Archive tab renders | P1 |
| BAT-F1 | Search by batch number / GRN ref | P1 |

#### Goods Received — `/admin/clinics/3/goodsReceived/`

| ID | Scenario | Priority |
|----|----------|----------|
| GRN-S1 | Table renders | P1 |
| GRN-C1 | "Add New" creates GRN | P1 |
| GRN-D1 | Delete GRN | P1 |
| GRN-F1 | Search by supplier / ref | P1 |

#### Prescriptions — `/admin/clinics/3/prescriptions`

| ID | Scenario | Priority |
|----|----------|----------|
| RX-S1 | Both tabs render (Unsent / Sent) | P1 |
| RX-A1 | View PDF opens prescription PDF | P1 |
| RX-A2 | Download PDF triggers download | P1 |
| RX-F1 | Search by patient / practitioner / product | P1 |

### 14.8 Business

#### Invoices — `/admin/clinics/3/invoices`

| ID | Scenario | Priority |
|----|----------|----------|
| INV-S1 | Invoices table renders (Invoice, Patient, Description, Date, Amount, Paid, Balance) | P0 |
| INV-F1 | "Unpaid" filter | P0 |
| INV-F2 | Date-range filter | P0 |
| INV-F3 | Search by name / invoice number | P0 |
| INV-R1 | Click invoice → detail view | P0 |
| INV-X1 | Pagination | P1 |
| INV-A1 | Totals (Amount / Paid / Balance) arithmetically consistent | P0 |

#### Prepayments — `/admin/clinics/3/invoices/prepay`

| ID | Scenario | Priority |
|----|----------|----------|
| PRE-S1 | Prepayments table renders | P0 |
| PRE-F1 | Search by patient | P1 |

#### Quotes — `/admin/clinics/3/invoices/quotes`

| ID | Scenario | Priority |
|----|----------|----------|
| QTE-S1 | Quotes table renders | P1 |
| QTE-A1 | Convert quote to invoice | P1 |
| QTE-F1 | Filters mirror invoices | P1 |

#### Credit Notes — `/admin/clinics/3/invoices/credit`

| ID | Scenario | Priority |
|----|----------|----------|
| CN-S1 | Credit notes table renders | P1 |
| CN-F1 | Search | P1 |

#### PaymentSense logs — Payments / Prepays / Refunds

| ID | Scenario | Priority |
|----|----------|----------|
| PS-S1 | Each log page renders with its table | P1 |
| PS-A1 | Refund row links to original payment / invoice | P1 |
| PS-A2 | Timestamps in clinic timezone | P2 |

### 14.9 Reports

| ID | Scenario | Priority |
|----|----------|----------|
| RPT-S1 | General Reports page loads with selection UI | P1 |
| RPT-A1 | Generate report → output renders or downloads | P1 |
| RPT-A2 | Clear Selection resets form | P1 |
| CR-S1 | Custom Reports page loads | P1 |
| CR-A1 | Build + generate custom report | P1 |
| CQC-S1 | CQC Reports page loads | P2 |
| CQC-A1 | Generate CQC report | P2 |

### 14.10 Setup

#### Team — `/admin/clinics/3/users`

| ID | Scenario | Priority |
|----|----------|----------|
| TEAM-S1 | Team table renders | P1 |
| TEAM-C1 | "Add New" creates user | P1 |
| TEAM-U1 | Edit user role | P1 |
| TEAM-D1 | Delete user | P1 |
| TEAM-X1 | Toggle Access / Website Visibility | P1 |
| TEAM-F1 | Search by name / email | P1 |

#### Products — `/admin/clinics/3/product/`

| ID | Scenario | Priority |
|----|----------|----------|
| PRD-S1 | Products list renders | P1 |
| PRD-C1 | "Add Product" creates product | P1 |
| PRD-D1 | Delete product | P1 |
| PRD-F1 | Search | P1 |

#### Treatments — `/admin/clinics/3/treatment/`

| ID | Scenario | Priority |
|----|----------|----------|
| TRT-S1 | Both tabs render (Treatments / Treatment Groups) | P1 |
| TRT-C1 | "Add New" treatment | P1 |
| TRT-C2 | "Add New" treatment group | P1 |
| TRT-D1 | Delete treatment | P1 |

#### Forms — `/admin/clinics/3/forms`

| ID | Scenario | Priority |
|----|----------|----------|
| FRM-S1 | All three tabs render (Consent Forms / Aftercare Notes / Policies) | P1 |
| FRM-C1 | "Add Form" creates form in active tab | P1 |
| FRM-D1 | Delete form | P1 |
| FRM-F1 | Search | P1 |

#### Questionnaires — `/admin/clinics/3/questionnaire`

| ID | Scenario | Priority |
|----|----------|----------|
| QST-S1 | Both tabs render | P1 |
| QST-C1 | "Add New" creates questionnaire | P1 |
| QST-U1 | Toggle Enabled column | P1 |
| QST-D1 | Delete questionnaire | P1 |

#### Price List — `/admin/clinics/3/priceList/`

| ID | Scenario | Priority |
|----|----------|----------|
| PRL-S1 | Both tabs render | P0 |
| PRL-C1 | "Add Item" creates entry | P0 |
| PRL-U1 | Edit Sale Price persists; reflects in patient invoice flow | P0 |
| PRL-D1 | Delete entry | P1 |
| PRL-F1 | Search by name / Choose Product | P1 |

#### Prepay Packages — `/admin/clinics/3/package`

| ID | Scenario | Priority |
|----|----------|----------|
| PKG-S1 | Packages list renders | P1 |
| PKG-C1 | "Add New" creates package | P1 |
| PKG-D1 | Delete package | P1 |

#### Media — `/admin/clinics/3/marketing`

| ID | Scenario | Priority |
|----|----------|----------|
| MED-S1 | Page loads with Image and Video sections | P2 |
| MED-A1 | Upload image | P2 |
| MED-A2 | Upload video | P2 |

#### T&C — `/admin/clinics/3/terms-and-conditions/edit`

| ID | Scenario | Priority |
|----|----------|----------|
| TC-S1 | All three tabs render | P1 |
| TC-A1 | Edit T&C → Save → reload preserves text | P1 |

#### Rooms & Equipment — `/admin/clinics/3/room`

| ID | Scenario | Priority |
|----|----------|----------|
| ROOM-S1 | Both tabs render (Rooms / Equipment) | P1 |
| ROOM-C1 | "Add Room" creates room | P1 |
| ROOM-D1 | Delete room | P1 |

#### Membership Plans — `/admin/clinics/3/membership`

| ID | Scenario | Priority |
|----|----------|----------|
| MEM-S1 | Plans table renders | P1 |
| MEM-C1 | "Add Plan" creates plan | P1 |
| MEM-D1 | Delete plan | P1 |

#### Additional List Options — `/admin/clinics/3/appointment-codes/`

| ID | Scenario | Priority |
|----|----------|----------|
| ALO-S1 | All five tabs render | P1 |
| ALO-C1 | "Add New" appointment code | P1 |
| ALO-U1 | Edit code via row Edit modal | P1 |
| ALO-D1 | Delete code (confirmation cites code value) | P1 |
| ALO-T1 | Toggle Enable/Disable | P1 |
| ALO-X1 | Repeat C/U/D for the four other tabs | P1 |

### 14.11 Settings

#### Super Admin — `/admin/organisations/3/users`

| ID | Scenario | Priority |
|----|----------|----------|
| SA-S1 | Super-admin list renders | P1 |
| SA-C1 | "Add Account" creates org admin | P1 |
| SA-U1 | Toggle Enabled / Access | P1 |
| SA-F1 | Search | P1 |

#### Clinics — `/admin/organisations/3/clinics`

| ID | Scenario | Priority |
|----|----------|----------|
| CL-S1 | Clinics list renders | P1 |
| CL-C1 | "Add Clinic" creates clinic | P1 |
| CL-U1 | Edit clinic | P1 |
| CL-A1 | New clinic appears in top-bar switcher | P1 |
| CL-F1 | Search | P1 |

#### Profile (Clinic) — `/admin/clinics/3/edit`

| ID | Scenario | Priority |
|----|----------|----------|
| PRF-S1 | All five tabs render (Clinic / App / Calendar / Brand / Notice) | P1 |
| PRF-A1 | Edit clinic name → Save → dashboard H1 updates | P1 |
| PRF-A2 | Update Logo modal accepts upload | P1 |
| PRF-A3 | Update Background modal accepts upload | P1 |
| PRF-A4 | Delete logo (confirmation) | P1 |

#### Licences — `/admin/clinics/3/license`

| ID | Scenario | Priority |
|----|----------|----------|
| LIC-S1 | Page loads | P1 |
| LIC-C1 | "Add Licence" creates licence | P1 |
| LIC-D1 | Delete licence | P1 |

#### Import Data — `/admin/clinics/3/dataImport`

| ID | Scenario | Priority |
|----|----------|----------|
| IMP-S1 | Page loads with import prompt | P2 |
| IMP-A1 | Upload sample CSV → records appear in target sections | P2 |

#### Online Booking — `/admin/widget/settings/3`

| ID | Scenario | Priority |
|----|----------|----------|
| OB-S1 | Both tabs render (Settings / Widget) | P1 |
| OB-A1 | Save persists across reload | P1 |
| OB-A2 | Insert Link / Image / Video modals | P2 |

#### Messaging — `/admin/clinics/3/reminders`

| ID | Scenario | Priority |
|----|----------|----------|
| RMD-S1 | All five tabs render | P1 |
| RMD-A1 | Edit reminder template → Save → reload preserves | P1 |
| RMD-A2 | Toggle reminder enabled state | P1 |

### 14.12 Logs / Archives

Each archive page supports smoke + search. CRUD is not applicable
(archives are read-only mirrors).

| Page | Live counterpart | Priority |
|------|------------------|----------|
| Appointments — `/admin/clinics/3/appointments` | Calendar | P1 |
| Blockers — `/admin/clinics/3/blockers` | (none) | **K1 — currently 500** |
| Appointment Archive | Appointments | P1 |
| Prospects Archive | Prospects | P1 |
| Invoice Archive | Invoices | P1 |
| Prepay Archive | Prepayments | P2 |
| Credit Notes Archive | Credit Notes | P2 |
| Stock History Archive | Stock | P1 |
| Batch Archive | Batch | P2 |
| Archive Consentz Forms | Forms | P1 |

### 14.13 User dropdown

#### My Profile — `/admin/profile` → `/admin/organisations/users/3229/edit`

| ID | Scenario | Priority |
|----|----------|----------|
| ME-S1 | Redirect lands on user-edit page | P1 |
| ME-A1 | Edit name / email → Save → reload preserves | P1 |
| ME-A2 | Zoom Integration button opens OAuth flow / modal | P2 |

#### Change Password — `/admin/change-password`

| ID | Scenario | Priority |
|----|----------|----------|
| CPW-S1 | Form renders (old / new / confirm) | P0 |
| CPW-A1 | Wrong old password → error | P0 |
| CPW-A2 | New ≠ confirm → error | P0 |
| CPW-A3 | Successful change allows login with new password (use a non-demo account) | P0 |

#### Subscriptions — `/admin/profile/subscription` → `billing.stripe.com/...`

| ID | Scenario | Priority |
|----|----------|----------|
| SUB-S1 | Click navigates to Stripe billing portal (assert host = `billing.stripe.com`) | P1 |
| SUB-S2 | Out-of-scope: do not interact with Stripe UI | (note) |

---

## 15. Approvals

| Role | Name | Signature / approval | Date |
|------|------|---------------------|------|
| Test Engineer (author) | Piyush Singhal | (pending) | |
| QA Lead / Reviewer | TBD | (pending) | |
| Engineering Lead | TBD | (pending) | |

> This plan is a living document. Material changes (scope additions,
> environment changes, defect-management process changes) require a new
> revision in § 1.1 and re-review.
