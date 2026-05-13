# Pending Items — DO NOT DELETE

Living document for outstanding test work that isn't yet covered, that's blocked on info / accounts, or that's mid-investigation. **Application bugs themselves live in [`BUGS.md`](BUGS.md) — this file only tracks work-to-do, not bugs.**

Filename has `DONOTDELETE` on purpose — keep this file in source so context isn't lost between sessions.

---

## Tracked-bug tripwires (active `test.skip`)

Each item below has a skipped test that will go red when the bug is fixed — at which point un-skip and the test becomes the regression.

- **Age label hidden for <1-year-olds.** Form computes age on DOB blur; for age <1 year the label renders nothing instead of showing months. Tripwire: `patients-known-bugs.spec.ts`.
- **Age label drops months component.** A 1-year-3-months-old patient displays as just "Age 1". Tripwire: `patients-known-bugs.spec.ts`.
- **Future DOB silently accepted.** Per Piyush, the form should reject with "Date of Birth cannot be in the future." Verified 2026-05-10 on v3: `01-01-2125` saves cleanly. Tripwire: `patients-known-bugs.spec.ts`.
- **Pre-1900 DOB silently accepted.** Per Piyush, year < 1900 should reject with "Date too old. Minimum year is 1900." Verified 2026-05-10 on v3: `01-01-1800` saves cleanly. Tripwire: `patients-known-bugs.spec.ts`.
- **Double-booking same practitioner + patient + time.** Silently saves twice on v3. Tripwire: `calendar-known-bugs.spec.ts`.

(All currently-known app bugs catalogued in `BUGS.md` as K1–K22.)

---

## In progress

- **Calendar booking flow.** Foundation in place — `pages/calendar/CalendarPage.ts` + `tests/calendar/calendar.spec.ts` smoke. Page loads, view-switching, modal-open all pass. Booking happy path + cancel/delete + patient-orphan-on-delete all green in the full suite. Remaining: edit-existing-appointment, checkout/mark-completed (blocked — see below), drag-drop time slot.

- **Search-index lag mitigation.** Newly-created patients are not immediately findable via the list search (~tens of seconds). Tests already use `expect.poll(..., { timeout: 90_000 })` to tolerate. Two specific cases observed in the 2026-05-11 full run: `patients-boundary` › unicode (fails — but app-side this is **K22**), and `patients` › edit-and-persist (flake under load — passes alone). Watching for further flakes; if it persists, consider a `noise`-style poll helper or accepting the index lag as a published contract.

---

## Pending tests — blocked on info / account setup

- **Non-admin role tests blocked on OTP.** `tester2` (super-admin) has no OTP, but every other role on the account requires one we can't intercept (ReceptionistTester2, PractitionerTester2, CoordinatorTester2, BookerTester2, SchedulerTester2). Until staging has an OTP bypass, role-based delete denial / field-visibility tests are blocked.
- **Calendar checkout / mark-completed flow.** `#checkoutEvent` modal exists in the DOM but no visible trigger is surfaced by `data-target="#checkoutEvent"`. Hypotheses: (a) only appears for past appointments, (b) bound via a JS handler not `data-target`, (c) accessed from the patient detail page. Needs targeted exploration.
- **Booking notes round-trip (currently skipped).** `calendar-fields.spec.ts` — modal stays open after Save when notes are filled. Re-enable and retry; if still failing, probe the modal's tab structure (`[data-toggle="tab"]` inside `#new_appointment_form`).
- **After-hours booking validation.** Bookings at 21:00–22:00 silently failed in the 2026-05-11 run — modal stayed open with no visible error. Could be (a) clinic operating hours, (b) a different validation, or (c) the picked practitioner has limited availability. Small probe to figure out the contract.
- **Pagination contract.** With 20 per page currently, create N>20 patients with a shared marker and verify next/prev controls. Run when clinic is clean.
- **Soft vs hard delete contract.** Today the `stale-delete URL` test only asserts "no 5xx" when visiting a deleted patient's edit URL. Need to confirm: 404? 410? Redirect with toast? Affects assertion specificity.
- **Two-tab race.** Open same patient in two tabs, edit firstName in both, save both. Proposed contract to confirm: *last-write-wins* (no conflict detection) — tab 2 wins, tab 1 silently overwritten. Or *first-save-wins, second errors* if optimistic locking exists.
- **Network throttle / offline during save.** Use `context.setOffline` or route throttling to drop the save POST. Verify form surfaces an error and doesn't leave half-state.
- **Browser back/forward consistency.** Walk list → /new → /{id}/edit, hit Back, then Forward. State should stay consistent.
- **`pageerror` + `console.error` watchers in the global fixture.** The 5xx watcher is already auto-attached via `tests/fixtures.ts` (`serverErrors` fixture, 2026-05-11). Same shape can be added for uncaught page errors and console errors — with an allowlist for known third-party noise. Mid-effort.

---

## Resolved / no longer pending

- **5xx-on-any-test auto-watcher** (resolved 2026-05-11): promoted into `tests/fixtures.ts` as the `serverErrors` fixture with `auto: true`. Every test now fails automatically if a 5xx fires during the run, with the captured URL list. Inline `page.on('response', …)` boilerplate stripped from 13 spec instances across 6 files.
- **DOB malformed-format validation** (resolved 2026-05-10): server rejects non-`DD-MM-YYYY` strings (e.g. `99-99-9999`) with "Invalid date format. Please use DD-MM-YYYY." Active test in `patients-fields.spec.ts`.
- **Multi-tenant clinic isolation** (resolved 2026-05-10): clinic 1081 added to `tester2`. Active tests in `patients-multitenant.spec.ts` + `calendar-multitenant.spec.ts` verify a patient/event in 1080 is invisible from 1081.
- **Patient delete with linked appointment** (resolved 2026-05-10): contract is "orphan, not cascade" — appointment stays on calendar, patient name replaced with "Patient record deleted". Active test in `calendar-booking.spec.ts`.
- **Appointment cancel/delete flow** (resolved 2026-05-11): event click → `#detailsEvent` → pencil icon → `#edit_appointment_form` → Delete button → direct navigation to `/appointments/{id}/delete/…` (no confirmation modal). Wired into `CalendarPage.cancelAppointment()`; active test in `calendar-booking.spec.ts`. *UX-worth-flagging:* appointment delete is one click with no undo (contrast: patient delete needs password).
- **Patient firstName length threshold pinned** (resolved 2026-05-11): probe nailed the K21 threshold at exactly 46 chars (≤45 saves, ≥46 always 500s). Logged in BUGS.md.
