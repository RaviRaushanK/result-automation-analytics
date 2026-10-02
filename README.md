# Student Result Automation and Analytics System (SRAAS)

A Node.js, Express, Sequelize, MySQL and EJS application for processing VTU MCA
results, reviewing revaluation documents, exploring analytics and generating
formal academic reports.

The current application is **MCA-only and batch-based**. Reports use Batch,
academic Semester and Result Session rather than department-wise or academic-year
grouping. Examination year identifies a sitting; it does not define a student's
academic semester or year of study.

## Features

- Dashboard and interactive Analytics: overview, toppers, failed results, subject
  performance, semesters, student exploration, grade distribution and revaluation.
- Batch, result-session, subject and faculty management.
- Stable AcademicCourse identities, session-specific subject offerings and explicit
  administrator review of required semester rosters.
- Original PDF result upload, extraction, editable review, validation, preview and
  transactional import.
- Separate revaluation selection/upload/review/approval workflow with an event
  ledger and approved-effective result overlays.
- Eight read-only Reports with browser previews, CSV exports and dedicated
  Print / Save as PDF views.
- Light/dark themes and horizontally scrollable wide academic tables.
- Guarded deterministic demo data with automatic academic integrity checks.

## Requirements

- **Node.js 24**, the runtime used for repository verification. The installed
  `pdfjs-dist` package declares `>=22.13.0 || >=24`; the old Node 18 prerequisite
  does not cover the current dependency set.
- npm and **MySQL 8.0+**, running before database setup. Queries use MySQL 8 features
  including common table expressions and window functions.
- A modern browser. Optional automated browser verification uses installed
  Microsoft Edge and Node's native WebSocket implementation.

Extraction uses the npm packages `pdfjs-dist`, `tesseract.js` and `sharp`; the
current code does not invoke a separately installed Tesseract command-line binary.
OCR resources and externally hosted frontend assets can require network access.
Use readable PDF result documents and review extracted values before persisting.

## Setup

Run commands from the repository root. On Windows PowerShell:

```powershell
npm.cmd install
Copy-Item config/.env.example config/.env
# Edit config/.env with your local database credentials and session secret.
npm.cmd run setup
npm.cmd start
```

**Quick Start**
```powershell

  npm install
  npm run setup
  npm start
```

**npm run demo** <- Run this for demo data

Do not overwrite an existing `config/.env`. On macOS/Linux, use `npm` instead of
`npm.cmd` and `cp config/.env.example config/.env` for a new configuration file.

`setup` creates the database if missing, applies Sequelize migrations, then runs
the initialization scripts, including the default **Master of Computer Applications** department (MCA).
Its database user needs the corresponding creation, DDL and initialization permissions. For an already initialized installation, use
`npm.cmd run migrate` to apply pending migrations; do not reset its academic data.

The default URL is **http://localhost:3000**. The application reads **APP_PORT**,
not PORT. To start a development instance on another free port:

```powershell
$env:APP_PORT = '3005'
npm.cmd start
```

### Configuration

Database and session configuration load `config/.env`. `app.js` also loads a root
`.env` if present; pre-existing process environment values take precedence under
the current dotenv calls. Avoid conflicting configuration in both files.

| Variable | Purpose |
| --- | --- |
| `DB_HOST` | MySQL host; normally `localhost` for development |
| `DB_PORT` | MySQL port; normally `3306` |
| `DB_USER` | MySQL account |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name; example uses `academic_result_analytics_db` |
| `SESSION_SECRET` | Set a strong, private random value; never rely on the fallback |
| `APP_PORT` | HTTP listen port; defaults to `3000` |
| `NODE_ENV` | Demo commands require explicit `development` or `test`; production enables secure session cookies |
| `DEBUG_MODE` | Enables debug output in the OCR provider when set to `true` |

`UPLOAD_PATH`, `MAX_UPLOAD_SIZE` and `OCR_PROVIDER` appear in the example file,
but are not wired as configurable upload limits/paths/provider selection in the
current flows. Both original and revaluation upload routes accept **PDF only,
up to 15 MB**. Files are staged in `uploads/temp`, then handled under the relevant
result/revaluation directories. Do not assume `MAX_UPLOAD_SIZE=20MB` changes this.

### Authentication and Access

Fresh initialization creates a development administrator:

| Username | Email | Initial Password |
| --- | --- | --- |
| `admin` | `admin@example.com` | `admin123` |

Change this password through `/account-security` before using real data. Existing
initialized accounts are not reset by the initialization script.

Reports, their APIs, CSV and print endpoints require authentication and an
`admin` or `faculty` role. Analytics and Students also enforce admin/faculty
authorization. Faculty management and required-course roster confirmation are
administrator-only; entity routes have their own write restrictions.

**Current schema limitation:** the initial migration defines
`admin_users.role` as `ENUM('admin')`. Although parts of the application authorize
faculty sessions, that schema cannot store a faculty login without a separately
approved schema change. Teaching Faculty records and SubjectFaculty assignments
are separate from login accounts. There is **no implemented student login portal**.
Sidebar visibility is not a substitute for server-side authorization.

## Reports

| Report | Page | Scope / Output |
| --- | --- | --- |
| Student Result | `/reports/student` | One student; supports completed semesters/sessions and explicit attempts |
| Class Result | `/reports/class` | Student/result attempts for a selected semester sitting |
| Subject Result | `/reports/subject` | Student subject outcomes for the selected subject and sitting |
| Consolidated Result | `/reports/consolidated` | One row per exact result attempt; dynamic subject EX / IA / T groups, TOTAL, %, stored SGPA |
| Toppers | `/reports/toppers` | Ranked qualifying results with stored GPA, marks total and marks-based percentage |
| All Students Progress | `/reports/student-progress` | One row per batch student; dynamic semester history, cumulative CGPA and grouped year completion |
| Result Analysis | `/reports/result-analysis` | Subject Regular/Repeaters/Total APP, PASS and pass %, assigned staff, chart and result-level summary |
| Revaluation | `/reports/revaluation` | Canonical before/after values and revaluation ledger events |

For each report type `<type>`, the protected endpoints are:

```text
GET /reports/<type>
GET /reports/api/<type>
GET /reports/<type>/export.csv
GET /reports/<type>/print
```

Dependent dropdown APIs validate batch, semester, session and subject ownership.
Student-level previews use server-side pagination; CSV and print use the full
filtered result set. The subject-level Result Analysis table is not paginated.
PDF output uses the browser's Save as PDF action, not a server PDF generator.
Wide reports use landscape print layouts; Progress has a named A3 landscape
layout. The current Reports implementation exports CSV, not native XLSX.

### Original and Effective Results

- **Original** uses canonical persisted SubjectResult totals, grades and status.
- **Effective** applies only approved events marked effective, using the
  deduplicated highest-numbered qualifying event for each SubjectResult.
- Pending/rejected events never change effective academic outcomes. OCR/import
  candidates are staging data, not authoritative report data.
- `IA = internal_marks`, `EX = external_marks`, `T = marks` in Original mode.
  Effective T may use revised marks; IA/EX remain stored original components.
  Missing historical components display `-`; effective EX is never inferred.
- Totals sum canonical displayed subject totals. Percentage uses their actual
  applicable subject maximums, never SGPA or CGPA multiplied by ten.
- Revaluation does not overwrite original SubjectResults or recalculate stored
  Result SGPA, CGPA, overall status or failed-subject count. Reports derive safe
  effective statuses where needed and identify stored GPA as original-basis data.

## Academic History and Progress

AcademicCourse identity is **Batch + academic Semester + normalized exact subject
code**. Subjects are session offerings of those courses. Cross-session clearance
requires this stable mapping, not matching marks, approximate names or an assumed
equivalence between unrelated codes.

`attempt_no` is scoped to `(student_id, session_id)`, not the student's lifetime
semester history. BACKLOG, SUPPLEMENTARY and REPEAT are retakes. A Semester 1
retake remains in a Semester 1 session even when written during a later month.
Full REGULAR imports require the verified required roster; partial retakes contain
only the subjects actually attempted.

For verified full REGULAR results, SGPA is credit-weighted grade points divided by
credits, including failed credits. Retake SGPA is NULL. Cumulative CGPA uses the
existing verified course-history service, snapshots and grading provenance; it is
not an average of SGPAs. Missing/unverified/legacy evidence remains unavailable.
Only a newly imported header receives its cumulative snapshot; later retakes do
not rewrite older GPA headers. Official source-document GPA extraction is not
implemented, and programme-final GPA is not asserted.

### Grouped Academic-Year Completion

Progress retains semester Marks Obt., SGPA, CGPA, First Attempt and Pass in
Supplementary. Its completion columns are now grouped under **Successfully
Completed With Back Log** and **Successfully Completed Without Back Log**.

Years use consecutive semester pairs: **1-2 First Year**, **3-4 Second Year**, and
subsequent pairs only where the batch's configured/recorded structure warrants
them. There is no fixed programme-duration setting; no final-year label is guessed.
Both required semesters must have sufficient verified academic evidence.

| Year-Level Evidence | With Back Log | Without Back Log |
| --- | --- | --- |
| Both semesters passed their verified first regular sittings | N | Y |
| Both cleared with required, verified later retake clearance | Y | N |
| Known year remains uncleared | N | N |
| Future, missing, ambiguous or unverified evidence | - | - |

The academic outcome service performs these calculations, not the template.
Original/Effective selection also applies to completion. GPA remains on its
original academic basis. CSV uses explicit year-level completion headings, and
print/PDF preserves the two-row grouped header.

See [Academic Result Semantics](docs/academic-result-semantics.md) for detailed
clearance, accepted-attempt, roster-review and GPA rules.

## Demo Dataset

**Use only a disposable local development/test database.** The reset replaces ALL
academic results, revaluation events, staging, offerings, rosters and other student
identities in the selected database, not just previously seeded rows.

### Insert Demo Data into MySQL

Run these steps from the repository root. MySQL must be running. The seed inserts
actual database rows; it is not a browser-only preview or an SQL file generator.

1. Install dependencies and configure `config/.env` using the Setup section above.
   Set `DB_NAME` to your local demo database and enter its connection credentials.
2. For a new database, run `npm.cmd run setup` once to create it, apply migrations
   and initialize it. For an existing initialized database, run
   `npm.cmd run migrate` to apply pending migrations instead.
3. Stop imports/revaluation reviews and any other application writes. Insert the
   complete dataset with this single command:

   ```powershell
   npm run demo
   ```

   In Windows PowerShell, use `npm.cmd run demo` if execution policy blocks `npm`.
   This shortcut requires `DB_NAME=academic_result_analytics_db` and a local MySQL
   host in `config/.env`. It defaults NODE_ENV to development only when absent;
   an explicit production, blank or unsupported environment is still refused.
   **This command backs up and replaces existing academic data before inserting
   the complete demo dataset. It is not an append-only operation.** Existing
   required student identities, accounts and configuration are retained according
   to the safeguards below. Do not run it against real academic data.
4. Wait for successful completion and `DEMO ACADEMIC DATA READY`. The command prints
   the inserted counts, backup path and logical dataset digest. A failed command
   must be investigated; do not treat populated pages alone as proof of success.
5. Optionally verify the inserted data without changing database records:

   ```powershell
   npm run demo:verify
   ```

6. Start the application with `npm.cmd start`, open `http://localhost:3000`
   (or your configured `APP_PORT`), and sign in with
   `demo_admin / DemoAdmin2026!`. Select **MCA 2025** in Reports for the main scenarios.

To return to the initial demo scenarios after manual changes, repeat step 3. It
resets/recreates the same logical dataset without accumulating duplicate rows.
`npm start`, `npm run setup` and `npm run demo:verify` do **not** insert this
demo dataset; `npm run demo` explicitly resets and inserts it.

The same `npm run demo` command works on macOS/Linux. For a differently named
local development database, retain the advanced, explicitly confirmed workflow:

```bash
NODE_ENV=development npm run seed:demo -- --reset --confirm-db academic_result_analytics_db
NODE_ENV=development npm run seed:demo:verify -- --confirm-db academic_result_analytics_db
```

### Reset Safety and Dataset Contents

The confirmed database name must match `DB_NAME` exactly. The advanced seed CLI
refuses unset environments; only the named local demo shortcuts provide a
development default when NODE_ENV is absent. Production environments,
production-like names and remote hosts are refused. A JSON academic-table backup
is written to the OS temporary directory before deletion; its path is printed.
It contains student PII and must be protected. Reset/inserts/integrity assertions
are transactional; report smoke checks run after commit. Do not run alongside
imports or review writes. There is no automatic backup-restore command.

The dataset contains **36 students**, **48 courses**, **12 sessions**, **72 subject
offerings**, **563 SubjectResults**, and **102 Results** (92 REGULAR, 6 BACKLOG,
2 SUPPLEMENTARY, 2 REPEAT). Nine RV events cover approved, pending, rejected and
historical/effective selection. Batches are MCA 2025, MCA 2026 and isolated
TEST UNVERIFIED MCA; existing empty batches are retained.

The three intentional identities retain their exact names, USNs and emails:
Ravi (`1MV25MC061`), Praful (`1MV25MC052`) and Sindhu (`1MV25MC074`). Existing
identity IDs/UUIDs are preserved. Their generated academic history is demo data;
other students are explicitly fictional. Scenarios cover first passes, cross-session
clearance, unresolved/multiple retakes, cumulative GPA, unknown history, historical
NULL components, topper ties and unavailable future semesters.

Development demo login: `demo_admin / DemoAdmin2026!`. A faculty login is seeded
only where the existing role column supports it; the current admin-only schema
does not. Existing passwords are not overwritten.

`seed_all.js` is a guarded alias requiring the same explicit arguments. Legacy
standalone `seed_clean.js` and `seed_history.js` are retired and refuse writes.
`npm run seed` invokes Sequelize's `seeders/` workflow, not this demo dataset.
Nothing seeds automatically on `npm start`.

See [Demo Commands and Scenario Manifest](seed/README.md) for exact identities,
manual-test cases, expected outcomes, safeguards and limitations. Demo verification
does not claim that live OCR uploads were performed.

## Tests

Run the existing unit/service tests without enabling live database checks:

```powershell
node --test tests/*.test.js test/*.test.js
```

Some modules initialize database configuration even when DB-specific tests are
skipped; keep a valid local `config/.env`. To include read-only MySQL fixtures and
persisted-demo scenario checks after seeding:

```powershell
$env:REPORTS_DB_TEST = '1'
$env:DEMO_SEED_DB_TEST = '1'
node --test tests/*.test.js test/*.test.js
node tests/reports-browser.js
```

Demo checks expect the documented seed to remain unchanged; they do not reset it.
The browser harness uses a loopback test app and installed Edge, exercises all
eight Reports, CSV, print/PDF, grouped headers, themes and responsive layouts,
and writes screenshots/PDFs to a printed temporary-directory path. It does not
perform live import/approval writes. `REPORTS_BROWSER` can specify another Edge
executable path. Latest verification of the grouped-year change: **80 tests
passed**, with database checks enabled and no skipped tests, plus browser checks.

## Project Layout

```text
app.js                 Express entry point
config/                Environment, database, sessions and sidebar
controllers/           HTTP handlers
database/models/       Sequelize models
database/schema.sql    Schema reference; migrations manage installed databases
migrations/            Sequelize migration history
init/                  Initial settings and development administrator
repositories/          Parameterized SQL and database query layers
services/              Extraction, academic policy/outcomes, Analytics and Reports
routes/                Page, API and workflow routes
middlewares/           Authentication, authorization, uploads and UI context
views/                 EJS layouts, pages, report/print partials
public/                CSS, browser JavaScript and assets
seed/                  Guarded demo CLI, scenarios and integrity verification
scripts/               Database bootstrap and initialization runner
tests/ and test/       Automated tests and optional browser harness
uploads/               Original/revaluation uploads and temporary staging
docs/                  Architecture, database and academic semantics references
```

## Useful Entry Points

| Path | Purpose |
| --- | --- |
| `/login` | Administrator authentication |
| `/dashboard` | Dashboard |
| `/batches`, `/sessions`, `/subjects`, `/faculty` | Academic configuration |
| `/subjects/courses` | Administrator required-course roster review |
| `/results/upload` | Original-result upload workflow |
| `/revaluation/start` | Session/student/attempt selection for revaluation |
| `/analytics/overview` | Interactive Analytics entry point |
| `/reports` | Redirects to Student Result Report |
| `/account-security` | Change the signed-in account password |
| `/api/health` | Public HTTP health response; not a database-readiness check |

## Troubleshooting and Deployment Cautions

- **Database connection/setup fails:** check MySQL availability, configuration,
  database permissions and pending migrations. Back up existing data before DDL.
- **Port occupied:** change `APP_PORT`, not PORT. Existing Node processes do not
  reload edited services automatically; restart your development instance.
- **Unknown Progress/GPA values:** inspect roster verification, course mappings,
  missing required subject outcomes, examination chronology and GPA snapshots.
  Do not replace dashes with zero or certify unclear history merely to fill cells.
- **Seed refused:** use an explicit development/test environment, a local database
  and exact confirmation. Do not bypass safeguards for real academic data.
- **Duplicate subject-code errors:** inspect installed constraints and migration
  status. Offering uniqueness is session-scoped; do not blindly drop indexes.
- **Extraction problems:** confirm PDF type/size/readability and review extracted
  values. Scanned-document fallback is not a guarantee of accurate OCR.
- **Production use:** replace default credentials, configure a strong secret and
  HTTPS, review secure-cookie/proxy deployment behavior, restrict DB privileges,
  and establish backups. Uploads are currently mounted under `/uploads` as static
  files; review document access controls before storing sensitive real records.

## Further Documentation

- [Academic Result Semantics](docs/academic-result-semantics.md)
- [Demo Seed and Scenario Manifest](seed/README.md)
- [Database Structure](docs/database-structure.md)
- [Entity Relationship Diagram](docs/er-diagram.md)
- [Project Structure](docs/project-structure.md)

Source models, migrations and route/service implementations are authoritative if
older supporting documentation differs. `package.json` declares the ISC license;
there is currently no standalone license file in the repository.
