# Views

Account views and Faculty navigation reviewed on 29 October 2026. Other feature views last
reviewed on 17 October 2026; report/revaluation notes updated on 26 October 2026.
Templates use EJS and `express-ejs-layouts`.

## Current Pages

| Directory | Templates / Purpose |
| --- | --- |
| `analytics/` | overview, students, toppers, failed, subjects, semesters, progress, revaluation |
| `auth/` | login, invited registration, invitations, inline-OTP forgot-password, reset-password, compatibility account-security page, shared password and welcome-panel partials |
| `batches/` | batch list and create/edit dialogs; shared year-input partial |
| `dashboard/` | dashboard filters, metrics, pie/subject/grade charts and attention rows |
| `errors/` | 404, 500 and styled account-access-disabled page (403) |
| `faculty/` | faculty creation, confirmed Activate/Deactivate dialog, and per-subject multi-faculty assignment |
| `landing/` | public landing page |
| `reports/` | overview plus eight reports, standalone print view and shared table/branding partials |
| `results/` | upload, review, validated preview, success and logs |
| `revaluation/` | session/student/attempt selection, upload, recovery/pending, review and outcome |
| `exam-sessions/` | examination session management |
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

### Public-page contrast and motion (23 October 2026)

`public/css/home.css` owns the landing page's fixed light palette and its
one-time entrance animations. `public/css/auth-pages.css` scopes light text
tokens to white authentication cards, preserving the navy welcome panel.
These local palettes prevent global dark-theme heading/paragraph/form rules
from producing light text on white surfaces. Keep overrides scoped rather than
changing the user's persisted appearance preference.

`public/css/dashboard.css` maps Bootstrap card and table text variables to the
workspace theme tokens and supplies readable dark-mode status colors. The public
landing page (`/`) and signed-in dashboard are separate views/stylesheets.

Landing animation rules run only under `prefers-reduced-motion: no-preference`.
The navigation, hero copy, preview and feature cards animate once per page load;
the mobile preview ends without rotation. There is no animation script or
additional dependency. Preserve reduced-motion visibility and text contrast
when changing these styles.

## Important Workflow Views

**Public/authentication:** `landing/index.ejs` uses `home.css`,
`home-navigation.css` and `homeNavigation.js`. Login, Forgot Password and Reset
Password share `auth/partials/welcome-panel.ejs` and `auth-pages.css` alongside
the shared login/registration styles. Registration uses `registration.css`.
`passwordRecovery.js` handles inline recovery resends; `passwordVisibility.js`
handles reset-password visibility controls. The old standalone OTP template
and `landing.css` have been removed. `/verify-otp` is a redirect, not a view.

**Invitations:** the administrator selects an existing active faculty record and
provides the invitation email. Registration checks the faculty code and verifies
email; phone fields and mobile verification are removed. The page emails a private registration link and shows the
recipient after SMTP acceptance. Failures retain a copyable link. The form
collapses under **Invite another faculty member** after success; localhost links are
explicitly marked as local tests.

**Faculty:** Manage Faculty lists active/inactive records with search, filtering
and a confirmation view inside the same dialog. `faculty-status.js` calls the
administrator-only registry/status APIs and refreshes active assignment choices
after a successful change. It does not delete historical assignments or reports.

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
The subject table retains roster order. Extracted subjects are review targets;
optional non-detected rows default to Reject, have disabled mark fields, and do
not create missing-subject warnings. Acceptance enables entry and a required
manual-confirmation checkbox. Internal starts from the stored original result.
Successful input checks do not add green check icons.

**Reports:** overview is the report center. Shared partials provide branding,
tables and compact print headers across all report types. Student names in
consolidated output are left-aligned. Browser print headers/footers are separate
from application-owned report headings.
The shared wording module keeps Generated at and at most two short notes for
each report on screen and print/PDF. Revised components and unavailable markers
come from the shared server projection; templates do not calculate them. See
[report semantics](../docs/report-mode-semantics.md) and
[labels and notes](../docs/report-analytics-wording.md).

**Settings:** success messages appear below the navbar, then dismiss. Validation
errors remain inline. The account menu has Profile and Logout; password fields
show an eye toggle only when nonempty.

## Disabled account page

`errors/account-disabled.ejs` uses the public layout and scoped `account-access.css`
for an accessible light/dark account-status message and administrator guidance.
The response helper keeps HTML and JSON denials consistent. No workspace navigation
or private account details appear. Return to sign in uses the existing logout flow
with a fixed login destination, so an old session cannot redirect back to a blocked
page. `account-access.test.js` verifies responses and navigation;
`account-access-browser.js` checks all four sidebar viewport widths and text/button
contrast in both themes.

## Faculty sidebar

Faculty sees a subtle Faculty Workspace label and only existing permitted links.
Analytics opens by default; Reports opens for the active report or on manual
expansion. Shared submenu labels, sizing and spacing are retained. Settings stays
at the bottom with no faculty profile block above it. Faculty-only layout rules
live in `public/css/faculty-sidebar.css`; Admin uses the existing shared styling.

`tests/faculty-sidebar.test.js` checks navigation, active states and route access.
`tests/faculty-sidebar-browser.js` checks 1440, 1024, 768 and 375px, both themes,
drawer/rail transitions and scrolling. Browser artifacts go to the OS temporary
directory. See [Faculty access](../docs/faculty-access.md).

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
