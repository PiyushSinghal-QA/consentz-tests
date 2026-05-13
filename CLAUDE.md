# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Playwright-based E2E test suite for `staging.consentz.com`. The repo is split into two top-level folders:

- **`Automation/`** — all Playwright code (specs, page objects, fixtures, configs, dependencies). All `npm` and `npx playwright` commands run from this directory.
- **`Manual/`** — test plan + manual reproduction documents (read-only artifacts, no code).

Project-level docs (`STATUS.md`, `README.md`, this `CLAUDE.md`) live at repo root.

## Commands

All commands run from inside `Automation/`:

```bash
cd Automation

# Setup (one-time)
npm install
npx playwright install --with-deps

# Running tests
npm test                  # All tests, headless
npm run test:headed       # All tests, visible browser
npm run test:ui           # Interactive Playwright UI (best for development)
npm run test:debug        # Debug mode with debugger
npm run test:report       # View last HTML report

# Run a single test file
npx playwright test tests/auth/login.spec.ts

# Run a single test by name
npx playwright test -g "should login with valid credentials"

# Filter by TC tag (traceability to Manual/testplan/)
npx playwright test --grep "@TC.DASH"
npx playwright test --grep "@TC.SMOKE.001"
npx playwright test --grep "@BUG:K"

# Run in a specific browser
npx playwright test --project=chromium
```

## Environment Setup

Copy `Automation/.env.example` to `Automation/.env` and fill in credentials:

```
BASE_URL=https://staging.consentz.com
CONSENTZ_USERNAME=demo
CONSENTZ_PASSWORD=password
```

Auth state is saved to `Automation/playwright/.auth/user.json` (gitignored). Delete this file to force re-authentication.

## Architecture

### Authentication Flow

Tests run in dependency order via Playwright projects:
1. **`setup`** (`Automation/tests/auth.setup.ts`) — runs once, logs in and saves browser storage state (cookies + localStorage) to `Automation/playwright/.auth/user.json`
2. **`chromium`** — depends on `setup` and reuses the saved auth state. Firefox/Edge projects are commented out pending re-enable.

Login tests override the saved state explicitly:
```ts
test.use({ storageState: { cookies: [], origins: [] } });
```

### Page Objects (`Automation/pages/`)

- **`LoginPage.ts`** — handles `/admin/login`: navigation, form fill/submit, error/presence assertions. Multi-strategy submit (Enter → click → DOM `form.submit()`) and rate-limit auto-detect+retry. Short-circuits when already logged in.
- **`DashboardPage.ts`** — handles post-login state: 14+ locators (filter row, widgets, library sidebar, clinic switcher, welcome modal), 8+ helper methods (`addWidgetFromLibrary`, `removeAllWidgets`, etc.).

### Test Data (`Automation/test-data/`)

- `users.ts` — `DEMO_USER` (env-sourced), `INVALID_USER` (hard-coded bad creds)
- `widgets.ts` — `WIDGET_LIBRARY` catalogue (5 categories × 26 widgets), `DEFAULT_WIDGETS`, `KNOWN_BROKEN_WIDGETS` (K2/K3/K4 allow-list)

### Test Plan Linkage (`Manual/testplan/`)

Every automated test name carries one or more `@TC.<MODULE>.<NNN>.<NNN>` tags that map to the corresponding one-liner in `Manual/testplan/<module>/<MODULE>.txt`. Manual reproduction steps for each TC live in `Manual/testplan/<module>/manual/TC.<MODULE>.<NNN>.txt` (one file per sub-feature).

### Path Aliases

TypeScript path aliases (relative to `Automation/`):
- `@pages/*` → `pages/*`
- `@test-data/*` → `test-data/*`

### Timeouts

Tuned for slow staging:
- Global test: 60s
- Action: 20s
- Navigation: 45s

### Test Artifacts

On failure (or first retry): screenshots, videos, and traces are saved to `Automation/test-results/`. Run `npm run test:report` (from `Automation/`) to view them.

### Helpers

- `Automation/tests/utils/page-checks.ts` — `assertPageLoaded(page, { url, content })` — verifies URL match AND visible content (defends against blank-body bugs).
- `Automation/tests/utils/page-noise.ts` — `listenForNoise(page)` (async) — captures four channels of noise: console errors, 4xx/5xx XHRs, uncaught page errors, and UI error flashes (via `MutationObserver` injected through `addInitScript`). Default ignore list covers Symfony toolbar + 7 third-party trackers.
