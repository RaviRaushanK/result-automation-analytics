# Entity Relationships

Reviewed on 17 October 2026. This logical diagram follows current domain models;
installed foreign-key actions and migration status must be checked separately.

~~~mermaid
erDiagram
    DEPARTMENTS ||--o{ BATCHES : contains
    DEPARTMENTS ||--o{ FACULTY : contains
    BATCHES ||--o{ EXAM_SESSIONS : schedules
    BATCHES ||--o{ ACADEMIC_COURSES : defines
    BATCHES ||--o{ STUDENTS : registers
    EXAM_SESSIONS ||--o{ SUBJECTS : offers
    ACADEMIC_COURSES o|--o{ SUBJECTS : maps
    SUBJECTS ||--o{ SUBJECT_FACULTY : assigns
    FACULTY ||--o{ SUBJECT_FACULTY : teaches
    STUDENTS ||--o{ RESULTS : has
    EXAM_SESSIONS ||--o{ RESULTS : records
    RESULTS ||--o{ SUBJECT_RESULTS : contains
    SUBJECTS ||--o{ SUBJECT_RESULTS : evaluates
    SUBJECT_RESULTS ||--o{ REVALUATION_RESULTS : has_events
    EXAM_SESSIONS ||--o{ IMPORT_LOGS : scopes
    ADMIN_USERS ||--o{ IMPORT_LOGS : uploads
    IMPORT_LOGS ||--o{ OCR_EXTRACTIONS : stages
    ADMIN_USERS ||--o{ REVALUATION_RESULTS : uploads
~~~

A Subject may lack a mapped AcademicCourse in unresolved legacy data. Such
ambiguity is not silently accepted as a verified course equivalence.

## Identity and Keys

| Entity/table | Primary key | Important identity |
| --- | --- | --- |
| Department / `departments` | department_id | UUID and department code |
| Account / `admin_users` | admin_id | UUID, username, email |
| Batch / `batches` | batch_id | UUID |
| Faculty / `faculty` | faculty_id | UUID, faculty code; optional email |
| ExamSession / `exam_sessions` | exam_session_id | UUID; batch/semester/full examination period |
| AcademicCourse / `academic_courses` | course_id | batch/semester/subject code |
| Subject / `subjects` | subject_id | UUID; session/subject code |
| SubjectFaculty / `subject_faculty` | id | subject/faculty pair |
| Student / `students` | student_id | UUID, USN, email; keys survive soft deletion |
| Result / `results` | result_id | UUID; student/session/attempt number |
| SubjectResult / `subject_results` | subject_result_id | result/subject pair |
| RevaluationResult / `revaluation_results` | revaluation_id | subject-result/event number |
| ImportLog / `import_logs` | import_id | original/revaluation upload context |
| OcrExtraction / `ocr_extractions` | extraction_id | extraction/validation staging for import |
| SystemSetting / `system_settings` | setting_id | unique setting key |
| SettingAudit / `setting_audits` | audit_id | key, actor ID and chronological change record |

`SettingAudit.changed_by` records the acting account ID, but the audit migration
does not add a foreign-key association for it. Course/revaluation review and
snapshot identifiers also carry provenance; not every such identifier is exposed
as a Sequelize association. Consult models and migrations for those distinctions.

## Important Cardinalities

- A teaching offering can have any number of distinct assigned faculty through
  SubjectFaculty. Faculty is not a login account.
- Student and Result identity are authoritative database records, not OCR names.
  A student can have several attempts per session with distinct attempt numbers.
- Each SubjectResult can accumulate multiple historical revaluation events.
  At most one is intended to feed Effective outcomes; zero is normal when no
  approved effective revision exists. The scoped EffectiveRevaluation accessor
  is not a replacement for the historical has-many relationship.
- An import has extraction/review staging. Extraction or a validated proposal
  alone does not create a Result or approved revaluation.
- Stable AcademicCourse identity permits cross-session history without treating
  similarly named or unrelated codes as equivalent.

## Deletion and Effective Results

Student UI deletion uses soft deletion, retaining result history and unique
identity keys. Re-adding/importing a supported deleted identity restores its
existing record in its original batch.

Database foreign-key actions are relationship-specific. Application deletion
guards and transaction boundaries also matter; there is no universal "all
deletes cascade" or "all deletes are restricted" rule.

Reports/Analytics overlay only approved effective revaluation events, with
deterministic deduplication and original fallback. The SQL view and domain
repository queries must not be treated as interchangeable without inspecting
their actual filters.

The initial `activity_logs` table, session-store table and migration metadata
are omitted from this domain diagram. See
[Database Structure](database-structure.md) for scope and provenance details.
