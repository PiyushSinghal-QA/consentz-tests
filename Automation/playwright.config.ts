import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import { STORAGE_STATE } from './playwright/auth-state';

dotenv.config();

// Toggle: which test directories run on each CI run.
//
// During integration iteration we want CI to finish in ~3 min not ~15.
// The three heaviest folders (calendar / patients / dashboard) are
// skipped by default. Re-enable in two equivalent ways:
//
//   • One-off manual run with the full suite:
//       GitHub Actions → "Test suite + dashboard" → "Run workflow"
//       → tick the "Include heavy folders" checkbox → Run.
//
//   • Restore the full suite for every CI run permanently:
//       Edit .github/workflows/dashboard.yml and set
//       RUN_FULL_SUITE: 'true' at the workflow `env:` block (or just
//       delete this whole HEAVY_FOLDERS_SKIPPED toggle).
//
//   • Locally:
//       set the env var before running tests.
//         Bash:        RUN_FULL_SUITE=1 npm test
//         PowerShell:  $env:RUN_FULL_SUITE='1'; npm test
//         CMD:         set RUN_FULL_SUITE=1 && npm test
const RUN_FULL_SUITE =
  process.env.RUN_FULL_SUITE === '1' ||
  process.env.RUN_FULL_SUITE === 'true';
const HEAVY_FOLDERS = [
  /tests[\\/]calendar[\\/]/,
  /tests[\\/]patients[\\/]/,
  /tests[\\/]dashboard[\\/]/,
];

export default defineConfig({
  testDir: './tests',
  testIgnore: RUN_FULL_SUITE ? [] : HEAVY_FOLDERS,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://v3.consentz.com',
    headless: process.env.HEADLESS === '1',
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
