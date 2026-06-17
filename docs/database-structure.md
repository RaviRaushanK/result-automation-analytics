# Database Structure Updates (SRAAS)

## New Constraints & Indexes
- **subjects**: Composite unique constraint `UNIQUE(session_id, subject_code)` replaces the previous global unique on `subject_code`.
- **result_sessions**: Composite unique constraint `UNIQUE(batch_id, semester, exam_session, exam_year)` added.
- **results**: Columns `sgpa` and `cgpa` are now nullable (`DECIMAL(3,2) NULL`).
- **revaluation_results**: Added columns
  - `revised_grade` VARCHAR(5)
  - `file_name` VARCHAR(255)
  - `file_path` VARCHAR(255)
  - `remarks` TEXT
  - `uploaded_by` BIGINT (FK → `admin_users.admin_id`)
- **students**: Added index `idx_student_usn` on `usn`.

## Views
- **effective_student_results**: Updated to use `revised_grade` from `revaluation_results`:
  ```sql
  COALESCE(rr_rev.revised_grade, srs.grade) AS effective_grade
  ```

## Migrations
- New migration `20231101000000-modify-schema.js` implements all the above schema changes.

## Seeders
- Fixed subject insertion syntax and removed duplicate entries in `seeders/20231001000100-seed-mca.js`.

These changes ensure:
- Subject codes can be reused across different sessions.
- Result sessions cannot be duplicated.
- SGPA/CGPA can be null where appropriate.
- Revaluation metadata is captured and linked to the uploading admin.
- Improved query performance with additional indexes.