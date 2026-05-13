# Consentz Test Suite

End-to-end test suite for [v3.consentz.com](https://v3.consentz.com) — Playwright + TypeScript automation alongside a structured manual test plan.

The repository is split into two top-level folders:

| Folder | Contents |
|---|---|
| **`Automation/`** | All Playwright code: spec files, page object models, fixtures, configuration, dependencies. Run tests from here. |
| **`Manual/`** | Test plan + per-test-case reproduction documents. Read-only artifacts; no code. |

Project-level documents (`STATUS.md`, this README, `CLAUDE.md`, `progress.txt`, `PENDING-ITEMS.DONOTDELETE.md`) sit at the repo root.

---

## Where things live

| If you want to know… | Read |
|---|---|
| **Visual health dashboard** | open `dashboard/index.html` via `npm run dashboard:serve` (auto-published to GitHub Pages on every push to `main`) |
| **What's blocked, in-progress, or pending probing** | [`PENDING-ITEMS.DONOTDELETE.md`](PENDING-ITEMS.DONOTDELETE.md) |
| **Session-by-session work log** | [`progress.txt`](progress.txt) |
| **How the suite is structured** | This README (below) |
| **Coverage scorecard + sprint plan + roadmap** | [`STATUS.md`](STATUS.md) |
| **Manual test plan** | [`Manual/TESTPLAN.md`](Manual/TESTPLAN.md) |

---

## Current scope

| Module | Spec files | Notes |
|---|---|---|
| **Authentication** | `tests/auth/` | login + storage-state setup for the rest of the suite |
| **Dashboard** | `tests/dashboard/` | smoke + a 247-TC manual plan for the full module |
| **Patients** | `tests/patients/` | 11 category-scoped files: smoke/CRUD, negative, bulk, reliability, search, boundary, fields, tabs, security, uniqueness, multitenant — plus known-bugs tripwires. ~45 active tests. |
| **Calendar** | `tests/calendar/` | booking happy-path + negative + fields + multitenant + known-bug tripwires |

**Total: ~65 active tests + 4 skipped tracked-bug tripwires.**

---

## Setup

One-time, from the repo root:

```bash
cd Automation
npm install
npx playwright install --with-deps
cp .env.example .env   # set BASE_URL / CONSENTZ_USERNAME / CONSENTZ_PASSWORD
```

Active account on v3: `tester2` (super-admin, no OTP). Clinics: 1080 (default), 1081 (multi-tenant).

---

## Running tests

All commands run from inside `Automation/`:

```bash
# Full suite — headed by default (helpful for development)
npm test

# Headless (faster — set HEADLESS=1)
HEADLESS=1 npx playwright test

# UI mode (best for picking + debugging single specs interactively)
npm run test:ui

# Last HTML report
npm run test:report
```

**Single file or test:**

```bash
npx playwright test tests/patients/patients-search.spec.ts
npx playwright test tests/patients/patients.spec.ts:6      # exact line
npx playwright test --grep "search finds a patient by phone"
```

---

## Spec architecture

Three patterns shape every spec.

### 1. Custom fixture (`tests/fixtures.ts`)

Exposes two fixtures so most specs need no `beforeEach` boilerplate.

```ts
import { test, expect } from '../fixtures';

test('add a patient', async ({ page, trackedMarkers }) => {
  trackedMarkers.push('Probe-marker');   // push at create-time; cleanup is automatic on failure
  // …
});
```

- **`trackedMarkers: string[]`** — push search markers for any patients the test creates. If the test FAILS, the fixture's teardown sweeps the markers and best-effort deletes the orphans. Passing tests pay no extra cost.
- **`serverErrors: ServerError[]`** *(auto-attached to every test)* — records every 5xx response. At teardown, if the test otherwise passed but a 5xx fired, the fixture FAILS the test with the captured URLs. This is how the suite catches K21-class bugs (HTTP 500 on user input) for free across the entire suite — no per-test boilerplate needed.

To opt out (rare — only when a test deliberately expects a 5xx):

```ts
test('something that expects a 5xx', async ({ page, serverErrors }) => {
  // … action that intentionally fires a 5xx …
  expect(serverErrors).toHaveLength(1);
  serverErrors.length = 0;  // clear so the auto-fail doesn't fire
});
```

### 2. Page Object Models (`pages/`)

`PatientsPage`, `CalendarPage`, `DashboardPage`. All field/tab/modal interaction logic lives in the POM; specs read like prose:

```ts
const patients = new PatientsPage(page);
await patients.gotoNew(clinicId);
await patients.fill({ firstName, lastName, phone });
await patients.save();
```

### 3. Known-bug tripwires (`*-known-bugs.spec.ts`)

Every bug that the framework can detect but can't yet fix has a `test.skip` placeholder. When the bug is fixed, the skip's check will start to pass — flipping it to red — and the engineer turns the skip into a real test. Current tripwires:

- `tests/patients/patients-known-bugs.spec.ts` — age-label <1y, age-drops-months, future-DOB silently accepted, pre-1900 DOB silently accepted
- `tests/calendar/calendar-known-bugs.spec.ts` — double-booking (same practitioner + patient + time)

---

## Test plan ↔ automation traceability

Each automated test maps back to the corresponding entry in `Manual/testplan/<Module>/`. Detailed manual reproduction steps live in the same folder.

---

## Visual dashboard (for non-CLI viewers)

A single-page health dashboard lives in `dashboard/`. It shows:

- Pass / fail / skipped totals + run timing
- Per-module **health score** (0–100, traffic-light coloured)
- Bug list with editable severity dropdowns — change severity in the browser, health recomputes live, overrides persist via `localStorage`
- Failed-test cards with stack trace + on-failure screenshot
- A doughnut chart of bug severity distribution

**Local preview:**

```bash
cd Automation
npm test          # writes test-results/results.json
npm run dashboard:serve
```

Opens at `http://localhost:8765`.

**Auto-publish:** `.github/workflows/dashboard.yml` runs the suite on every push to `main`, regenerates `dashboard/data/results.json`, and deploys the folder to GitHub Pages. After enabling Pages in repo settings (Source: GitHub Actions), the dashboard URL stays stable across runs — bookmark it.

**Severity weights** live in `bug-severity.json` at repo root. Edit and commit to change the default scoring; per-user UI overrides override on top.

---

## CI

GitHub Actions runs the suite on push to `main`, on every PR, and on manual dispatch. Required secrets:

| Secret | Value |
|---|---|
| `CONSENTZ_USERNAME` | `tester2` (or active test account) |
| `CONSENTZ_PASSWORD` | (the account's password) |
| `CONSENTZ_BASE_URL` | optional — defaults to `https://v3.consentz.com` |

Artefacts (HTML report, Allure raw, traces / videos / screenshots on failure) upload with 14-day retention.

---

## Known environment constraints

- **Single-session test account** — `workers: 1` in `playwright.config.ts`. Don't increase until a second account exists.
- **Search-index lag** — newly-created patients aren't immediately findable via the list search (typically resolves within tens of seconds). Tests that round-trip create → search use `expect.poll(...)` with a generous timeout to tolerate this.
- **`networkidle` is unreliable on v3** — analytics polling prevents it from firing in some flows. Prefer `waitUntil: 'domcontentloaded'` or `'commit'`.

Engineering quirks and remediation patterns: see `CLAUDE.md`.

---

## After editing a testplan

Two helper scripts keep auxiliary files in sync. Both are idempotent:

```bash
node tools/regenerate-registry.js   # refresh Manual/Feature-Registry.csv
node tools/sync-stub-tcs.js         # sync per-TC stub files to the plan
```
