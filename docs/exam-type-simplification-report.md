# VTU MCA exam-type simplification

Implemented and verified on 22 October 2026.

## Result

New uploads and imports accept only REGULAR and BACKLOG. Exam Type is required
in the upload form and on its server endpoint. Explicit review submissions reject
empty/missing types. Legacy draft types are rejected at validation, preview and
confirmation; their labels are retained rather than silently converted.
Drafts with no attempt metadata retain the existing REGULAR/1 fallback.

Following the user's follow-up confirmation, new attempt numbers continue per
student and academic semester across examination sessions: REGULAR 1, first
BACKLOG 2, then 3 and onward. A new semester starts at REGULAR 1. There is no
application maximum. Upload defaults and minimums follow the selected type;
Review allows correction of the Backlog number. The server checks the next
expected semester number at validation, preview and final confirmation, rejecting
reused and skipped numbers. The existing student/session/attempt database index
is retained; final saves lock the student and read current locked history to
serialize semester numbering. No historical result numbers are rewritten.
For legacy session-scoped numbers, the next value exceeds both the maximum
stored number and the number of recorded sittings. Tests cover attempts 2, 3,
25 and sanitizer acceptance of 1000, including stale validation before save.

## Database inspection and compatibility

Executed this read-only query before and after verification:

```sql
SELECT exam_type, COUNT(*) AS record_count
FROM results GROUP BY exam_type ORDER BY exam_type;
```

Both inspections returned REGULAR: 17; no BACKLOG, SUPPLEMENTARY or REPEAT rows.
The follow-up per-student/batch/semester audit found one record per observed
student semester, all numbered 1, so current records require no renumbering.
No migration, enum removal, data conversion or schema change was needed or run.
The model and migration retain the four-value enum, and the existing historical
retake classification remains intact. Legacy read API filters remain available;
All Exam Types includes historical types. Existing demo fixture scenarios are
retained, not regenerated or persisted.

## UI and Analytics

The upload select offers Regular and Backlog. Report filters for Class, Toppers
and Consolidated offer the same two types plus All Exam Types. Settings lists the
two normal participation types. Historical values can still appear on result,
report and revaluation displays.
The Progress report heading now reads Pass in Backlog, including CSV/print output;
its historical internal field names and clearance calculation are unchanged.
The Result Analysis group heading now reads BACKLOG rather than REPEATERS in
the browser, print and CSV. Its internal group key and aggregation remain unchanged;
the export basis explicitly identifies legacy types as historical participants.
Review preserves an explicit legacy draft label and shows a validation error,
rather than displaying it as Regular.

Overview, Students, Toppers, Failed Students, Subjects and Semesters Analytics
now expose a two-type filter plus All Exam Types, using the existing exact-type
repository filters. Browser query handling forwards the selection. Progress
continues to use complete course history, and Revaluation retains its existing
workflow and analytics. No aggregation, overlay, ranking or failure policy changed.

## Academic handling before and after

Before and after: verified full REGULAR imports calculate credit-weighted SGPA
including F grades; BACKLOG creates a separate attempt and stores no SGPA from
the attempted subset. Existing cumulative CGPA rules, semester prerequisites,
course acceptance, and stored snapshots are unchanged. Tests check that original
REGULAR SGPA/CGPA and subject history are not overwritten by a backlog import.

The SGPA explanatory wording in `views/results/preview.ejs` was already updated
in the preceding user-approved change; it remains in the working tree.

## Files inspected

Repository-wide searches covered controllers, services, repositories, routes,
models, migrations, schema, seeders, extraction, EJS, browser JavaScript, tests
and academic documentation. Principal files inspected:

- `controllers/resultController.js`, `controllers/analyticsController.js`,
  `controllers/revaluationController.js`, `controllers/sessionController.js`.
- `services/academicPolicy.js`, `academicOutcomeService.js`,
  `resultHistoryService.js`, `analyticsService.js`, `reportsService.js`,
  `settingsService.js`, `documentExtractor.js` under `services/`.
- `repositories/analyticsRepository.js`, `repositories/reportsRepository.js`.
- `database/models/Result.js`, `database/models/index.js`, `database/schema.sql`,
  `migrations/20260826110000-add-attempt-tracking-to-results.js` and academic migrations.
- `seed/academic/data.js`, `seed/academic/verify.js`, `seed/README.md`.
- Result upload/review/preview/success views, all Analytics views, report filter
  and historical display views, revaluation attempt displays, Settings view.
- Analytics browser scripts including `page.js`, result review script and
  report browser scripts; corresponding result/Analytics/revaluation tests.
- `docs/academic-result-semantics.md`, `package.json`.

## Files changed and final working-tree status

Modified:

```text
controllers/resultController.js
database/models/Result.js
docs/academic-result-semantics.md
docs/database-structure.md
public/js/analytics/failed.js
public/js/analytics/overview.js
public/js/analytics/subjects.js
public/js/analytics/toppers.js
public/js/results/uploadSession.js
public/js/reports/result-analysis.js
services/academicPolicy.js
services/reportsService.js
services/resultHistoryService.js
services/settingsService.js
tests/pdf-extraction-completeness.test.js
tests/reports.test.js
tests/result-history.test.js
tests/result-persistence.test.js
tests/result-preview-cgpa.test.js
tests/result-student-registration.test.js
views/analytics/failed.ejs
views/analytics/overview.ejs
views/analytics/semesters.ejs
views/analytics/students.ejs
views/analytics/subjects.ejs
views/analytics/toppers.ejs
views/reports/partials/page.ejs
views/reports/partials/result-analysis-table.ejs
views/results/preview.ejs (preceding approved wording change)
views/results/review.ejs
views/results/upload.ejs
```

New, untracked files:

```text
docs/exam-type-simplification-report.md
tests/exam-types.test.js
views/analytics/partials/exam-type-filter.ejs
```

The preview CGPA test fixture now stubs the duplicate-result lookup, avoiding its
previous accidental live lookup. Production CGPA calculation is unchanged.
The Result model's descriptive comment now explains semester attempt numbering;
the column type and enum are unchanged. No `tokens.css`, migrations, seed files
or revaluation production files changed. No commit or push was performed.

## Verification executed

Final focused command after the follow-up: 218 tests; 217 passed, 1 optional settings database test
skipped, zero failures:

```powershell
node --test tests/exam-types.test.js tests/result-history.test.js tests/pdf-extraction-completeness.test.js tests/result-preview-cgpa.test.js tests/result-persistence.test.js tests/result-student-registration.test.js tests/marks-card-upload.test.js test/analytics-overview.test.js test/analytics-toppers.test.js test/analytics-revaluation.test.js tests/analytics-reports-ux.test.js tests/settings.test.js tests/revaluation-duplicate-validation.test.js tests/revaluation-success.test.js tests/result-management-layout.test.js tests/result-success.test.js
```

Read-only MySQL integration command: 69 tests passed, no skips or failures:

```powershell
$env:REPORTS_DB_TEST = '1'
node --test tests/reports.test.js tests/academic-outcomes.test.js tests/analytics-failed.test.js tests/analytics-progress.test.js
Remove-Item Env:REPORTS_DB_TEST
```

After the final Result Analysis wording update, `tests/reports.test.js` was
rerun with `REPORTS_DB_TEST=1`: all 25 tests passed, including protected browser
routes, CSV and print rendering.

These database fixtures use SELECT/CTEs and do not insert academic records.
They include legacy labels, approved-effective overlays, original/effective
failure semantics, rankings, stored GPA, reports, exports and progression.
New filter tests verify exact SQL bindings for all four readable types in both
Original and Effective modes and that an omitted filter does not exclude legacy
types. EJS rendering verifies upload/report/Analytics option lists.
Browser-helper tests verify Regular 1 / Backlog 2 defaults and editable later
Backlog numbers. History tests check cross-session sequencing, duplicate Regular
rejection, legacy-number preservation, and final confirmation after another saved
attempt invalidates a draft's number. A separate read-only MySQL transaction
confirmed duplicate Regular rejection and two SELECT FOR UPDATE reads (student
and result history), then rolled back without writes.

`git diff --check` passed. Git reports LF-to-CRLF notices on two edited test files.
No interactive browser session or real production result import was performed.

An earlier broader run also executed unchanged `tests/demo-seed.test.js`.
Four demo-seed tests failed: missing `seed/seed_all.js`; plan count 92 versus
expected 102; refusal to fabricate percentages for real student 1MV25MC061;
ledger count 8 versus expected 9. The seed code and its test file have no diff,
and the historical EXAM_TYPES array is unchanged. These unrelated fixture/script
issues were left outside this implementation; demo persistence was not run.
