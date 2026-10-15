# Analytics and Reports UX Update

## Routes and Navigation

`GET /reports` now renders the report center instead of redirecting to Student
Result. Its eight cards use the existing report titles and routes:

| Category | Reports |
| --- | --- |
| Academic Results | Student Result, Class Result, Subject Result, Consolidated Result |
| Performance & Progress | Toppers, All Students Progress, Result Analysis |
| Result Revision | Revaluation |

The center has no export or chart controls. Individual report previews, CSV and
print/PDF routes are preserved. Reports gain an Overview sidebar entry and
breadcrumb context. Analytics gains Progress / Backlog Trends; Students precedes
Toppers. Parent items retain their existing expansion behavior. Overview active
states are exact, including `/analytics` as an alias of `/analytics/overview`.
Long sidebar labels wrap, and active links expose `aria-current="page"`.

Analytics Overview retains its filters, calculations and charts. Students,
Subjects Attempted, Failed Subject Results and Average Marks link to their
relevant analysis pages. Secondary links open Semester, Progress and Revaluation
analysis. Only supported filters are passed: Semester Analysis receives no
session; Progress receives no attempt/session; Revaluation receives no mode or
attempt. Destination forms restore valid URL filter values. Overview charts
refresh their colors on theme changes and use the existing locally bundled
Chart.js. The mobile sidebar margin correction is scoped to Analytics.

## Progress and Backlog Trends

Page: `GET /analytics/progress`. Data: `GET /analytics/api/progress`.

Filters are Batch, one academic period (Semester or Academic Year), and
Original/Effective result basis. The default period is the latest recorded
semester, falling back to the first configured active semester. Period choices
come from active academic courses and recorded semesters. Academic year grouping
comes from `academicPolicy.academicYearGroups`, also used by the Progress report.
There is no department or examination-session filter: course clearance needs the
entire cross-session history. There is no Analytics CSV/PDF export.

| KPI | Definition |
| --- | --- |
| Total Students | All non-deleted students in the selected batch, counted once |
| Cleared Without Backlog | All selected required semesters passed in verified first regular sittings |
| Cleared With Backlog | Canonical completion supported by legitimate retake clearance of first-sitting failures |
| Currently Uncleared | Canonical evidence establishes required work remains uncleared |
| Unknown | Missing, ambiguous, unverified or insufficient history prevents safe classification |
| Backlog Clearance Rate | Cleared-with-backlog students / students with verified first-sitting failures and known completion classification, multiplied by 100 |

Unknown classifications and students without backlog are excluded from the
clearance denominator. A zero denominator returns JSON `null`, displayed as `-`.
A later REGULAR pass alone cannot certify completion with backlog.

Charts show selected-period completion status and stacked semester completion
trends. Trends include only students with recorded participation in each
semester; periods with no participation are omitted. Selecting a future period
shows Unknown, never inferred failure. Unknown remains visible in totals and
charts. Chart descriptions also provide textual counts.

The course table groups by stable AcademicCourse identity and shows verified
first-sitting failures, retake clearance, known uncleared counts and clearance
percentage. Names never establish equivalence. Unknown selected-period history
is excluded from this table. The attention table previews at most 20 known
uncleared students, displays the full matching count and links to Student Result
with Batch, Student and Result Basis restored. A separate link opens the formal
Student Progress report with compatible Batch/Mode filters.

## Academic Logic and Performance

No academic policy, mapping, migration or historical result values were changed.
The aggregator uses `academicOutcomeService.semesterOutcome` for course details
and `academicYearOutcome` for safe selected-period completion classification,
including a single-semester period. It uses the existing history loader and
approved-effective overlay from `academicRepository` and `reportsRepository`.
Pending/rejected events do not affect Effective outcomes. GPA is not recomputed.

Students are retrieved in chunks of 500. Each chunk uses three batched academic
history queries; there are no queries per student. Results and subject rows are
grouped by student in memory, with bounded attention previews. Controllers remain
HTTP adapters, aggregation stays in the service, and EJS is presentation only.
Failures propagate through the existing API error pattern rather than becoming
fabricated empty results.

## Files

Created:

- `config/reportCenter.js`
- `services/progressAnalyticsService.js`
- `views/analytics/progress.ejs`
- `views/reports/overview.ejs`
- `public/js/analytics/progress.js`
- `tests/analytics-progress.test.js`
- `tests/analytics-reports-ux.test.js`
- `docs/analytics-reports-ux.md`

Modified:

- `config/sidebar.json`
- `controllers/analyticsController.js`, `controllers/reportsController.js`
- `routes/analyticsRoutes.js`, `routes/reportsRoutes.js`
- `views/analytics/overview.ejs`, `views/partials/sidebar.ejs`
- `public/css/analytics.css`, `public/css/reports.css`, `public/css/tokens.css`
- `public/js/analytics/overview.js`, `page.js`, `subjects.js`, `failed.js`, `toppers.js`
- `public/js/reports/common.js`
- `test/analytics-overview.test.js`, `test/analytics-revaluation.test.js`
- `tests/reports-browser.js`

## Validation and Remaining Limitations

New tests cover completion, unresolved backlog, multiple retakes, supplementary,
repeat, unknown evidence, future periods, year completion, stable course identity,
zero denominators, attention limits, batch/mode forwarding, batched loading,
propagated database failures, authorized routes, report-card coverage, existing
page renders and sidebar active states. Read-only MySQL CTE fixtures verify
approved-effective revaluation and pending/rejected exclusion without data writes.

With `REPORTS_DB_TEST=1`, the full suite currently reports 124 tests: 118 passed,
4 failed and 2 skipped. All four failures are in unchanged `tests/demo-seed.test.js`:
missing `seed/seed_all.js`; an outdated 102-result expectation versus 92;
an attempt to generate demo percentages for a protected real student; and an
outdated nine-ledger-event expectation versus eight. The seed implementation and
these tests were not changed. The same four failures were reproduced in an
isolated temporary archive of committed HEAD, confirming they predate this work.
Excluding that file, 115 tests pass, no tests fail,
and one optional persisted-demo test is skipped. Thus the full-suite green
acceptance criterion remains outstanding despite passing Analytics/Reports
regressions. No seeds or migrations were run.

The read-only Edge harness verifies the report center, Analytics Overview and
Progress at 1440, 1280, 768 and 390 pixels in both themes, checks nonblank chart
pixels and exercises Original/Effective and academic-year changes. It also checks
existing Analytics APIs and URL filters, every formal report preview, filter
cascades, mobile/theme/reset behavior, CSV, full print and generated PDFs.
Screenshots are written to the temporary `sraas-reports-browser-*` output folder.
The harness now accepts smaller existing populations and derives completion
column assertions from actual academic periods. Pagination beyond the first
page is exercised only when the selected population exceeds the preview limit;
read-only repository tests independently cover pagination.

The UI continues to depend on the application's existing Bootstrap, font and
Material Icons CDN assets. Unknown counts can be large where existing academic
rosters/history have not been verified; these are deliberately not inferred.

## Failed Students Follow-up

The Failed Students renderer previously displayed raw revised fields in the
Effective columns. That left blanks when there was no approved effective event,
and Original mode did not retrieve comparison values at all. The API now returns
explicit original and effective values in both modes, using the existing highest
approved-effective event selection and original fallback. Mode still determines
failure membership: fail-to-pass revisions leave Effective failures; pass-to-fail
revisions enter them. Original mode preserves recorded failures for comparison.
No academic values or revaluation decisions were changed.

Both marks columns preserve decimal precision and zero marks. The status chart
uses the same explicit effective status as the table. Subject filters now load
and refresh alongside batch/semester/session choices. Request versions prevent
delayed responses from overwriting a newer selection; filter errors remain
visible rather than becoming fabricated empty results. Chart.js is loaded from
the existing local bundle.

`tests/analytics-failed.test.js` adds eight read-only MySQL fixture checks,
covering fallback, pending/rejected/inactive revisions, both directions of status
change, multiple approved events, decimal/zero/unknown marks, latest attempts,
subject filters and empty batch scope. The browser harness compares every table
cell with the API in both modes and delays an Original response while switching
to Effective to verify stale-response protection. Existing Analytics and all
report browser regressions pass.

After this follow-up, the full suite reports 132 tests: 126 passed, the same four
pre-existing demo-seed failures, and two skipped. Excluding the unchanged
demo-seed test file, 123 pass, none fail, and one is skipped.

## Chart Interaction and Navigation Polish

Overview bars now use category-based, non-intersecting hover interaction, with
immediate tooltip and hover transitions. A moving cursor reveals grade counts
and percentages or both Passed/Failed series for the nearest category, without
requiring an exact bar hit. Browser checks send actual mouse-movement events
above bars and verify the tooltip changes across categories.

Explore Academic Trends uses three responsive icon navigation tiles with themed
borders, hover and keyboard focus states. Student Result actions in Progress use
compact outlined icon buttons and student-specific accessible labels. Their
Batch/Student/Mode links now come from the loaded response, preserving the
authoritative result basis.

Effective Progress has been rechecked through the complete public service using
read-only fixtures: approved first-sitting and retake revisions update the proper
completion categories, backlog clearance rate, semester trends, course table and
attention list; pending/rejected revisions do not clear courses. A missing second
semester still leaves year completion Unknown. The browser submits Effective via
Apply Filters and compares all six KPIs, both chart datasets, attention links and
year-level counts with the service. Academic logic remains unchanged.

## Analytics Students Partial Search

Updated on 14 October 2026. Student / USN Search now matches partial USNs or
student names using escaped, bound LIKE text under the existing case-insensitive
database collation. Other Analytics pages retain their exact USN-filter semantics.
Batch, semester, session, result basis, attempt and pagination constraints remain
in force; no academic calculation or stored record changes.

Typing triggers search after 300 ms and resets pagination. AbortController and
an immediate sequence invalidation prevent earlier responses from overwriting
newer text, even before debounce fires. Clearing the field restores all matching
academic-result rows in the selected scope, not students without recorded results.

Tests cover the bound query, literal wildcard escaping, retained scope/attempt
filters, real read-only MySQL partial/case/name searches, and unchanged exact-USN
behavior on other pages. Browser regression verifies live typing, clearing, empty
results and ignored-cancellation races. Full suite: 156 tests, 150 passes, four
pre-existing demo-seed failures and two skips.

## Student Result Live Search

The Student Result report now has a Student / USN Search field beside the
existing Student selector. Partial USN/name text filters the student-options API
within the selected batch, using validated, trimmed, escaped LIKE replacements.
Search is bounded to 100 characters and respects soft deletes and existing
admin/faculty-only report authorization.

Typing uses a 300 ms debounce. It immediately invalidates the report and student
selection, aborts pending filter/report requests, and resets dependent periods.
The existing cascade version check rejects late responses even when abort is
ignored. One matching student is automatically selected and their recorded
semester/session options load; multiple matches remain an explicit choice.
Clearing search restores all students in that batch. Reset clears and disables
search until a batch is selected. Generate Report remains a separate command.

Search text is not submitted as an academic report filter. Report calculations,
result basis, exports and print remain unchanged. API tests cover text bounds,
escaping, batch scope, authorization and real read-only MySQL partial/name/case
matching. Browser checks cover live options, ambiguity, clearing, empty matches,
single-match period loading and ignored-cancellation races. Full regression:
159 tests, 153 passed, four pre-existing demo-seed failures and two skipped.
