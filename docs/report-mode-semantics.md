# Report mode audit

Audited 26 October 2026. All changes are read-only report projections; no
academic rows, passing rules, stored GPA or schema are changed.

## Definitions

- **Original Result:** the selected Result/SubjectResult attempt's stored
  internal/external marks, total, grade and result, before revaluation.
- **Effective Result:** that same attempt plus its highest-numbered approved,
  effective revaluation. Pending, rejected and non-effective events cannot overlay.
- **Backlog Attempt:** a separate Result, including a separate session offering
  where applicable. It never supplies marks to an earlier attempt.
- **Current Completion:** course/semester clearance evaluated over valid attempt
  history, after applying the chosen mode independently to each attempt.

Effective is not latest attempt. Latest/all attempt filters select rows; Original/
Effective changes the values of those selected rows without broadening their scope.

## Before/after audit matrix

"Selected" backlog means a backlog row may be included by explicit session,
exam-type or attempt filters, but does not overwrite regular rows.

| Report/page | Level | Before | After / revaluation | Backlog history | GPA basis |
|---|---|---|---|---|---|
| Student Result | Attempt history | Original IA/EX alongside effective totals | Shared component, total, grade and result projection per attempt | Separate sections for selected attempts | Stored header GPA; existing effective-mode omission retained |
| Subject Result | Attempt | Original IA/EX alongside effective totals | Same shared projection as Student/Consolidated | Selected attempts only | No GPA |
| Consolidated Result | Attempt | Revised components, but private reconciliation logic | Shared projection; existing unavailable markers retained | Selected attempts only | Stored SGPA; report TOTAL/% use selected subject totals |
| Class Result | Attempt | Same-attempt effective subject aggregation | Shared approved-event join/expressions | Selected attempts only | Stored original GPA; existing effective-mode omission retained |
| Toppers Report | Attempt ranking | Original-only, stored passing header and no original failures | Policy retained; stored CGPA ranking/ties unchanged | Selected attempts only | Stored original SGPA/CGPA |
| Result Analysis | Attempt participation | Mode-aware subjects, regular/backlog groups | Shared overlay expressions; no completion substitution | Separate selected participation groups | No GPA |
| All Students Progress | Completion | Effective attempt statuses followed by course history | Same shared overlay; existing completion rules preserved | Required for clearance | Existing verified original-history cumulative calculation, read-only |
| Revaluation Report | Event ledger | Original/revised totals and event state | Same exact target; component comparison is explicit; inactive events remain auditable | Only if the event targets a backlog attempt | No GPA |
| Analytics Overview | Attempt aggregates | Mode-aware subjects; stored headers separate | Shared overlay expressions | Explicit latest/all/session/type scope | Existing averages of stored GPA |
| Analytics Student | Attempt | Mode-aware subject aggregates; stored parent status | Shared overlay expressions; parent status remains stored | Selected attempts only | Stored SGPA/CGPA |
| Analytics Subject | Attempt | Mode-aware subject outcomes | Shared overlay expressions | Selected attempts only | No GPA |
| Analytics Semester | Attempt aggregates | Mode-aware subject outcomes; stored parent metrics | Shared overlay expressions; stored parent metrics remain distinct | Selected attempts only | Existing averages of stored GPA |
| Analytics Failed Students | Historical failed subject attempts | Mode-dependent failure membership, comparison columns | Policy retained via shared overlay; not current uncleared courses | Selected attempts only, never automatic clearance | No GPA |
| Analytics Toppers | Attempt ranking | Stored passing parent/CGPA, selected-mode subject eligibility | Existing policy retained; Effective can change eligibility, never GPA | Selected attempts only | Stored original CGPA ranking |
| Analytics Progress / Backlog Trends | Completion | Verified course history in selected mode | Existing history classification, with shared attempt overlay | Required for clearance | Existing original-history provenance rules |
| Analytics Revaluation | Event ledger | Approved-effective outcome counts plus raw pipeline counts | Shared event join; no pending/rejected overlay | Only targeted attempt | No GPA |
| Dashboard | Original attempt aggregates | Stored original marks/results only | Unchanged; no Effective selector is implied | Explicit session scope | Stored GPA aggregates |

## Shared implementation

`repositories/revaluationOverlay.js` selects one approved/effective event by
`subject_result_id` and maximum `revaluation_no`, and defines total/grade/result
expressions. Reports, Analytics and the academic-history repository reuse it.
No history-selection operation exists in this helper.

`services/subjectOutcome.js` exposes original/effective internal, external, total,
grade and result, event identity, component sources, fallback and reconciliation
metadata. Student, Subject and Consolidated use the same numeric presentation.

The approved total remains authoritative. Missing revised components fall back to
original components internally. If the resulting components are incomplete or do
not sum to the approved total, the established Consolidated policy displays both
component cells as unavailable. Raw original/effective values and source flags
remain in the report payload. No subtraction, inferred component or data repair
occurs. The same policy applies to screen, CSV and print/PDF.

The `effective_student_results` view was inspected read-only: it targets the same
SubjectResult, filters approved/effective events and picks the highest event number.
Its legacy `result_status` is a stored parent header; `effective_result` is the
subject outcome. Reporting repositories use their explicit subject projections,
not the legacy parent-status column. No view migration is required.

## GPA and completion

No stored SGPA/CGPA is recalculated or written. Consolidated TOTAL/% are report
aggregates of chosen subject totals, not a new academic GPA. Existing Progress
verified original-history cumulative values remain a separate derived measure.

History-based completion remains in `academicOutcomeService`: first-effective
regular PASS can clear without backlog; first failure followed by a valid retake
PASS can clear with backlog; known uncleared history remains uncleared; incomplete
or unverified history remains not determined. These rules are not reimplemented
in the attempt overlay helper.

## Live acceptance case

SINDHUKUMAR S, USN 1MV25MC074, Result 40, SubjectResult 248, MMC105,
Regular attempt 1 in ExamSession 1 was inspected read-only.

| View | IA | EX | Total | Grade | Result | Stored SGPA / CGPA |
|---|---:|---:|---:|---|---|---|
| Original | 30 | 15 | 45 | F | FAIL | 5.44 / 5.44 |
| Effective (event 15) | 30 | 20 | 50 | C | PASS | 5.44 / 5.44 |

The event stores revised EX 20 and total 50, with revised IA NULL; IA 30 is the
original fallback, not a newly inferred value. Student/Subject/Consolidated parity
and final live rechecks are recorded by the verification performed for this audit.

## Verification

- Broad report/analytics/history/progress/revaluation/GPA suite with REPORTS_DB_TEST=1: 499 tests, 497 passed, 0 failed, 2 skipped, exit code 0.
- Focused DB-backed report and analytics suite: 109 passed, 0 failed, 0 skipped, exit code 0 (overlaps the broad suite).
- Read-only live parity CLI: 18 passed, 0 failed, 0 skipped, exit code 0; academic source snapshots unchanged.
- JavaScript syntax: 21 passed, 0 failed, exit code 0. All EJS templates: 74 passed, 0 failed, exit code 0.
- Skipped: opt-in persisted demo Progress expectations and isolated database migration test. The new read-only CTE fixtures ran; no migration or seeding was performed.
- Screen table and print/PDF HTML rendering plus CSV were verified. No browser-generated PDF was rasterized.
- Latest-attempt analytics selection now respects an explicit exam type; semester failed Result counts count distinct Result attempts. Subject analytics joins enforce the selected session offering.

## Changed file manifest

- `docs/report-mode-semantics.md`
- `repositories/revaluationOverlay.js`
- `scripts/verify-report-mode-semantics.js`
- `services/subjectOutcome.js`
- `tests/report-outcome-semantics.test.js`
- `docs/academic-result-semantics.md`
- `docs/report-analytics-wording.md`
- `public/js/analytics/failed.js`
- `public/js/analytics/overview.js`
- `public/js/analytics/page.js`
- `public/js/analytics/progress.js`
- `public/js/analytics/subjects.js`
- `public/js/analytics/toppers.js`
- `public/js/reports/wording.js`
- `repositories/academicRepository.js`
- `repositories/analyticsRepository.js`
- `repositories/reportsRepository.js`
- `services/reportsService.js`
- `test/analytics-toppers.test.js`
- `tests/analytics-failed.test.js`
- `tests/consolidated-revaluation-presentation.test.js`
- `tests/report-analytics-wording.test.js`
- `tests/reports-print-layout.test.js`
- `tests/reports.test.js`
- `views/analytics/failed.ejs`
- `views/analytics/overview.ejs`
- `views/analytics/progress.ejs`
- `views/analytics/semesters.ejs`
- `views/analytics/students.ejs`
- `views/analytics/subjects.ejs`
- `views/analytics/toppers.ejs`
