# Database Structure

Reviewed on 17 October 2026 against Sequelize models and migration sources.
This reference does not assert that a particular deployed database has applied
every migration. Run migration status checks before deployment.

## Authoritative Sources

- `migrations/`: installed schema evolution and constraints.
- `database/models/`: application field/association definitions.
- `database/schema.sql`: reference snapshot, not a safe upgrade/reset script.
- Sequelize's migration metadata and the installed MySQL schema: actual state.

Use `npm run migrate` for pending changes after a backup. No migration, seed or
database write is required merely to update this documentation.

## Domain Tables

| Table | Purpose |
| --- | --- |
| `departments`, `batches` | Department affiliation and course/cohort years |
| `admin_users` | Login accounts; distinct from teaching faculty and student identities |
| `faculty`, `subject_faculty` | Teaching faculty and many-to-many offering assignments |
| `result_sessions` | Batch + academic semester + examination month/year |
| `academic_courses` | Stable batch/semester/course identity, definition and roster review |
| `subjects` | Session-specific course offerings |
| `students` | Student identity, batch, category, status and soft-delete timestamp |
| `results` | Per-student/session/attempt headers and stored GPA provenance |
| `subject_results` | Original subject attempt outcomes and component/grade snapshots |
| `revaluation_results` | Historical proposed/approved/rejected revaluation ledger events |
| `import_logs`, `ocr_extractions` | Upload/extraction/review staging, not authoritative academic outcomes |
| `system_settings`, `setting_audits` | Allowlisted branding settings and configuration change history |

There are 16 exported domain models. The initial schema also defines
`activity_logs`; it has no exported domain model in the current loader.
The session-store table and Sequelize migration metadata are infrastructure,
not additional student/result workflow models.

## Important Keys and Invariants

- `subjects`: unique offering code within a session, not globally unique.
- `result_sessions`: unique batch/semester/exam-session/exam-year combination.
- `academic_courses`: unique batch/semester/exact normalized subject code.
- `subject_faculty`: unique subject/faculty pair; more than two faculty supported.
- `students`: unique USN/email/UUID; soft deletion does not release those keys.
- `results`: unique student/session/attempt number. New entries use REGULAR or
  BACKLOG; legacy SUPPLEMENTARY/REPEAT remain readable. New attempt numbering
  continues per student/academic semester across sessions: REGULAR 1, BACKLOG 2,
  3 and onward. Legacy session-scoped numbers are preserved. Semester numbering
  is enforced by locked application validation; the existing database index remains.
- `subject_results`: unique result/subject pair.
- `revaluation_results`: unique subject-result/event number, with reviewer and
  effective-state provenance. Multiple historical events may exist.
- `system_settings`: unique setting key. Setting audit stores actor/key/old/new
  values and chronological metadata; it does not store credentials.

Student model setters trim/uppercase USNs and names and lowercase emails.
Normalization migrations address existing stored identities; they are not
equivalent to a database-wide automatic normalization trigger for raw SQL.

## Marks, GPA and History

Subject offerings carry credits and internal/external/total maxima, including
valid zero component maxima. Original SubjectResults store component marks,
canonical total/status/grade and optional grade-point, credit, course and grading
scheme snapshots.

Result SGPA/CGPA are nullable `DECIMAL(4,2)` values. `sgpa_source`, `cgpa_source`,
`cgpa_is_cumulative` and scheme metadata distinguish certified calculation from
legacy/unknown provenance. Missing evidence is not stored as a fabricated zero.
Snapshots are not rewritten merely because a later retake or revaluation exists.

REGULAR imports require reviewed course rosters and previous original cards as
defined by the workflow. These application-level checks supplement database
foreign keys/unique constraints; a schema diagram alone does not enforce them.

## Revaluation and Effective Data

SubjectResult has many historical revaluation events, not a one-to-one revision.
Approval serializes changes and demotes the prior effective event as needed.
Reports/Analytics use the highest-numbered approved effective event per original
SubjectResult and fall back to originals. Original rows and stored header GPA
remain unchanged.

The migration-defined `effective_student_results` view joins on effective state.
Do not assume that view alone implements every repository approval/deduplication
guard; current report/academic repositories explicitly enforce their overlay.
OCR `extracted_json` contains proposals, validation state and stage diagnostics,
not persisted academic truth.

## Migration Groups

- Initial schema and 2023 constraints/metadata.
- August/September 2026: component maxima, attempts, revaluation ledger and
  session-scoped subject-code uniqueness.
- October 2026: student category changes, subject components, stable academic
  courses/roster and GPA provenance, Settings audit.
- 15 October 2026: student USN, email and name normalization.

See exact ordered files in `migrations/`. Some history-preserving migrations
refuse destructive rollback. Foreign-key delete actions vary by relationship;
do not assume all entities cascade or all deletes are physically removed.
See [Entity Relationships](er-diagram.md) and
[Academic Result Semantics](academic-result-semantics.md).
