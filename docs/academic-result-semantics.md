# Academic Result Semantics

Reviewed on 17 October 2026. Source services and applied migrations remain authoritative.

## Stable Identity And Rollout

`AcademicCourse` identity is batch + numeric academic semester + trimmed uppercase
exact subject code. `Subject` remains a session offering. Different codes, batches,
or semesters never imply equivalence. Credits, name, type, and maxima must match.

The additive `20261003090000-stable-academic-courses` migration maps matching
offerings only. Conflicting definitions remain unmapped. Different regular
subject rosters leave the semester unverified. Historical academic values and
events are preserved. Historical grading provenance remains unknown. MySQL DDL
implicitly commits; mapping writes are transactional. Re-running is guarded;
rollback intentionally refuses to drop academic history.

Administrators review required courses in `/subjects?tab=roster`.
The old `/subjects/courses` GET redirects there; `/subjects/roster/edit` opens editing.
Confirmation records reviewer and timestamp. Select the actual full-semester
roster, not a retake subset. Unmapped offerings must be reconciled first. Do not
confirm ambiguity without institutional evidence. Distinct code families in a
legacy semester do not automatically replace or clear one another. Verified
rosters are read-only until explicit Edit Required Courses; accidental selections
can be corrected without replacing stable course identities.

For later retakes, create another session for the SAME academic semester/batch
and actual examination period. Add offerings with exact course codes/definitions;
they resolve to existing courses. Import only subjects actually attempted. A
configured session cannot change academic semester.

## Registration and Previous Cards

Original-result imports require an existing non-deleted Student in the selected
batch. Validate compares both USN and registered name; name comparison normalizes
Unicode, case and whitespace, not partial/fuzzy text. The admin corrects the
extracted name or USN, rather than OCR renaming the Student record.

Registration/name and exact-attempt duplicate alerts appear after Validate.
Preview and final import repeat the relevant checks. Result upload does not
create missing students or silently restore deleted identities.

For a first regular Semester N result, saved original REGULAR cards with subject
rows are required for every semester from 1 through N-1. Retakes and later
attempts also need a prior original in the same academic semester. A failed
original counts as uploaded history; an empty header or extraction draft does not.
Examination dates and same-session attempt ordering constrain eligible history.

These guards apply to every configured later semester, not only Semester 2.
They ensure history exists, not that every old course/grade snapshot is verified.
Cumulative GPA may still be unavailable when roster, credits or grading evidence
is incomplete. No fabricated marks/GPA are inserted to bridge that gap.

Revaluation operates on a selected saved Result and retains its own server-side
identity-confirmation and duplicate-approval workflow. It does not provision a
new original result or backfill missing previous cards. See
[Extraction and Uploads](result-extraction.md).

## Participation And Clearance

Result identity remains `(student_id, session_id, attempt_no)`. Attempt numbers
are session-scoped. REGULAR is regular participation; BACKLOG, SUPPLEMENTARY,
and REPEAT are retakes. Existing labels are never rewritten.

History uses exam year/month, then session attempt and result identity.
Unrecognized dates, indistinguishable participation, unverified rosters, missing
required outcomes, or unknown status produce unknown rather than inferred passes.
Earlier retakes prevent certifying a later regular sitting as the first sitting.

Any authoritative course PASS clears that course. The first chronological PASS
is the accepted attempt; without a pass, use the latest known failure. Never
select highest marks. Semester clearance requires every required course passed,
possibly across sittings. First attempt additionally requires a unique first
REGULAR sitting with the entire roster. No recorded retake means supplementary
clearance is unavailable, not an invented failure. Supplementary P requires first
F, all courses cleared, and a failed course passed in a later retake.

Original uses persisted SubjectResult values. Effective uses the highest-numbered
approved effective revaluation per SubjectResult, falling back to originals.
Pending/rejected events never count. Original rows remain unchanged. Progress
marks remain first verified regular totals, not highest marks across attempts.
Original IA/EX are never inferred from revised totals.

## GPA

Production grading is `PG_2022_2024_V1`: O=10, A+=9, A=8, B+=7, B=6, C=5,
F=0, using existing percentage bands. New subject results snapshot grade points,
credits, course identity, and scheme. Legacy seed S/A/B/C/D/E grading is separately
named, never translated into production grades.

Full verified REGULAR imports store SGPA = sum(point * credits) / sum(credits),
including failures. All retake SGPA is NULL until an approved semester-GPA rule
exists, even for a full retake roster.

Cumulative GPA counts required courses once through the selected semester, using
accepted original attempts, known matching scheme/points/credits snapshots,
complete first-sitting evidence and verified rosters from Semester 1 onward.
Failed-course credits remain in the denominator. Never average SGPAs or use
passed-only attempt GPA. Missing/legacy/incompatible inputs produce NULL. Only
the new imported header receives the calculated cumulative snapshot; subsequent
retakes never update old headers. Progress checks calculated snapshots against
original evidence at the recorded exam cutoff. The trailing Progress cumulative
value is derived from the entire verified original course history through the
highest observed academic semester, not the newest header of a partial retake.

`sgpa_source`, `cgpa_source`, and `cgpa_is_cumulative` distinguish calculated,
legacy, unknown, and future document provenance. Official source GPA extraction
is NOT implemented. Revaluation never changes stored GPA and does not introduce
effective cumulative GPA. Its existing derived attempt GPA is labelled explicitly.

Existing reports/rankings retain legacy stored GPA with a basis note; Progress
hides uncertified CGPA. The old backfill script is read-only. Programme-final GPA
is not asserted: programme duration is not configured. Progress year completion
groups consecutive semester pairs (1-2 First Year, 3-4 Second Year, etc.). Year
columns cover configured active course rosters and recorded report semesters,
not batch calendar years. Both required semesters must have verified first-sitting
and course-clearance evidence. Entirely first-attempt passes give N/Y; completion
after verified retake clearance gives Y/N; known uncleared years give N/N.
Missing/future/unverified semester evidence gives -/-. A later REGULAR pass alone
does not prove backlog completion. No stored academic values are changed.

## File Manifest

Historical implementation manifest below; see [Project Structure](project-structure.md)
for the current inventory and [Implementation Status](implementation-status.md)
for current verification and remaining gaps.

Created:

- `database/models/AcademicCourse.js`
- `migrations/20261003090000-stable-academic-courses.js`
- `repositories/academicRepository.js`
- `services/academicPolicy.js`
- `services/academicCourseService.js`
- `services/academicOutcomeService.js`
- `controllers/academicCoursesController.js`
- `views/subjects/courses.ejs`
- `tests/academic-outcomes.test.js`
- `docs/academic-result-semantics.md`

Modified:

- `database/models/index.js`, `database/models/Subject.js`, `database/models/Result.js`, `database/models/SubjectResult.js`, `database/schema.sql`: additive identity/provenance.
- `controllers/resultController.js`: partial retakes, full regular validation, new GPA persistence and history review.
- `controllers/sessionController.js`, `public/js/sessions.js`: full four-field session uniqueness; stable academic semester.
- `controllers/subjectController.js`, `routes/subjectRoutes.js`, `public/js/subjects.js`, `views/subjects/index.ejs`: course-linked offerings and admin roster review.
- `repositories/reportsRepository.js`, `repositories/analyticsRepository.js`: shared effective overlay and exam-type constants, unchanged ranking rules.
- `services/reportsService.js`, `controllers/reportsController.js`, `public/js/reports/common.js`, `public/css/reports.css`: course-level progression, safe GPA, supplementary labels, semester completion flags and export structure.
- `views/results/upload.ejs`, `views/results/review.ejs`, `views/results/preview.ejs`, `views/results/success.ejs`: participation notes, partial-retake inputs, missing-history review and GPA labels.
- `views/dashboard/index.ejs`, `views/analytics/toppers.ejs`, `views/revaluation/outcome.ejs`: explicit stored/attempt GPA labels only.
- `seed/seed_data.js`, `seed/backfill_cgpa.js`: centralized legacy scale, no new legacy cumulative GPA or historical backfill writes. Seeds were NOT executed.
- `tests/reports.test.js`, `tests/result-persistence.test.js`, `tests/reports-browser.js`, `test/analytics-toppers.test.js`, `test/analytics-revaluation.test.js`: fixture/provenance coverage and browser checks.

This manifest records the original academic-semantics implementation, not a
claim that extraction, navigation or approval code has remained unchanged since.
Later workflow changes are documented in [Extraction](result-extraction.md).

## Verification Commands

For deployment, back up the database and apply pending migrations separately.
Default focused checks run without enabling database integration:

```powershell
node --test tests/academic-outcomes.test.js tests/result-history.test.js tests/result-student-registration.test.js tests/result-persistence.test.js tests/reports.test.js
```

Enable `REPORTS_DB_TEST=1` only for the optional MySQL fixtures, which use read-only
academic CTEs rather than seed/production writes. `tests/reports-browser.js` uses a
loopback test-session harness without academic writes. Back up the database before
production deployment; never use legacy seeds to repair historical evidence.
