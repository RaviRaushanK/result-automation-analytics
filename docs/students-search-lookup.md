# Students Search and Lookup

Implemented on 14 October 2026. The existing `/students` page remains the only
administrative student directory. No new lookup or results page was created.
No database migration, seed, reset, or academic-record update was performed.

## Files

Created:

- `repositories/studentDirectoryRepository.js`
- `services/studentDirectoryService.js`
- `middlewares/studentDirectoryMiddleware.js`
- `views/students/partials/rows.ejs`
- `tests/student-directory.test.js`
- `tests/student-directory-client.test.js`
- `docs/students-search-lookup.md`

Modified:

- `controllers/studentController.js`
- `routes/studentRoutes.js`
- `views/students/index.ejs`
- `public/js/students.js`
- `public/css/students.css`
- `config/sidebar.json`
- `tests/student-validation.test.js`
- `tests/reports-browser.js`
- `tests/reports.test.js`

Removed the unused empty `views/students/search.ejs` template. The old route
remains as a compatibility redirect, protected by directory authorization.

## Search and Scope

Canonical query parameters are `search`, `batch_id`, `category`, `status`,
`page`, and `pageSize`. `q` is accepted as a legacy search alias and normalized
to `search` by the browser and compatibility redirect.

USN, student name, and email use trimmed contains matching through Sequelize
`Op.like` conditions. Literal percent, underscore, and backslash characters are
escaped rather than interpreted as search wildcards. No raw user-supplied SQL
is concatenated. The inspected database uses `utf8mb4_unicode_ci` for these
identity fields, so matching remains case-insensitive under existing semantics.
Search text is bounded to 100 characters with no arbitrary minimum length.

The default remains the latest batch, ordered by start year, end year, and batch
ID descending. `batch_id=all` explicitly searches all batches. A specific batch
restricts the query to that batch. Category uses the existing Student field;
status supports active/inactive. Filters combine with search using the same
repository query for initial HTML and AJAX updates.

Normal records are non-soft-deleted. Both active and inactive students remain
available unless a status filter is selected, preserving management behavior.
Cross-batch rows retain USN, name, email, batch, category, and status.

## Pagination and Counts

The repository runs a database COUNT followed by a bounded SELECT with WHERE,
ORDER, LIMIT, and OFFSET. Only listing fields are selected. Batch is included
through the existing association, without per-row lookups.

Ordering is USN ascending, then student ID ascending. The default is 25 rows;
allowed sizes are 25, 50, and 100, matching Reports conventions. Pagination
returns `page`, `pageSize`, `totalRows`, and `totalPages`; out-of-range positive
pages clamp to the last available page, or page 1 for an empty result. Invalid
page/page-size values return safe validation errors. The former 500-row cap is
gone. A 537-record test verifies retrieval of the final page beyond that cap.

`/students/api/list` retains its `data` array and adds `filters` and `pagination`.
The footer displays the actual matching count and visible range. Summary cards
retain batch-wide scope, independently of search/category/status, and now use
database aggregates rather than downloading all students to count them in Node.

Filter/search/page-size changes reset to page 1. Page changes preserve filters.
Browser history stores canonical query state; refresh, back, and forward restore
the selected scope, filters, search, page, and page size.

## Request Reliability and Feedback

Typing retains the 300 ms debounce. Input invalidates the request sequence and
aborts outstanding work immediately, including the period before debounce fires.
Every list response checks its sequence before changing rows or controls, even
if cancellation is ignored. Summary-card requests have separate abort/sequence
protection so a previous batch cannot overwrite a newer batch's counts.

Existing rows remain visible during loading. A compact Searching status and
`aria-busy` describe progress; pagination is disabled while searching. Empty
results show the search text or selected-filter message, safely escaped. Genuine
errors retain prior rows and show inline feedback. Aborted/stale requests do not
produce errors. Server failures do not disclose raw database errors or stacks.

## Actions and Compatibility

Each row has a keyboard-accessible View Results action with the existing Material
assessment icon. It opens `/reports/student?batch_id=<id>&student_id=<id>` using
the actual Student identifiers, and the existing report initializes both selectors.
Selecting an academic period and generating the report remains in that workflow.
No marks, GPA, backlog, attempt, ranking, or Original/Effective logic was changed.

Edit/Delete remain distinct icon controls with descriptive accessible names and
native hover tooltips. Existing validation, import preview/confirmation, edit
confirmation, delete confirmation, and paranoid Student.destroy behavior remain.
Deleting a Student still soft-deletes it rather than deleting result history.

`/students/search?search=Ravi&batch_id=all` redirects to
`/students?search=Ravi&batch_id=all`. The `q` alias is supported. Recognized filter
and page values are preserved; unsupported parameters are not copied.

The redundant Student Search sidebar child is removed for every role. The
Student Repository group and its Students child explicitly allow admin/faculty,
avoiding an empty directory group for students.

## Authorization

The Students router explicitly requires authentication and an admin/faculty role
before every page, lookup, list, stats, category, CRUD, and import endpoint.
This does not rely on hiding sidebar links.

Admins retain browse/search/create/edit/delete/import access. Faculty retain the
same access they already had in the repository; no new faculty privilege or
invented read-only policy was introduced. Student and unknown roles receive 403,
including direct requests with another student's ID or altered query parameters.
Unauthenticated requests are rejected by the existing authentication middleware.

AdminUser has no authoritative relationship to Student.student_id. Student
self-service is therefore not provided, and ownership is never guessed from
username, name, email, or USN. Existing Reports authorization also denies the
student role. Current login/session role conventions are preserved; broader
session revocation is a separate authentication concern.

## Index Review

Reviewed the migration history and actual live students indexes: primary student
ID; unique student UUID, USN, and email; `idx_student_batch`; and
`idx_student_category`. There is no status index. No index was added blindly:
status has low cardinality, and arbitrary contains matching does not generally
benefit from a new ordinary B-tree name index. Future optimization should follow
measured query plans/workload, not an unproven migration.

## Verification

35 focused Students tests pass with `REPORTS_DB_TEST=1`. Coverage includes search
fields/case/partial matching, scopes, combined filters, soft deletes, stable
pagination beyond 500, counts/limits/offsets, page clamping, bounded inputs,
literal wildcard handling, real read-only MySQL queries, role restrictions,
admin/faculty mocked CRUD/import authorization, report links, and browser-client
cancellation/history/error/empty-state behavior. Existing CSV/XLS/XLSX import and
student validation tests pass.

Full suite with `REPORTS_DB_TEST=1`: 154 tests; 148 passed, 4 failed, 2 skipped.
The four failures are pre-existing `tests/demo-seed.test.js` problems reproduced
before implementation: missing `seed/seed_all.js`, stale 102-versus-92 results,
refusal to generate demo percentages for a protected real student, and stale
9-versus-8 ledger expectations. They were not changed or bypassed. Consequently,
the full-suite-green acceptance condition is not achieved, despite no Students
or report/Analytics regression failures.

The report-router fixture now injects default branding and restores it afterward;
this fixes dependence on live saved institution settings without changing them.

The headless Edge regression verifies initial/default-batch and All Batches
pages; exact/partial USN, name and email search; combined filters; pagination;
refresh/back/forward; clear search; result initialization; Edit/Delete dialogs;
ignored-cancellation races; retained rows on error; empty state; and responsive
light/dark layouts at 1440, 1280, 768, and 390 pixels. Mobile table scrolling stays
inside its focusable labelled region, with pagination/actions visually reviewed.
The same harness covers all eight reports and existing Analytics/Settings pages.
Browser checks do not submit actual student edits/deletions or seed records.

## Remaining Limits

Contains search and high-offset pagination may require measured optimization on
much larger databases. Default-batch search remains intentionally scoped until
All Batches is selected. Student self-service requires an authoritative ownership
mapping and a separate authorization design. Existing faculty management and
authentication-session policies are preserved rather than redesigned here.
