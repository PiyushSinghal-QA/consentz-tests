import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { INVALID_USER } from '../../test-data/users';

// Tracked-bug tripwires for Auth/Login. When the underlying defect is fixed,
// the assertions should pass — flip the test outcome (un-`test.fail()`) and
// it becomes a regression test.

test.use({ storageState: { cookies: [], origins: [] } });

test.fail(
  '[K23] invalid credentials should land on the login form with an error, not a 500',
  async ({ page }) => {
    test.setTimeout(60_000);

    // BUG: POST /admin/login_check returns HTTP 500 ("Oops! An Error Occurred")
    // when invalid credentials are submitted. Expected: redirect back to
    // /admin/login with an inline / form-level error message. Probe-verified
    // 2026-05-13 on v4.
    //
    // This is `test.fail()` — Playwright will treat it as PASS while the
    // assertion is failing. The moment the server is fixed, the assertion
    // succeeds and Playwright flips the test to FAIL ("expected failure
    // didn't happen") — that's the tripwire signal to un-mark and turn this
    // into a real regression test.

    const login = new LoginPage(page);
    await login.goto();
    await login.username.fill(INVALID_USER.username);
    await login.password.fill(INVALID_USER.password);
    await login.submit.click({ noWaitAfter: true });
    await page.waitForTimeout(3_000);

    // Expected post-fix: still on (or back at) /admin/login.
    await expect(page).toHaveURL(/\/admin\/login(?!_check)/);
    // Expected post-fix: no Symfony 500 template visible.
    await expect(page.getByText(/oops!.*error.*occurred/i)).toHaveCount(0);
  },
);
