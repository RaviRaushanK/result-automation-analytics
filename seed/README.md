# Academic Demo Dataset

This explicitly invoked DEVELOPMENT/TEST reset builds 36 students, verified
course history, partial retakes and canonical revaluation events. It does not
change schemas, grading, imports, Reports or authentication behavior.

## Commands and Safety

From the repository root in PowerShell:

```powershell
$env:NODE_ENV = 'development'
npm.cmd run seed:demo -- --reset --confirm-db academic_result_analytics_db
npm.cmd run seed:demo:verify -- --confirm-db academic_result_analytics_db
```

Use your actual `DB_NAME` if different. Configuration comes from `config/.env`.
The database name must match exactly; an explicit reset/verify operation is
required. Unset NODE_ENV, production, production-like database names and remote
DB_HOST values are refused before database connection. Never use this on real
academic data or while imports/revaluation reviews are running.

**Reset replaces ALL academic data in the selected local database**, not just
rows belonging to this fixture. This includes original results, revaluation
events, import/OCR staging, offerings, course rosters and other student identities.
Existing accounts, faculty, departments, batches and institution configuration
are retained. The three required student rows are retained with their original
IDs/UUIDs, names, USNs and emails; their academic history/category is demo data.
Identity mismatches cause a rollback instead of renaming the students.

Before deletion, a JSON backup of affected academic tables is written to the OS
temporary directory; its exact path is printed. This backup contains student PII:
protect it appropriately. It is a recovery snapshot, not an automatic restore tool.
Reset, inserts and academic verification run in one transaction with foreign keys
enabled. An assertion failure rolls back. Report/Analytics smoke checks run after
commit and fail loudly if unsuccessful. Do not run concurrently with the app's
write workflows. No DROP DATABASE, TRUNCATE or foreign-key disabling is used.

`node seed/seed_all.js` and `npm.cmd --prefix seed run all` are guarded aliases
and require the same arguments. Legacy standalone cleanup and history generation
are retired; they fail without writes. `seed_summary.js` remains read-only.
`npm start`, migrations and the existing Sequelize `seed` command are unchanged.

## Dataset

| Batch | Students | Academic semesters | History |
| --- | ---: | --- | --- |
| MCA 2025 | 30 | 1, 2, 3 resulted; 4 upcoming | Verified required rosters |
| MCA 2026 | 4 | 1 and 2 resulted; 3 upcoming | In-progress verified rosters |
| TEST UNVERIFIED MCA | 2 | 1 | Isolated unknown-history fixtures |

Existing empty batches are retained. The application has no fixed programme
duration setting: these are illustrative demo semesters, not an official MCA
curriculum. Future examination sittings intentionally simulate completed history.
The main sequence is Sem 1 Dec 2025, Sem 2 Jun 2026, Sem 3 Dec 2026; Sem 1
retakes use Jun/Aug 2026 and Sem 2 retakes use Dec 2026. Months do not determine
academic semester. Every retake offering uses the same stable course as its
original offering, even though subject IDs differ.

There are 48 academic courses, 12 sessions, 72 offerings, 102 results and 563
subject results: 92 REGULAR, 6 BACKLOG, 2 SUPPLEMENTARY and 2 REPEAT attempts.
REGULAR results contain all six semester courses; retakes contain only the one
or two attempted courses. Session-scoped attempt numbers start at 1, with one
explicit same-session attempt 2. No placeholder zero subject results are inserted.

Theory courses normally have 4 credits and labs 2. The Sem 3 MMC305 fixture has
5 credits and a 150 maximum (50 IA / 100 EX), exercising actual maximum/credit
weighting rather than six-times-100 assumptions. Other courses have 100 maximum
(50 IA / 50 EX). Course definitions reuse existing seed names/codes but correct
their former semester placement: MMC101-series Sem 1, MMC201-series Sem 2,
MMC301-series Sem 3, MMC401-series Sem 4.

## Scenario Manifest / Manual Testing Cheat Sheet

P/F refer to Progress First Attempt; the second symbol is Pass in Supplementary.
The latter follows the existing service and includes non-REGULAR retakes.

| USN | Name | Scenario / Expected Outcome |
| --- | --- | --- |
| 1MV25MC061 | RAVI RAUSHAN KUMAR | Sem 1/2/3 P/-; strong topper; stored/verified cumulative CGPA 10.00 |
| 1MV25MC052 | PRAFUL KRISHNAPPA VAJJARAMATTI | Sem 1 F/P; MMC103 cleared in Jun BACKLOG; later semesters P/- |
| 1MV25MC074 | SINDHUKUMAR S | Sem 1 Original F/-; Effective P/- through approved effective revaluation |
| 1MV25MC002 | DEMO STUDENT 002 | Two failed courses cleared in SUPPLEMENTARY; F/P |
| 1MV25MC003 | DEMO STUDENT 003 | MMC103 remains failed after BACKLOG; F/F |
| 1MV25MC004 | DEMO STUDENT 004 | MMC103 original fail, Jun fail, Aug supplementary pass; F/P; three course events |
| 1MV25MC005 | DEMO STUDENT 005 | REPEAT clears MMC105; F/P |
| 1MV25MC006 | DEMO STUDENT 006 | Pending proposed pass ignored; both views F/- |
| 1MV25MC007 | DEMO STUDENT 007 | Rejected proposed pass ignored; both views F/- |
| 1MV25MC008 | DEMO STUDENT 008 | Three ledger events; only approved effective event applies; Original F/-, Effective P/- |
| 1MV25MC009 | DEMO STUDENT 009 | Sem 1 P/-, Sem 2 F/P via BACKLOG, Sem 3 P/- |
| 1MV25MC010 | DEMO STUDENT 010 | Grade boundaries 49/50/54/55/59/60; 64/65/69/70/79/80; 84/85/89/90/99/100 |
| 1MV25MC011 | DEMO STUDENT 011 | Deliberate 10.00 GPA topper tie with Ravi; identical marks |
| 1MV25MC012 | DEMO STUDENT 012 | Sem 1 MMC101 historical NULL IA/EX; canonical total remains populated |
| 1MV25MC014 | DEMO STUDENT 014 | Approved marks-only change 65 to 75; status stays PASS |
| 1MV25MC015 | DEMO STUDENT 015 | Approved PASS to FAIL (55 to 49); Effective F/-; original P/- |
| 1MV25MC016 | DEMO STUDENT 016 | Backlog FAIL to PASS by RV; Original F/F, Effective F/P |
| 1MV25MC017 | DEMO STUDENT 017 | Explicit same-session BACKLOG attempt 2; regular unchanged; F/P |
| 1MV25MC025 | DEMO STUDENT 025 | No results; report cells unavailable, never zero/failure |
| 1MV25MC026 | DEMO STUDENT 026 | Only Sem 1/2; missing Sem 3 is unavailable |
| 1MV25MC027 | DEMO STUDENT 027 | Only Sem 1/2; reserved for manually testing a Sem 3 original upload |
| 1MV26MC001-004 | DEMO CURRENT 1-4 | Current batch; first two only Sem 1, other two Sem 1/2 |
| 1MV24MC901 | DEMO UNVERIFIED 1 | Full result but unverified roster/legacy provenance; history and CGPA unavailable |
| 1MV24MC902 | DEMO UNVERIFIED 2 | Retake only; no first REGULAR history; CGPA unavailable |

The three required emails remain exactly `raviraushan253@gmail.com`,
`example1@gmail.com`, `example2@gmail.com`. Every other student is labelled DEMO
and uses the reserved `example.com` domain.

## GPA and Revaluation

Grades and grade points come from `services/academicPolicy.js`; SGPA is the
production credit-weighted grade-point calculation for verified full REGULAR
attempts. Partial retake SGPA is NULL. Cumulative CGPA is calculated through
`academicOutcomeService.calculateCumulative` when each new header is published;
retakes never overwrite old headers. Course/credit/grade-point/scheme snapshots
and CALCULATED provenance accompany verified GPA. The isolated legacy batch has
NULL snapshots/SGPA/CGPA and LEGACY provenance. Current and missing future results
remain unavailable rather than FAIL. First-pass credit selection and failed-credit
inclusion follow the existing academic outcome service, not a seed-specific rule.

For a non-topper GPA example, DEMO STUDENT 001 has Sem 1/2/3 SGPA 8.09/8.18/8.22
and true cumulative CGPA 8.16. Student 017's same-period retake illustrates the
existing conservative report policy: the original header CGPA may display `-`
when it no longer matches validated history for that cutoff; trailing cumulative
CGPA remains derived from verified original course history.

There are nine RV events: six approved, two pending, one rejected. Five approved
events are effective; the older approved event for 008 is historical, and its
pending event is ignored. Original SubjectResult/header data is unchanged.
Effective IA/EX remain original stored components; revised marks are complete
canonical totals, not additional external marks. No post-RV GPA is fabricated.
These are canonical synthetic ledger rows, labelled DEMO_SEED_V1 in remarks.
No fake OCR candidates, imports, PDFs or document provenance are claimed.

Three demo faculty use real SubjectFaculty assignments: first theory course has
two staff, other theory courses one, labs none (report displays `-`). Accounts:
`demo_admin / DemoAdmin2026!`. The current database has an admin-only login-role
enum, so no faculty login is fabricated. If an existing installation already
supports faculty logins, `demo_faculty / DemoFaculty2026!` is also created.
These are development-only credentials. Existing account passwords are untouched.
If a demo username exists with different credentials/identity, reset is refused.

## Verification

The seed prints actual counts, backup path and a SHA-256 logical-dataset digest.
IDs, timestamps and bcrypt salts are excluded so reruns compare semantic content.
Automatic checks cover identities, mappings, full/partial rosters, original marks,
maxima, headers, GPA snapshots, course clearance, RV selection, unknown/future
history, all eight Reports and Analytics overview.

```powershell
node --test tests/demo-seed.test.js
$env:REPORTS_DB_TEST = '1'
$env:DEMO_SEED_DB_TEST = '1'
node --test tests/*.test.js test/*.test.js
node tests/reports-browser.js
```

The demo DB tests verify existing rows read-only; they do not reset automatically.
The browser harness checks Reports, CSV, print, themes and responsive layouts with
installed Edge. Seed verification does not claim an OCR extraction or live import
was executed: manual uploads still require genuine readable source PDFs. Use the
reserved student 027 for Sem 3 upload, or 003 for a new MMC103 revaluation, then
reset to return to the documented dataset.
