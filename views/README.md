# Views

Reviewed on 17 October 2026. Templates use EJS and `express-ejs-layouts`.

## Current Pages

| Directory | Templates / Purpose |
| --- | --- |
| `analytics/` | overview, students, toppers, failed, subjects, semesters, progress, revaluation |
| `auth/` | login, compatibility account-security page, shared password partial |
| `batches/` | batch list and create/edit dialogs; shared year-input partial |
| `dashboard/` | dashboard filters, metrics, pie/subject/grade charts and attention rows |
| `errors/` | 404 and 500 |
| `faculty/` | faculty management and per-subject multi-faculty assignment |
| `landing/` | public landing page |
| `reports/` | overview plus eight reports, standalone print view and shared table/branding partials |
| `results/` | upload, review, validated preview, success and logs |
| `revaluation/` | session/student/attempt selection, upload, recovery/pending, review and outcome |
| `sessions/` | session management |
| `settings/` | account, security, appearance, institution, policy and system sections |
| `students/` | student directory and reusable row partial |
| `subjects/` | examination-subject list/dialogs, roster/edit view and shared tabs |

There are no Chat Assistant, standalone department, separate Student Search, or
standalone batch-sessions pages. Settings uses the existing password partial;
there is no `layouts/auth.ejs` or separate change-password template.

## Layouts and Shared Partials

- `layouts/main.ejs`: authenticated workspace with navbar/sidebar, breadcrumbs,
  alerts, footer and shared scripts.
- `layouts/landing.ejs`: public/login presentation without the workspace sidebar.
- `reports/print.ejs`: standalone print rendering with `layout: false`.
- `partials/head.ejs`: Bootstrap/fonts/icons, shared tokens and supplied page CSS.
- `partials/navbar.ejs`, `sidebar.ejs`, `breadcrumbs.ejs`, `alerts.ejs`,
  `footer.ejs`, `scripts.ejs`: reusable workspace chrome.
- `results/partials/success-header.ejs`: shared persisted-success presentation for
  original import and eligible revaluation outcomes.

Routes/controllers select layouts and supply locals. Error rendering uses the
layout chosen by its handler, not a universally enforced error-only layout.

## Important Workflow Views

**Subjects:** `subjects/index.ejs` contains the examination configuration dialogs.
`subjects/courses.ejs` renders the integrated Semester Roster/read-only or edit
state. Verified rows remain read-only until explicit Edit Required Courses.
The subject-created roster reminder is anchored below Create Subject; other
subject notifications retain their existing fixed container and timing.

**Original results:** Review & Edit presents the original PDF/image alongside
editable identity and subject marks. Validate leads to a distinct preview before
an explicit transactional import. Zero component limits remain zero. Responsive
layouts keep forms/actions reachable and wide tables horizontally scrollable.

**Revaluation:** successful upload/extraction opens review directly. Identity
evidence, extracted rows, decisions and Validate share that review. Pending is
retained for failed extraction/retry; old extraction/approval URLs resume the
canonical flow rather than requiring unnecessary extra screens.

**Reports:** overview is the report center. Shared partials provide branding,
tables and compact print headers across all report types. Student names in
consolidated output are left-aligned. Browser print headers/footers are separate
from application-owned report headings.

**Settings:** success messages appear below the navbar, then dismiss. Validation
errors remain inline. The account menu has Profile and Logout; password fields
show an eye toggle only when nonempty.

## Rendering and Client Responsibilities

~~~text
Router -> Controller -> EJS page -> Selected layout/shared partials
                       |
                       +-> Feature JavaScript -> authenticated APIs
~~~

Pass display data and supported filter state from controllers/services. Keep
course clearance, GPA, identity ownership and effective-result selection out of
templates. Use escaped EJS output for user data. Only trusted template/partial
HTML should use unescaped insertion.

Use existing theme tokens, feature CSS and `workspace-responsive.css`. Reuse the
current Material Icons/Bootstrap controls and accessible labels. Conditional
navigation is not a substitute for server-side authorization.

## Verification

~~~powershell
node --test tests/workspace-layout.test.js tests/result-management-layout.test.js tests/subjects-roster.test.js tests/reports-print-layout.test.js
~~~

The optional `tests/reports-browser.js` harness covers browser rendering and
responsive/theme interactions with isolated fixtures and read-only report data.
Screenshots/PDFs go to a temporary directory, not the repository. Unit rendering
checks alone are not visual verification of every browser/viewport.
