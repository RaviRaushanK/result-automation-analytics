# Academic Result Semantics

Reviewed on 23 October 2026. Source services and applied migrations remain authoritative.

## Stable Identity And Rollout

`ResultSession` examination identity is batch + academic semester + structured
start month/year + end month/year. A one-month examination stores the same start
and end; ranges may cross calendar years. `exam_session` and `exam_year` remain
as compatibility columns derived from the start period, but they are not the
authoritative identity. Period comparison, duplicate prevention, backlog history,
revaluation matching, reports and Analytics use the complete structured period.

Migration `20261023120000-structured-examination-periods` preserves every legacy
session as a one-month period. It does not infer dates from marks cards or rename
historical periods. Result-bearing sessions remain locked against ordinary period,
semester, or batch changes. If institutional evidence later proves a historical
period is wrong, use a separately reviewed correction procedure; the ordinary
session editor intentionally provides no override.

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
can be corrected before saved results depend on the semester. Once Results exist,
ordinary roster changes are blocked; configure a new cohort's syllabus in its own
batch. Historical course codes/type/credits/maxima are protected, while descriptive
name corrections remain allowed. No marks or stored GPA are rewritten.

For later retakes, create another session for the SAME academic semester/batch
and actual examination period. Add offerings with exact course codes/definitions;
they resolve to existing courses. Import only subjects actually attempted. A
configured session cannot change academic semester.

New BACKLOG subjects must have a failed, uncleared earlier course attempt in this
student's batch and semester. Approved effective revaluation overlays are used for
eligibility; an earlier effective PASS clears the course. Never-attempted, passed,
already-cleared and foreign-course subjects are rejected. Partial backlog remains
supported and its SGPA remains null. This does not change CGPA calculations.

## Administrator Integrity At Confirmation

The generic Result POST/PUT/DELETE mutations are retired with 403 responses.
Result reads and the controlled upload workflow remain available. Student USN and
batch are protected once Result history exists; name/email/category/status retain
their established edit behavior.

Original-result validation stores a configuration fingerprint and a fresh review
token. Confirmation locks the session, batch, processing state and student,
re-reads extraction/configuration/history, checks the review token, and rejects
stale state. Curriculum writers share the batch lock. Stored processing success
cannot be edited/reconfirmed into unrelated history. Marks use strict integer
validation; conflicting source rows/readings require a clear re-extraction.

Available document claims are compared with the selected examination context.
Missing claims require explicit administrator verification, not invented dates or
attempts. A mixed document still uses separate uploads with visible exclusions;
overriding a global semester/type header for that scope requires explicit review
and unambiguous configured course membership in the included/excluded semesters.

Revaluation validation and final approval check exact USN/context and existing
subject ownership. Contradictions cannot be confirmed away. The current parser's
old marks/result columns describe external components: stored old external marks
are compared when available, while an unstored external result status requires
verification and is not confused with the stored overall status. Approval uses a
versioned proposal token and authoritative target snapshot, preserves original
rows/GPA, and serializes demotion/insertion of effective events. Duplicate target
events are checked using document hashes and explicit printed event references
where available. Distinct later events and previously unprocessed subjects remain
possible. Successful source imports/documents cannot be superseded as drafts.

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

Result identity remains `(student_id, session_id, attempt_no)`. New attempt numbers
continue per student and academic semester across examination sessions: REGULAR 1,
then BACKLOG 2, 3 and onward. A new semester starts again at REGULAR 1. Legacy
session-scoped numbers remain unchanged and readable. New backlog numbering
continues beyond both the highest stored number and the number of recorded sittings.
Final import locks the student and reads current locked history before assigning
the new result, preventing competing imports from reusing a semester attempt.
REGULAR is regular participation; BACKLOG, SUPPLEMENTARY,
and REPEAT are retakes. Existing labels are never rewritten. New uploads/imports
accept only REGULAR and BACKLOG; SUPPLEMENTARY and REPEAT remain supported for
historical reads, course outcomes, and analytics. The database enum is retained.
New-entry and filter dropdowns offer only Regular and Backlog. Read APIs retain
exact legacy filters for historical analysis; unfiltered results include all types.
Exam Type is required on upload. Old extraction drafts with no attempt metadata
retain the existing REGULAR/1 fallback; drafts explicitly containing legacy types
cannot be imported and must be uploaded again as REGULAR or BACKLOG.

A new BACKLOG cannot reuse any examination month/year already recorded for that
student's academic semester, even with a different session ID. Comparison accepts
the canonical month abbreviation or full month name, ignoring case/outer spaces.
Existing next-attempt and chronology checks still apply. Validation, preview and
confirmation all enforce this rule. A new semester's REGULAR attempt remains 1.

Session Management blocks changes to semester, examination month or year once
any Result exists; batch changes remain disallowed. Session edits and final
imports lock the session row so concurrent edits cannot change imported context.
Create another session for the actual later examination period instead.

Mixed-semester cards still require separate uploads. Each extraction maps only
configured subjects from its selected session; excluded extracted codes are kept
in the draft and displayed on Review and Preview. Review states that only listed
subjects with entered marks will be imported. No automatic splitting or document
examination-period inference is implemented. Old drafts without excluded-subject
metadata show the general import-scope notice without fabricating excluded codes.

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
- `controllers/sessionController.js`, `public/js/sessions.js`: full structured-period uniqueness; stable academic semester.
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
