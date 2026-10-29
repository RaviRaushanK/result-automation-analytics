# Project Structure

Account/navigation paths reviewed on 29 October 2026; report paths on 26 October 2026. Paths below describe the repository.

~~~text
.
+-- app.js                  Express entry point
+-- package.json            Commands and dependencies
+-- .gitignore              Secrets/runtime ignore rules and upload placeholders
+-- .sequelizerc            Sequelize CLI path configuration
+-- config/                 Database/session/environment/menu/report configuration
+-- controllers/            HTTP handlers and workflow orchestration
+-- database/
|   +-- models/             Sequelize domain, OTP and invitation models
|   +-- schema.sql          Schema reference; not a replacement for migrations
+-- migrations/             Ordered database evolution
+-- init/                   Default settings, administrator and MCA department
+-- repositories/           Academic, student, Analytics, Reports and Settings queries
+-- services/               Extraction, academic outcomes, reporting and Settings
+-- middlewares/            Authentication, roles, CSRF, uploads and layout context
+-- routes/                 Page/API/workflow routers
+-- public/
|   +-- css/                Shared tokens and feature/responsive styles
|   +-- js/                 Feature clients, validation, charts and year picker
+-- views/                  EJS layouts, feature pages and reusable partials
+-- scripts/                Database bootstrap, initialization and read-only verification
+-- seed/                   Explicit guarded demo reset and maintenance utilities
|   +-- academic/           Deterministic data, safety, persistence and verification
+-- test/                   Analytics and legacy hybrid extraction tests
+-- tests/                  Focused regressions and optional Edge harness
|   +-- fixtures/           Isolated workspace/result-page rendering data
+-- uploads/
|   +-- branding/.gitkeep   Directory tracked; runtime logos ignored
|   +-- results/.gitkeep    Directory tracked; uploaded cards ignored
|   +-- revaluation/.gitkeep
|   +-- temp/.gitkeep
+-- docs/                   Architecture, workflows and feature references
~~~

`package-lock.json`, `node_modules`, private environment files, OCR language data
and uploaded documents can exist locally without being tracked. The lockfile is
currently ignored by repository policy. Only the four upload placeholders belong
in the current Git tree.

## Responsibility Boundaries

| Area | Important entry points |
| --- | --- |
| Extraction | `services/documentExtractor.js`, `vlmExtractor.js`, `aiProviders.js`, `pageRenderer.js` |
| Original result workflow | `controllers/resultController.js`, `routes/resultRoutes.js`, `services/resultHistoryService.js` |
| Revaluation | `revaluationController.js`, `revaluationExtractor.js`, `revaluationValidator.js`, `revaluationPersistence.js` |
| Course identity/roster | `academicCoursesController.js`, `academicCourseService.js`, `academicRepository.js` |
| Academic meaning | `academicPolicy.js`, `academicOutcomeService.js`, `progressAnalyticsService.js` |
| Students directory | `studentController.js`, `studentDirectoryService.js`, `studentDirectoryRepository.js` |
| Reports | `reportsController.js`, `reportsService.js`, `reportsRepository.js`, `revaluationOverlay.js`, `subjectOutcome.js` |
| Settings | `settingsController.js`, `settingsService.js`, `settingsRepository.js` |
| Registration/invitations | `registrationController.js`, `registrationService.js`, `invitationEmailService.js` |
| Faculty sidebar | `views/partials/sidebar.ejs`, `public/css/faculty-sidebar.css`, `public/js/sidebar.js` |
| Recovery/email verification | `authController.js`, `otpService.js`, `emailService.js` |

Names in the table are basenames within their established controller/service/
repository folders. HTTP controllers should not replace shared academic policy
with template or browser calculations.

## Shared report semantics

`repositories/revaluationOverlay.js` selects the approved active event for the
same SubjectResult and provides SQL outcome expressions. Reports, Analytics and
academic history reuse it. `services/subjectOutcome.js` projects original and
effective components, outcome and provenance for Student/Subject/Consolidated.
History-based completion stays in `academicOutcomeService.js`.

`public/js/reports/wording.js` supplies compact screen/print notes and export
explanations. `scripts/verify-report-mode-semantics.js` checks an explicitly
selected live record read-only. See [report audit](report-mode-semantics.md).

## Current account and Faculty behavior (29 October 2026)

Faculty-only registration binds an administrator-selected faculty record and
invitation email, checks its faculty code, then activates after email verification.
There are no phone inputs, account phone-update routes or SMS provider modules.
Legacy storage and migrations are retained for compatibility.

Faculty sees Dashboard, Analytics, Reports and personal Settings. Only Analytics
expands by default; Reports expands for its selected page or on manual opening.
Original submenu labels/sizing/spacing remain. The sidebar has no faculty profile
block. Admin navigation and server permissions are unchanged by presentation work.
See [Faculty access](faculty-access.md).

## Current Navigation and Removed Files

Public-page/account updates on 22 October 2026:

- `/forgot-password` contains both email entry and OTP verification states;
  `/verify-otp` redirects there. Reset Password remains a separate step.
- Removed `views/auth/verify-otp.ejs`, `public/css/landing.css`, and
  `scripts/apply-schema.js`. Database setup uses migrations, including
  `20261022120000-admin-contact-otp-schema.js`, instead of that manual script.
- The standalone `test-smtp.js` diagnostic and its npm command were removed.

- Reports has a center plus eight formal reports. Analytics has eight analysis pages.
- Semester Roster is a tab under Subjects. `/subjects/courses` is a compatibility
  entry; `/subjects/roster/edit` is the actual edit endpoint.
- Student lookup is integrated into `/students`, not a separate search page.
- Chat Assistant and a standalone department-management view are not present.
- Settings contains account/security, appearance, branding and read-only information.
- The historical standalone batch-sessions template, old student-validation report
  and retired history generator were removed. They are not runtime dependencies.
- `seed/seed_all.js`, `services/ocrProvider.js` and
  `services/tesseractProvider.js` are not current files.

See [Views](../views/README.md), [Extraction](result-extraction.md),
[Database Structure](database-structure.md), and
[Implementation Status](implementation-status.md).
