# Defect Catalogue — Consentz K-Bugs

Single source of truth for every application defect surfaced by the test suite. Each entry has a stable `K`-ID, severity, and a link to the test that catches it (or a manual reproduction case for out-of-automation-scope bugs).

The suite stays green by inverting the test outcome (`test.fail()` / `test.skip()`) for known-broken behaviour. When a bug is fixed, the tripwire test flips red — at which point the engineer:

1. Un-skips / un-fails the test
2. Deletes the bug from this catalogue
3. Removes any related entry from `tests/patients/patients-known-bugs.spec.ts` or `tests/calendar/calendar-known-bugs.spec.ts`

For non-bug work (in-progress investigations, blocked tests, decisions awaiting confirmation), see [`PENDING-ITEMS.DONOTDELETE.md`](PENDING-ITEMS.DONOTDELETE.md).

---

## Open defects

| ID | Page / Feature | Description | Severity | Surfaced by |
|---|---|---|---|---|
| **K1**  | Logs › Blockers | `/admin/clinics/3/blockers` returns HTTP 500 (`"Impossible to access an attribute ('name') on a null variable"`) | Major | `TC.SMOKE.001.050` |
| **K2**  | Dashboard › Widget Library | "Patient Referrals" widget add fails silently (no widget appears, no error) | Major | `TC.DASH.005.038` |
| **K3**  | Dashboard › Widget Library | "Receipts" widget add fails silently | Major | `TC.DASH.005.039` |
| **K4**  | Dashboard › Widget Library | "Revenue per Period" widget add fails silently | Major | `TC.DASH.005.040` |
| **K5**  | Marketing › Template Library | 3× 404s on default thumbnails (`/library/61/image/default-image{3,4,5}.png`) | Major | `TC.SMOKE.001.012` |
| **K6**  | Marketing › Ads | 404 on `/uploads/medium/1662660561.png` | Minor | `TC.SMOKE.001.015` |
| **K7**  | Report › Custom Reports | 2× 404s on report icons (`/images/custom_reports/Giacomo%20Goodwin.svg`, `New%20Report.svg`) | Major | `TC.SMOKE.001.028` |
| **K8**  | Set Up › T&C | 404 on `/bundles/fosckeditor/ckeditor.js?v3.0.11` — **CKEditor JS missing → rich-text editor broken** | **Critical** | `TC.SMOKE.001.038` |
| **K9**  | Dashboard › Clinic Switch | Uncaught JS exception `"Cannot convert undefined or null to object"` during destination-clinic widget init | Major | `TC.DASH.008.030` |
| **K10** | Dashboard › Clinic Switch | Uncaught JS exception `"No method named 'destroy'"` during source-clinic teardown (jQuery plugin lifecycle) | Major | `TC.DASH.008.031` |
| **K11** | Dashboard › Widget Render | Widget graphs do not render on initial dashboard load — user must switch widgets / cards to trigger paint | Major | `TC.DASH.006.041` (manual; needs deterministic repro before automation) |
| **K12** | Dashboard ↔ Reports | Same metric returns different numbers on dashboard widget vs Reports module for the same date range. Flagged `unverified` in dashboard — date-range-dependent, needs a live comparison probe to confirm on the current build. | **Critical** | TESTPLAN.md only — Reports module out of automation scope |
| **K13** | Dashboard › Topbar | Consentz brand logo is not a hyperlink to the homepage; clicking opens a gridmenu instead | Major | `TC.DASH.002.029` |
| **K14** | Settings › Subscription | Per-clinic subscription hyperlink (e.g. "Teal Swing Sandbox") routes to the Templates page instead of subscription detail. Original v3 observation. | Major | TESTPLAN.md only — Settings/Subscription out of scope |
| **K15** | Settings › Subscription | Default payment-method card is deletable with no warning, leaving the account without a card on file. Original v3 observation. | **Critical** | TESTPLAN.md only — Settings/Subscription out of scope |
| **K18** | Dashboard › Widget Library | Library does not visually indicate which widgets are already on the dashboard | Major | `TC.DASH.005.041` (manual; awaits "selected" selector) |
| **K19** | Dashboard › Widget Library | Re-clicking an already-added Library tile shows error message instead of removing (toggle); behaviour also varies on first vs subsequent attempts | Major | `TC.DASH.005.042` |
| **K20** | Dashboard › Widget Settings | Changing widget Settings shows three stacked loading spinners simultaneously instead of one | Minor | `TC.DASH.006.042` |
| **K21** | Patients › Add Patient | Saving a firstName of **46 or more characters** returns **HTTP 500 Internal Server Error** ("Oops! An Error Occurred"). 1–45 chars saves cleanly; 46+ chars always 500s. Threshold pinned via binary-narrow probe 2026-05-11. Form has no client-side max-length enforcement, so any normal user with a long-but-plausible name (compound names, paste mistake) crashes the server — likely a `varchar(45)` DB column or Symfony validator `max: 45` not surfaced as a form-level error. Verified on v3, clinic 1080. | **Critical** | `tests/patients/patients-boundary.spec.ts` › "long firstName (200 chars)…" + `tests/patients/patients-security.spec.ts` › "XSS payload as firstName…" (52-char XSS payload triggers the same 500; manual repro by Piyush 2026-05-11 confirmed the bug is length-only — XSS content saves fine when short). |
| **K22** | Patients › Search | A patient with a non-ASCII firstName (e.g. `Müller<marker>` + lastName `张伟`) saves correctly and is visible on `/admin/clinics/{id}/patients/{id}/edit`, but is **invisible to the list search** even when the query is an ASCII substring of the firstName. The same search pattern works for fully-ASCII patients in the same suite. Verified 2026-05-11 on v3, clinic 1080. | Major | `tests/patients/patients-boundary.spec.ts` › "[K22] save accepts unicode names (accented + CJK) AND is then searchable" |

---

## Triage notes

**K8 (Critical).** The CKEditor library failing to load means clinic users cannot edit Terms & Conditions on this clinic. Recommend triage with the engineering team.

**K21 (Critical).** Surfaces a 500 on regular Add Patient input — no special privilege required, no HTML/script content needed. Threshold = 46 chars exactly. Suggested fix: enforce `maxLength` client-side and surface a form-level validation error server-side instead of letting the DB layer 500.

**K22 (Major).** Save is fine, search is the problem. The patient row exists in the DB (reachable by direct `/edit` URL) but the search index either skips non-ASCII names entirely or normalises in a way that breaks substring match. Real UX impact — a clinic adding "Müller" can't find them in the patient list.

## Dropped (no longer reproducible)

- **K16 (was Minor, Auth › Login)** — "Invalid-credentials error renders inconsistently." Dropped 2026-05-13: anecdotal observation, original v3 behavior could not be reproduced deterministically.
- **K17 (was Major, Auth › Login)** — "Lockout / rate-limit timer behaves inconsistently." Dropped 2026-05-13: anecdotal observation, no deterministic reproduction. Rate-limit itself (~4–5 attempts/3 min) is a known staging-auth quirk, not a defect. Re-raise with a specific, reproducible delta if observed again.
- **K23 (was Critical, Auth › Login)** — "POST /admin/login_check returns HTTP 500 on invalid credentials." Dropped 2026-05-13: was a **v4-only** behavior — probe-verified against v3 confirms invalid credentials correctly land on the login form with an inline error (no 500). The K23 tripwire spec (`tests/auth/login-known-bugs.spec.ts`) was converted into a positive regression test that locks in this v3 contract.

---

## When you fix a bug

1. Run the surfacing test — it should now turn red (because the `test.fail()` no longer matches).
2. Remove the `test.fail()` / `test.skip()` annotation; the test becomes a regression.
3. Delete the row from this catalogue.
4. Delete any related entry from `tests/patients/patients-known-bugs.spec.ts` / `tests/calendar/calendar-known-bugs.spec.ts` (the registries throw on unknown IDs, forcing the cleanup).
