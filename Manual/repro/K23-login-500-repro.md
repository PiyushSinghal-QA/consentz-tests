# K23 — Manual reproduction steps

**Status as of 2026-05-13:** Probe-verified on **v4** (reproduces), probe-verified on **v3** (does NOT reproduce). K23 has been dropped from the active dashboard because v3 is the target environment; this doc is kept for manual cross-environment verification.

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

| Environment | URL after submit                  | Page content                                                                                          | Verdict |
| ----------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| v3 (target) | `/admin/login` (bounced back)     | Login form re-rendered with an inline error ("Invalid credentials" / similar). HTTP 200. **Correct.** | OK      |
| v4          | `/admin/login_check`              | Symfony error template: *"Oops! An Error Occurred — The server returned a '500 Internal Server Error'."* No login form visible. **Buggy.** | K23 fires |

## What to verify manually

- **On v3** — confirm you land on `/admin/login` with a visible error message; **no Symfony "Oops" template**.
- **On v4** — confirm the URL changes to `/admin/login_check` (or you land on a 500 page); body should contain the literal string `"Oops! An Error Occurred"`.

## Notes

- The rate-limit (~4–5 attempts / 3 min) on staging may kick in across multiple probes — wait a few minutes between repeated tries to keep the test deterministic.
- The 500 on v4 happens whether the username exists or not, and whether the password is correct or not (as long as the *combination* is wrong) — so even a real user with the wrong password triggers it.
- If v4 ever gets a fix, the K23 tripwire at `Automation/tests/auth/login-known-bugs.spec.ts` will surface it: the test is currently a positive regression check against the v3 contract.
