# ER Diagram Explanation (Textual)

**Entities**

| Table                | Primary Key                | Unique Columns                     |
|----------------------|----------------------------|------------------------------------|
| departments          | department_id (BIGINT)     | department_uuid, department_code   |
| admin_users          | admin_id (BIGINT)          | admin_uuid, username, email        |
| activity_logs        | log_id (BIGINT)            | –                                  |
| batches              | batch_id (BIGINT)          | batch_uuid                         |
| faculty              | faculty_id (BIGINT)        | faculty_uuid, faculty_code         |
| result_sessions      | session_id (BIGINT)        | session_uuid                       |
| subjects             | subject_id (BIGINT)        | subject_uuid, subject_code         |
| subject_faculty      | id (BIGINT)                | (subject_id, faculty_id) unique    |
| students             | student_id (BIGINT)        | student_uuid, usn                  |
| results              | result_id (BIGINT)         | result_uuid                        |
| subject_results      | subject_result_id (BIGINT) | (result_id, subject_id) unique     |
| revaluation_results  | revaluation_id (BIGINT)    | –                                  |
| import_logs          | import_id (BIGINT)         | –                                  |
| ocr_extractions      | extraction_id (BIGINT)     | –                                  |
| system_settings      | setting_id (BIGINT)        | setting_key (unique)               |

**Relationships**

* **Department 1‑M Batch** – `batches.department_id → departments.department_id`
* **Department 1‑M Faculty** – `faculty.department_id → departments.department_id`
* **Batch 1‑M ResultSession** – `result_sessions.batch_id → batches.batch_id`
* **ResultSession 1‑M Subject** – `subjects.session_id → result_sessions.session_id`
* **Subject M‑N Faculty** – via `subject_faculty` junction table.
* **Batch 1‑M Student** – `students.batch_id → batches.batch_id`
* **Student 1‑M Result** – `results.student_id → students.student_id`
* **ResultSession 1‑M Result** – `results.session_id → result_sessions.session_id`
* **Result 1‑M SubjectResult** – `subject_results.result_id → results.result_id`
* **Subject 1‑M SubjectResult** – `subject_results.subject_id → subjects.subject_id`
* **SubjectResult 1‑1 RevaluationResult** – `revaluation_results.subject_result_id → subject_results.subject_result_id`
* **ResultSession 1‑M ImportLog** – `import_logs.session_id → result_sessions.session_id`
* **AdminUser 1‑M ImportLog** – `import_logs.uploaded_by → admin_users.admin_id`
* **ImportLog 1‑M OcrExtraction** – `ocr_extractions.import_id → import_logs.import_id`

**Cascade / Restrict Rules**

* Deleting a **Department**, **Batch**, **ResultSession**, **Student**, **Result**, **Subject**, **AdminUser**, or **ImportLog** is **RESTRICTED** to protect academic data.
* Deleting a **Subject** cascades to **SubjectFaculty** and **SubjectResult**.
* Deleting a **Result** cascades to **SubjectResult** (and thus to **RevaluationResult**).
* Deleting an **ImportLog** cascades to **OcrExtraction**.

**View**

`effective_student_results` combines `results`, `subject_results`, and `revaluation_results` so that if a revaluation exists, the revised marks/grade are shown; otherwise the original marks/grade are used.

This textual diagram captures all entities, keys, and relationships required for a production‑ready academic result management system.