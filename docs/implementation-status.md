# Implementation Status

Current account/navigation summary reviewed on 30 October 2026; academic workflow
summary reviewed on 26 October 2026. Dated verification
sections below remain historical snapshots, not a claim
that all production acceptance, deployment-security or external-service work is complete.

## Implemented

- Session-based authentication with current-account/role checks, faculty-only
  invitations linked to existing faculty records, email-only verification, and
  browser light/dark/system appearance.
- Faculty Dashboard/Analytics/Reports access and personal Settings, with academic
  management/student-directory/source-upload access restricted to administrators.
- Administrator Manage Faculty dialog lists active/inactive records and confirms
  Activate/Deactivate changes. Deactivation blocks login/existing sessions on the
  next request and preserves assignments/reports. No schema extension is required.
- Faculty sidebar uses original submenu styling, expands only Analytics by default,
  and has no profile block above Settings. See [Faculty access](faculty-access.md).
- Batch/session management with MCA defaults, split batch naming, year pickers,
  duration-derived semester options and calendar-derived session status labels.
- Stable AcademicCourse identities, session offerings, integrated Semester Roster
  review/edit, and many-to-many faculty assignments with more than two faculty.
- Student directory partial lookup, server pagination, filter/history/race handling,
  normalization, spreadsheet import and supported soft-delete restoration.
- Original and revaluation marks-card uploads for PDF, PNG, JPG and JPEG, 15 MB.
- Embedded-PDF completeness checks, local OCR, optional OCR/VLM/LLM hybrid
  extraction, sparse/focused table recovery, strict mark parsing and stage diagnostics.
- Original Validate-time student/batch/name, duplicate and prior-card checks,
  repeated before preview/final import. Extraction does not write academic results.
- Revaluation selection/upload, direct editable extracted review, Validate,
  explicit approval and protected historical/effective ledger persistence.
- Validated CGPA preview and stored GPA provenance; unknown history stays unavailable.
- Dashboard/Analytics interactions, Effective-result fallback and course-level
  Progress/Backlog outcomes, partial student search and report navigation.
- Report center with eight formal reports, CSV, shared compact browser print/PDF,
  branding, latest-batch defaults and left-aligned consolidated student names.
- Settings account/security, appearance, institution/report branding, audit,
  CSRF-protected Settings writes and read-only academic/system information.
- Responsive workspace/result-management layouts and persisted-success celebration
  shared by original imports and successful revaluation outcomes.
- Upload directories tracked only through four `.gitkeep` files; runtime
  uploaded files excluded from Git.

## Current report and review behavior (26 October 2026)

- Original Result reads the selected attempt; Effective Result applies only its
  approved, active revaluation. Shared helpers keep Student, Subject and
  Consolidated consistent across screen, CSV and print/PDF.
- Missing revised components fall back to originals. Unreconciled components are
  unavailable; the approved total remains authoritative. Stored GPA is unchanged.
- Backlog remains a separate attempt. Completion uses valid history;
  historical failed attempts are not erased by a later pass.
- Reports retain Generated at and at most two short, report-specific notes.
- Revaluation review keeps roster order and optional manual rows. Non-detected
  rows default to Reject and require acceptance and manual confirmation before
  they can become approval targets.
- Original result duplicate/history checks run at Validate, preview and final
  import. No automatic duplicate alert on initial Review is included.

See [report audit](report-mode-semantics.md), [wording](report-analytics-wording.md)
and [extraction workflow](result-extraction.md).

## Recent Cleanup

Maintenance review on 29 October 2026 corrected account/sidebar, authorization,
upload-access and database-model documentation. Phone-entry/provider files and
the removed sidebar profile are no longer described as active features. Legacy
storage and historical migrations remain for compatibility.

Removed the broken `seed/package.json` `all` alias targeting absent `seed_all.js`
and an unused OTP constant. Updated stale test expectations for the existing
92-result/eight-event demo plan, protected real identities, uppercase batch
names, and controller-provided template fields. Demo generation, calculations,
permissions and database schemas were not changed by this maintenance review.


Removed a historical validation report, the retired standalone history generator,
and the unreachable standalone batch-sessions template. Their stale references
and the obsolete rendering fixture entry were removed. Active regression tests,
migrations, private configuration and local uploads were retained.

Subject-created feedback is anchored below Create Subject. Its message, dismissal
timing and unrelated fixed notifications are unchanged.

## Verification Snapshot

### Styled account access denial - 30 October 2026

Disabled-account browser requests and verified-password login denials now render
an account-access page with institution-administrator guidance. It remains HTTP
403; JSON APIs retain a structured 403 denial. Return to sign in destroys the old
session through the existing logout route and redirects only to the fixed login
destination. Default logout behavior is preserved. No permission is relaxed.

Default-suite result: **975 tests, 960 passed, 0 failed, 15 optional tests skipped**.
All 75 EJS templates compiled. The isolated Edge account-access harness passed
eight width/theme combinations (1440, 1024, 768, 375px; light/dark), including
layout/overflow, contrast for text and primary button, and absence of workspace
navigation. HTTP tests cover HTML/JSON denials, both inactive-login branches,
wrong-password behavior and the sign-out/login return flow. Syntax checks and
`git diff --check` passed.


### Faculty status management - 30 October 2026

The complete default source suite passed: **974 tests, 959 passed, 0 failed,
15 optional tests skipped**, exit 0. The registry/status API test exercises current
administrator authority, CSRF, input rejection, stale status conflicts,
deactivation/login/session denial, reactivation and independently suspended
accounts using in-memory model fixtures. Existing Faculty creation/assignment
regressions remain green.

The isolated Edge status harness passed all eight width/theme combinations
(1440, 1024, 768, 375px; light/dark), including search/filtering, escaped names,
confirmation/cancel, activate/deactivate, duplicate-click prevention and stale
confirmation refresh. No real faculty status was changed by verification.
All 74 EJS templates compiled; changed JavaScript syntax and `git diff --check`
passed. No migration, reset or academic calculation change was performed.


### Maintenance and documentation audit - 29 October 2026

The complete default source suite across `tests/*.test.js` and `test/*.test.js`
ran on Node.js 24.13.0 with `REGISTRATION_DB_TEST=0`, `REPORTS_DB_TEST=0`, and
`DEMO_SEED_DB_TEST=0`: **973 tests, 958 passed, 0 failed, 15 skipped**, exit 0.
Optional integrations were not enabled and no demo reset or migration was run.

All 74 EJS templates compiled. Changed JavaScript files passed syntax checks,
both package manifests parsed, local Markdown links resolved, declared Node
script entry points existed, and literal runtime imports/EJS includes resolved.
`git diff --check` passed. No new browser or external-provider run was needed for
this documentation/test-fixture cleanup; earlier sidebar browser checks remain
separate, dated verification.

Earlier seed assertions incorrectly expected retired scripts, 102 results and
nine events, and attempted synthetic marks for protected identities. They now
check the existing 92 results, eight events and refusal to fabricate those marks.
Rendering fixtures now include the selected upload/session fields and success
link IDs that production controllers already supply. No runtime workflow was
changed to hide those failures.


### Reports and wording ? 26 October 2026

Latest relevant regression suite: 500 tests, 498 passed, 0 failed, 2 skipped,
exit 0, with REPORTS_DB_TEST=1. The skipped cases are opt-in persisted demo
Progress and isolated migration checks. Read-only report fixtures ran. Live
Student/Subject/Consolidated parity passed 18 checks without changing source
records. Syntax checks passed for 23 changed JavaScript files; all 74 EJS
templates compiled. Print/PDF HTML was tested; no PDF raster audit was performed.
This is a focused regression result, not a new full-suite claim.


### Public-page contrast and entrance motion — 23 October 2026

Implemented scoped contrast fixes in `home.css`, `auth-pages.css` and
`dashboard.css`, plus a brief staggered CSS entrance on the landing page.
Public light surfaces remain light in either application theme; the dashboard
continues to follow the selected workspace theme. Reduced-motion preferences
disable the landing animation.

Executed verification for this follow-up:

- Actual Login and Forgot Password pages: four browser contrast checks passed
  (two pages in light/dark themes).
- Rendered dashboard template: two theme contrast checks passed;
  `node --test tests/dashboard.test.js`: seven passed, zero failed/skipped.
- Actual public home page after the contrast fix: two theme checks passed,
  with a visual screenshot inspection.
- After adding motion, an isolated preview of the current landing template and
  styles passed two theme contrast checks and three checks for active entrance
  animation, reduced-motion visibility and mobile overflow. The application
  server was stopped at that point, so this was not a live-route animation test.
- `git diff --check` passed. No full regression suite was rerun for these
  CSS-only changes; the older full-suite snapshot below remains historical.

### Historical full-suite snapshot

The default full-suite run on 17 October 2026 used Node.js 24.13.0 with
`REPORTS_DB_TEST=0` and `DEMO_SEED_DB_TEST=0`:

| Outcome | Count |
| --- | ---: |
| Total | 411 |
| Passed | 396 |
| Failed | 5 |
| Skipped optional database checks | 10 |

Four failures at that checkpoint were `tests/demo-seed.test.js` fixture issues
(resolved in the 29 October maintenance run above):
missing `seed/seed_all.js`, obsolete result-count expectation, forbidden demo
generation for a protected real student, and obsolete event-count expectation.

The fifth was a local installation issue: `tests/student-validation.test.js`
could not load the declared `xlsx` dependency because it was absent from that
installation. The current installation resolves `xlsx`. Install the declared dependencies before relying on spreadsheet
import or that suite. No package files or runtime code were changed to hide it.

These counts are a dated execution result, not a permanent acceptance threshold.
That historical run was not green; see newer dated verification above when available. Optional database checks and the
complete Edge harness were not rerun for this documentation-only update.

Prior focused verification passed 219 extraction/workflow regressions, and later
cleanup verification passed 64 relevant checks. Prior live hybrid verification
used invented normal/revaluation cards in all four supported formats; the
affected real card was tested with local-only OCR. Those prior runs do not imply
a new live-provider call or academic database write during documentation review.

## Remaining Limits and Risks

- OCR/AI may misread layouts; review/Validate/approval remain required. Sparse
  recovery only retries when no usable matched row exists, not every partial omission.
- Rasterized PDF processing defaults to a three-page limit. Longer source cards
  need explicit completeness review and appropriate configuration.
- Hybrid mode transmits document data externally; external models, quotas,
  credentials and availability can change. Local-only mode is available.
- Uploaded source files require administrator authentication; branding remains
  public for page/report rendering. Git ignore rules alone are not access controls.
- Faculty accounts now link to existing faculty records; student self-service
  ownership is still not implemented. Legacy account phone/OTP fields remain
  stored for compatibility, while phone-entry and mobile-verification features
  are removed.
- CSRF/current-role improvements are specific to implemented workflows, not a
  claim of complete security hardening across every older endpoint.
- Certified programme-final GPA, effective post-revaluation cumulative GPA,
  native XLSX report export, User Administration and backup/restore UI are not implemented.
- Demo reset removes academic history, including protected profiles' results;
  it must not be used on real academic records.
- Environment suffix variants are not all ignored, and the npm lockfile remains
  ignored. These repository-policy issues were documented, not changed here.

See [README](../README.md), [Extraction](result-extraction.md),
[Academic Semantics](academic-result-semantics.md), and [Demo Data](../seed/README.md).
