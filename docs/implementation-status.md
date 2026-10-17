# Implementation Status

Reviewed on 17 October 2026. This is a source/verification snapshot, not a claim
that all production acceptance, deployment-security or external-service work is complete.

## Implemented

- Session-based authentication, workspace navigation and browser light/dark/system appearance.
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

## Recent Cleanup

Removed a historical validation report, the retired standalone history generator,
and the unreachable standalone batch-sessions template. Their stale references
and the obsolete rendering fixture entry were removed. Active regression tests,
migrations, private configuration and local uploads were retained.

Subject-created feedback is anchored below Create Subject. Its message, dismissal
timing and unrelated fixed notifications are unchanged.

## Verification Snapshot

The default full-suite run on 17 October 2026 used Node.js 24.13.0 with
`REPORTS_DB_TEST=0` and `DEMO_SEED_DB_TEST=0`:

| Outcome | Count |
| --- | ---: |
| Total | 411 |
| Passed | 396 |
| Failed | 5 |
| Skipped optional database checks | 10 |

Four failures are established `tests/demo-seed.test.js` baseline issues:
missing `seed/seed_all.js`, obsolete result-count expectation, forbidden demo
generation for a protected real student, and obsolete event-count expectation.

The fifth is a local installation issue: `tests/student-validation.test.js`
cannot load the declared `xlsx` dependency because it is absent from the current
`node_modules`. Install the declared dependencies before relying on spreadsheet
import or that suite. No package files or runtime code were changed to hide it.

These counts are a dated execution result, not a permanent acceptance threshold.
A full-suite-green claim would be incorrect. Optional database checks and the
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
- Uploaded files are currently served statically before authentication. Git
  ignore rules are not document access controls.
- The initial schema permits admin login roles only. Teaching faculty assignment
  does not establish a faculty account or student self-service ownership.
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
