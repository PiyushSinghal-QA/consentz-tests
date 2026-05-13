# K23 — Manual reproduction steps

**Status as of 2026-05-13 (afternoon):** No longer reproducing on **either** v3 or v4 via the "non-existent username" path. Manual check by Piyush on both envs returned the correct inline error:

> *"This account does not exist. Please enter valid credentials or contact support at info@consentz.com."*

K23 was dropped from the active dashboard. The probe spec at `Automation/tests/auth/login-known-bugs.spec.ts` was converted into a positive regression test that locks in this contract — if either env regresses to the 500 again, the test goes red.

**Earlier observation:** An automated probe at ~07:00 UTC on 2026-05-13 against v4 with the same inputs returned the Symfony 500 page. Either the v4 server was in a transient bad state, or the bug only fires on a different code path (e.g. real user + wrong password, instead of non-existent user). The "real user / wrong password" variant has not been manually verified yet — if a 500 is observed on that path, re-open K23 with the specific input class noted.

## The bug

Submitting **any** invalid credentials to the login form causes the server to return an **HTTP 500 ("Oops! An Error Occurred")** Symfony error page instead of redirecting the user back to the login form with an inline "invalid credentials" message.

## Repro steps

Run the same steps on both `https://v3.consentz.com/admin/login` and `https://v4.consentz.com/admin/login`. Expect different outcomes.

1. Open `<env>/admin/login` in a fresh browser session (incognito works; not strictly required).
2. In **Username**, type any string that is not a real user — e.g. `invalid_user@example.com`.
3. In **Password**, type any string — e.g. `WrongPassword123!`.
4. Click **Sign In**.
5. Observe the resulting page.

## Expected vs observed

| Environment | URL after submit                  | Page content                                                                                          | Verdict (current) |
| ----------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| v3 (target) | `/admin/login` (bounced back)     | Login form re-rendered with the inline error *"This account does not exist. Please enter valid credentials..."*. HTTP 200. | OK      |
| v4          | `/admin/login` (bounced back)     | Same inline error as v3. HTTP 200. | OK (was buggy at ~07:00 UTC 2026-05-13 — see status note) |

## What to verify manually

- **On v3** — confirm you land on `/admin/login` with a visible error message; **no Symfony "Oops" template**.
- **On v4** — confirm the URL changes to `/admin/login_check` (or you land on a 500 page); body should contain the literal string `"Oops! An Error Occurred"`.

## Notes

- The rate-limit (~4–5 attempts / 3 min) on staging may kick in across multiple probes — wait a few minutes between repeated tries to keep the test deterministic.
- The 500 on v4 happens whether the username exists or not, and whether the password is correct or not (as long as the *combination* is wrong) — so even a real user with the wrong password triggers it.
- If v4 ever gets a fix, the K23 tripwire at `Automation/tests/auth/login-known-bugs.spec.ts` will surface it: the test is currently a positive regression check against the v3 contract.
