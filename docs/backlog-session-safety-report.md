# Backlog examination-session safety

Implemented and verified on 23 October 2026, following the audit and the user's
request to retain separate uploads and existing academic calculations.

## Root cause and validation

Previous history validation accepted an earlier REGULAR result either from an
earlier period or from the same session with a lower attempt number. It checked
the next semester attempt number but did not reject an already-used examination
period. Consequently, BACKLOG 2 could reuse REGULAR 1's period.

The existing history service now rejects BACKLOG if any saved result for that
student and academic semester has the same normalized examination month and year.
It compares periods, not session IDs, so alternate IDs do not bypass the rule.
The existing academic policy period helper recognizes exact full month names and
three-letter abbreviations, ignoring case and surrounding spaces. It does not
invent unknown dates or introduce new chronology beyond the existing checks.

The shared validator runs at Validate, Preview and final confirmation. Existing
sequence rules remain: REGULAR 1, BACKLOG 2, 3 and onward per student/semester
across sessions, rejecting skipped/reused numbers with no new application cap.
Another semester starts at REGULAR 1. Historical participation labels and stored
attempt numbers are preserved.

## Session identity protection

Session update now runs in a transaction and locks the session row. If results
exist, semester/month/year changes return HTTP 409 with guidance to create a new
session. Batch changes are explicitly rejected, preserving the existing rule
that a session's batch is not editable. Normalized semantic no-ops are allowed;
month/year corrections remain possible before results exist. The existing guard
against changing the semester of configured offerings remains intact.

Final result import locks the selected session before academic persistence and
rejects identity changes detected between context loading and the lock. The legacy
REGULAR create endpoint also locks its session. These paths coordinate with
Session Management to prevent a concurrent edit from changing imported context.
The successful session-update response is sent after its transaction commits.

No historical sessions were deleted, no original marks were changed, and no
historical results were renumbered.

## Mixed documents and GPA

The workflow remains one selected session per upload. Extraction maps only the
selected session's configured subjects. Codes extracted outside that scope are
retained in `excluded_subjects` draft metadata and displayed explicitly as not
being imported. That metadata survives validation failures and successful
validation, and is shown on Review and Preview. Both screens explain the selected
session, the import scope, and the requirement for separate uploads.

Out-of-session subject IDs submitted directly to validation remain rejected.
There is no automatic mixed-card splitting or automatic inference of the actual
examination period: the administrator must still select the correct new session.
Old drafts without excluded-subject metadata show the general scope notice.

SGPA and CGPA formulas/policies were not changed. BACKLOG still stores SGPA NULL;
REGULAR retains existing verified full-roster SGPA. Backlog persistence creates a
new Result and SubjectResult rows; the original REGULAR result remains unchanged.
Revaluation production code and Analytics architecture were not modified.

## Files changed in this task

Production files:

- `services/academicPolicy.js` — conventional month-name normalization.
- `services/resultHistoryService.js` — reject reused semester exam periods.
- `controllers/resultController.js` — session lock/check and excluded-row metadata.
- `controllers/sessionController.js` — transactional identity protection.
- `views/results/review.ejs`, `views/results/preview.ejs` — import-scope notice.
- `views/results/partials/import-scope.ejs` — shared scope/exclusion display.

Tests:

- `tests/session-identity-safety.test.js` — new isolated session-edit checks.
- `tests/result-history.test.js` — same/different-ID period rejection, normalized
  month values, Dec/June independent semester scenarios, sequence checks,
  session-change detection, escaped exclusion notices, and forged subject IDs.
- `tests/pdf-extraction-completeness.test.js` — mixed extraction scope/exclusions.
- `tests/result-persistence.test.js` — genuinely different-period backlog fixture
  and mocked session lock; existing GPA/persistence checks retained.
- `tests/result-student-registration.test.js` — mocked session lock.
- `tests/academic-form-edits.test.js`, `tests/academic-outcomes.test.js` — isolated
  transaction/count fixtures for the strengthened session-update path.

Documentation: `docs/academic-result-semantics.md` and this report.

## Verification executed

Final focused run: 250 tests, 249 passed, 1 optional settings database test skipped,
zero failures:

```powershell
node --test tests/session-identity-safety.test.js tests/exam-types.test.js tests/result-history.test.js tests/pdf-extraction-completeness.test.js tests/result-preview-cgpa.test.js tests/result-persistence.test.js tests/result-student-registration.test.js tests/marks-card-upload.test.js tests/academic-form-edits.test.js tests/academic-form-defaults.test.js test/analytics-overview.test.js test/analytics-toppers.test.js test/analytics-revaluation.test.js tests/analytics-reports-ux.test.js tests/settings.test.js tests/revaluation-duplicate-validation.test.js tests/revaluation-success.test.js tests/result-management-layout.test.js tests/result-success.test.js
```

Read-only MySQL fixture run: 69 tests passed, no skips or failures:

```powershell
$env:REPORTS_DB_TEST = '1'
node --test tests/reports.test.js tests/academic-outcomes.test.js tests/analytics-failed.test.js tests/analytics-progress.test.js
Remove-Item Env:REPORTS_DB_TEST
```

These integration tests use SELECT/CTE fixtures. Session identity changes and
imports were tested against isolated mocks, never by modifying real result data.
Existing revaluation, SGPA/CGPA, Original/Effective overlay, ranking, result-upload
and report checks passed. `git diff --check` passed. No interactive browser session
or real result import was performed. A final live database query was SELECT-only.

Database changes: none; no migration, schema update, seed, conversion or result
record mutation was performed. No commit or push was performed.

## Final git status

The working tree includes the earlier exam-type changes from this conversation.
All were preserved. Modified tracked files:

```text
controllers/resultController.js
controllers/sessionController.js
database/models/Result.js
docs/academic-result-semantics.md
docs/database-structure.md
public/js/analytics/failed.js
public/js/analytics/overview.js
public/js/analytics/subjects.js
public/js/analytics/toppers.js
public/js/reports/result-analysis.js
public/js/results/uploadSession.js
services/academicPolicy.js
services/reportsService.js
services/resultHistoryService.js
services/settingsService.js
tests/academic-form-edits.test.js
tests/academic-outcomes.test.js
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
views/results/preview.ejs
views/results/review.ejs
views/results/upload.ejs
```

Untracked files:

```text
docs/backlog-session-safety-report.md
docs/exam-type-simplification-report.md
tests/exam-types.test.js
tests/session-identity-safety.test.js
views/analytics/partials/exam-type-filter.ejs
views/results/partials/import-scope.ejs
```
