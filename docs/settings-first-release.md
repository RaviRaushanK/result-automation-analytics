# Settings First Release

Implemented on 13 October 2026. Academic policy and academic data are unchanged.
No database reset or seed was executed.

Settings success feedback appears at the top right below the navbar and dismisses
after five seconds, with a manual dismiss button. Validation errors stay inline.
The navbar account menu contains Profile and Logout; Account Security remains in
Settings. Shared password fields show an accessible visibility toggle only when
nonempty, default to masked, and return to masked when cleared.

## Routes and Access

| Route | Behavior |
| --- | --- |
| GET /settings | My Account by default; section selected through a validated query parameter |
| GET /settings?section=account | Current active account and email form |
| GET /settings?section=security | Shared password form using the existing backend |
| GET /settings?section=appearance | Browser-specific System/Light/Dark preference |
| GET /settings?section=institution | Administrator branding form, preview, logo and recent configuration audit |
| GET /settings?section=academic-policy | Read-only policy for administrators and faculty |
| GET /settings?section=system | Administrator-only runtime and upload information |
| POST /settings/account | Own email update |
| POST /settings/institution | Administrator branding update |
| POST /settings/logo | Administrator logo upload or removal |
| GET /profile | Redirect to /settings?section=account |
| GET/POST /account-security | Existing password workflow, now with CSRF and shared form |

The existing sidebar footer destination remains the Settings entry. The navbar
uses the authenticated username and role, with a full username tooltip when its
display is shortened. Settings loads the current active AdminUser from the
database, rather than trusting cached session roles for global writes. Global
updates also recheck administrator status inside their database transaction.

## Account and Security

My Account displays username, role, status, last login and email from supported
AdminUser fields. Missing last login displays "Not recorded". No password hash
is selected for this page. Email is trimmed, normalized to lowercase, validated
and bounded to 100 characters. Uniqueness checks include other accounts occupying
the database unique key, with database collision errors handled safely. Only
email and the CSRF field are accepted. Student and faculty records are not linked
or changed.

Account Security reuses one partial and the existing authController verification,
bcrypt hashing, six-character minimum, confirmation and session-destruction
behavior. Its POST rejects unexpected fields. Successful changes redirect to a
login message explaining that the password changed. Passwords are neither stored
in plaintext nor logged. Successful Settings saves use POST/303 redirect/GET;
validation errors preserve bounded, escaped input and show associated errors.

## Appearance

Appearance is browser-specific, not synchronized per account or across devices.
The existing `sraas-theme` localStorage key now stores the preference: `system`,
`light` or `dark`. The `themePreference` cookie mirrors it; the existing `theme`
cookie stores only the resolved light/dark color for server rendering.

System resolves through a retained MediaQueryList and continues responding to OS
theme changes without replacing the stored `system` preference. Explicit Light
or Dark ignores OS changes. The Settings radio controls and navbar toggle share
one implementation; the toggle chooses the opposite resolved theme as an explicit
preference. Storage events synchronize tabs in the same browser. Valid existing
light/dark preferences are preserved, and invalid cookies are rejected.

## Institution and Reports

| Global SystemSetting key | Limit/default |
| --- | --- |
| institution_name | Required, 120 characters; SRAAS |
| institution_short_name | Required, 40 characters; SRAAS |
| institution_address | 255 characters; empty |
| institution_phone | 50 characters; empty |
| institution_email | Valid email, 100 characters; empty |
| report_footer | 255 characters; empty |
| institution_logo | Server-generated reference; empty |

These are the only writable global keys. Existing initialization keys such as
PASS_PERCENTAGE_RULE are neither edited nor used as the academic policy source.
The existing 255-character SystemSetting value column is unchanged. Invalid
stored branding falls back to normalized defaults; missing branding never makes
reports blank. MCA remains fixed.

The Settings preview responds to text edits before saving. All eight reports
consume a centralized branding provider in their page/API/print controllers:
Student, Class, Subject, Toppers, Consolidated, Student Progress, Result Analysis
and Revaluation. Views make no settings queries. Preview headers, print/PDF
headers, contacts and footers use the same provider. Nondefault text branding is
inserted only into the existing CSV metadata area; default CSV output and table
columns remain unchanged. Logos are omitted from CSV. Academic rows, metrics,
filters, ranking and Original/Effective calculations remain in their existing
services.

Logos accept PNG/JPEG/WebP up to 2 MB. Extension, declared MIME and decoded format
must agree. SVG, invalid images, animation and oversized input are rejected.
Decoded input is limited to four million pixels and re-encoded as PNG, stripped
of original metadata, resized within 512 x 512, and saved under a generated UUID
in `uploads/branding`. Only an application-relative reference is stored. Arbitrary
destinations and submitted paths are never accepted. Old successful logos remain
available for audit references; failed saves remove their newly created file.
Absent or unreadable logos display the MCA fallback.

## Read-only Information

Academic Policy derives scheme, points, participation types and percentage bands
from academicPolicy.js, including fractional boundary wording. Its expanded
reference reads the maintained academic-result-semantics document, excluding the
implementation manifest. It includes course identity, first sittings, retakes,
clearance, SGPA/CGPA provenance and approved-effective revaluation rules. Only
administrators see the navigation link to the existing course-roster review.
There is no policy-writing endpoint.

System Information shows application description/version, Node version, a safe
environment label, Connected/Unavailable database health, and supported imports.
Shared upload constants are consumed by the actual middleware and the information
page: result PDF 15 MB, revaluation PDF 15 MB, student CSV/XLS/XLSX 10 MB. These
limits are read-only. Credentials, connection strings, session secrets, private
paths and arbitrary environment values are not rendered. Session duration remains
deployment configuration and is not exposed as an editable setting.

## Audit, CSRF and Migration

`setting_audits` is the only new database table. It stores key, previous/new value,
actor account ID and timestamp. Settings upserts explicitly maintain updated_at
and commit with their audit rows in one transaction. Unchanged values create no
false change event. Validation failures do not save or audit; audit failures roll
back settings. Audit storage contains only allowlisted branding values and logo
references, never passwords or environment secrets.

`20261013100000-settings-audit.js` was applied after confirming that all prior
migrations were already up. It creates only the additive audit table and index;
its rollback intentionally refuses to discard audit history. No academic tables
were migrated, modified, dropped or reseeded.

The repository had no existing CSRF strategy. A session-bound 32-byte random
synchronizer token now protects Settings email/branding/logo writes and existing
password changes, using a constant-time comparison. Multipart uploads use capped
memory storage before token validation; no file is persisted before validation.
Authentication precedes Settings reads, current-account authorization precedes
global writes, and server-side allowlists prevent mass assignment. EJS escapes
stored and submitted text; dynamic branding uses textContent.

## Verification and Limitations

Nine new automated tests cover routes/ownership/CSRF, malformed and duplicate
emails, forbidden fields and policy writes, XSS escaping, actual image validation,
logo CSRF/admin restrictions, password reuse, System theme changes and cookie
validation. Repository tests verify timestamps, audit actor/values, transaction
rollback and current administrator authority. A MySQL integration fixture writes
only inside a transaction and rolls back; prior settings are checked unchanged.

The Edge harness uses isolated in-memory settings/account fixtures for browser
writes and removes its generated test logos. It verifies all six Settings
sections at 1440, 1280, 768 and 390 pixels in both themes, profile redirect, email
save, live branding preview, logo pixels, audit events, and System-resolved Dark
then Light via emulated OS changes. Navigation, labels, focus styles, associated
errors and logo alternatives were checked in markup and screenshots. Browser
checks also verify branding on all eight report APIs, CSV and print outputs,
compare rows and metrics with the unchanged service, and retain existing report
preview/PDF and all Analytics regressions.

The full suite reports 141 tests: 135 passed, four failed and two skipped. The
four failures remain the previously reproduced demo-seed baseline failures:
missing seed_all.js, outdated result/event counts, and an attempted demo marks
generation for a protected real student. No Settings, Reports or Analytics tests
fail. Therefore the full-suite-green acceptance condition remains outstanding.

User Administration, synchronized report preferences, notifications and backup/
restore are not implemented. Before User Administration, extend current-role/
active-status revalidation to other privileged workflows, define session
revocation, regenerate sessions at login, protect the last active administrator,
and explicitly model any faculty/login relationship. Before synchronized report
preferences, add account-keyed storage and keep explicit URL/filter selections
above defaults, respecting each report's permitted modes. Appearance currently
remains browser-local, and deployment/session security configuration is unchanged.

## File Manifest

Created:

- config/uploadLimits.js
- controllers/settingsController.js
- database/models/SettingAudit.js
- middlewares/csrfMiddleware.js
- migrations/20261013100000-settings-audit.js
- repositories/settingsRepository.js
- routes/settingsRoutes.js
- services/settingsService.js
- public/css/settings.css
- public/js/settings.js
- public/js/reports/branding.js
- views/settings/index.ejs
- views/auth/partials/password-form.ejs
- views/reports/partials/branding.ejs
- tests/settings.test.js
- tests/settings-theme.test.js
- docs/settings-first-release.md

Modified:

- app.js
- controllers/authController.js
- controllers/reportsController.js
- database/models/index.js
- middlewares/themeMiddleware.js
- middlewares/upload.js
- public/css/reports.css
- public/js/reports/common.js
- public/js/themeSwitcher.js
- routes/authRoutes.js
- routes/resultRoutes.js
- routes/studentRoutes.js
- services/reportsService.js
- views/auth/account-security.ejs
- views/auth/login.ejs
- views/partials/navbar.ejs
- views/reports/partials/page.ejs
- views/reports/print.ejs
- tests/reports-browser.js
