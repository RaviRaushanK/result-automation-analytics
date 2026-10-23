# SRAAS remediation batch 1 — historical record protection

Completed: 23 October 2026. Scope: audit findings C1 (ordinary student USN/batch changes), C2 (generic Result update), and C3 (generic Result deletion). No commit or push.

## Result

- A student with any Result history cannot change USN or batch through Student Management, including direct HTTP requests. Rejection is HTTP 409 with a field-specific explanation.
- Students without Result history retain their existing permitted USN/batch edit behavior and existing validation.
- Name, email, admission category and status remain editable under existing validation, including for students with results. Normalizing an unchanged USN's case/whitespace is permitted. Student ID/UUID are not accepted as editable payload fields.
- Generic `PUT /results/:id` and `DELETE /results/:id` now always return HTTP 403 without invoking Result persistence. Read-only Result retrieval remains available. No new correction workflow was introduced.
- The current upload/review/confirm/import path and separate revaluation event workflow remain in place. The same-import transaction may still finish calculating the new Result's CGPA before commit; this is initialization, not an edit of an existing imported record.

## Root causes and changes

| Finding | Root cause | Implemented protection |
|---|---|---|
| C1 | Student update validated form values and uniqueness, then wrote USN/batch without checking history or coordinating with result imports. | Managed transaction locks the Student row, validates inputs in the transaction, and uses a locking current read for any Result before allowing an identity change. |
| C2 | The legacy update already excluded attempt/association changes, but directly wrote GPA/status/failure-count snapshots and reset provenance without authoritative calculation/history checks. | Retired the entire generic update operation, including forged association/attempt/GPA/status requests. |
| C3 | The legacy delete directly destroyed a Result; live FKs cascade from Result to SubjectResult to RevaluationResult. | Retired generic deletion at controller level, so direct route and direct controller calls cannot reach destruction. |

Student restoration was also inspected because Add/Import can update a soft-deleted row. It retains the original ID/UUID and same-batch restriction; the locked restore now also verifies that the USN still matches the validated identity, rejecting stale restoration instead of rewriting it.

No generic SubjectResult update/delete route was found in the runtime controllers/routes/services/repositories. Original SubjectResults remain inserted by the controlled import. Revaluation approval continues to insert separate RevaluationResults and preserve original marks/status/grade and parent historical GPA.

## Files changed in this batch

These are this batch's files, distinct from the earlier exam-type/attempt/session work already present in Git.

| File | Why |
|---|---|
| `controllers/studentController.js` | Transactional USN/batch history guard; current-read lock; transaction propagation to form validation; history flag for edit UI; stale restore USN guard. |
| `controllers/resultController.js` | Replace generic update/delete persistence with clear HTTP 403 errors. Earlier result-upload changes retained. |
| `public/js/students.js` | Make historical USN read-only and batch disabled from the server history flag; reset protection for Add Student. |
| `views/students/index.ejs` | Explain protected identity fields and remaining editable fields; update client script cache version. |
| `tests/historical-record-protection.test.js` | 22 new isolated tests, including real local HTTP routes with mocked storage, both edit/import orderings and positive revaluation approval. |
| `tests/student-validation.test.js` | Adapt existing fixtures to transactional edits and add stale-restoration protection regression. |
| `tests/student-directory-client.test.js` | Two client-behavior tests for historical/nonhistorical edit forms and resetting Add Student. |
| `docs/historical-record-protection-report.md` | This report. |

No schema/model/migration, Analytics, OCR, backlog eligibility, GPA policy or revaluation identity-matching code was changed in this batch.

## Student edit and import concurrency

Ordinary edit now acquires the same Student row lock that standard result confirmation and the legacy Result creator acquire before creating Result history. The edit retains that lock through the history check and update/commit.

- If import commits first, the waiting edit observes Result history and rejects a changed USN/batch.
- If identity edit commits first, a waiting stale import fails its current USN/batch association checks before inserting history.
- Result existence is checked with a locking read, not an ordinary repeatable-read snapshot. This matters because validation queries may already have established an older transaction snapshot.
- Safe non-identity edits remain permitted and serialized on that Student row.

**EXECUTED AND VERIFIED:** four deterministic isolated interleavings using the real edit/import controllers and a shared mocked row lock, covering both orderings for USN and batch. Tests assert locks, current-read options, and preserved/rejected inserts. **NOT VERIFIED:** simultaneous transactions against a dedicated live MySQL fixture database. No live concurrency stress test was run. This protection covers the current runtime authoring paths; it is not a database-wide prohibition on privileged SQL or separate maintenance tools.

## Database and cascade safety

Read-only information_schema inspection confirmed:

| Child FK | Parent | ON DELETE |
|---|---|---|
| results.student_id | students | RESTRICT |
| results.session_id | result_sessions | RESTRICT |
| subject_results.result_id | results | CASCADE |
| subject_results.subject_id | subjects | RESTRICT |
| subject_results.course_id_snapshot | academic_courses | RESTRICT |
| revaluation_results.subject_result_id | subject_results | CASCADE |

Cascade behavior remains. Application-level retirement is sufficient for the generic administrator mutation paths in this batch: there is no remaining runtime `Result.destroy`/generic `Result.update` or `SubjectResult.destroy/update` path in the inspected controllers/services/repositories/routes. Student deletion remains soft deletion, and parent physical deletion is restricted by the live FKs. Subject/session/batch deletion cannot cascade through these saved result references.

**Separate maintenance path still exists:** `seed/academic/persist.js` reset explicitly deletes academic tables, and its persist routine can reassign the retained real student identities to the seeded batch. `seed/seed_demo.js` restricts execution to an explicitly confirmed local development/test database, refuses production-like environments, and creates a backup before reset. It is not exposed through ordinary Result/Student Management. Nevertheless, running that explicit reset against a development database containing real academic history can remove that history. The script was inspected only, never executed or changed. Privileged SQL remains capable of destructive operations too.

No migration was introduced: changing cascade FKs would not protect against a maintenance routine that explicitly deletes children first, and would be unnecessary scope expansion for disabling the two generic HTTP mutations. This is not a claim of global database immutability.

## Regression verification actually executed

Final run: **329 tests total; 328 passed; 1 skipped; 0 failed; 0 cancelled.**

The one skip was the optional read-only MySQL student-search collation test because its DB-test flag was not enabled. Independent read-only database inspections were executed below. A preliminary focused run also passed; counts overlap and are not added together. One initial test-fixture run was stopped after exposing missing mock session metadata; the fixture was corrected before the passing final runs. No production defect was inferred from that harness setup error.

```powershell
node --test tests/historical-record-protection.test.js tests/student-validation.test.js tests/student-directory-client.test.js tests/student-directory.test.js tests/student-category.test.js tests/result-persistence.test.js tests/result-history.test.js tests/exam-types.test.js tests/session-identity-safety.test.js tests/result-preview-cgpa.test.js tests/result-student-registration.test.js tests/revaluation-duplicate-validation.test.js tests/revaluation-success.test.js tests/result-success.test.js tests/result-management-layout.test.js tests/marks-card-upload.test.js tests/pdf-extraction-completeness.test.js tests/subjects-roster.test.js tests/academic-form-edits.test.js test/analytics-revaluation.test.js
```

| Requested verification | Executed evidence |
|---|---|
| 1. No-history student legitimate edit | Direct local HTTP PUT tests, USN and batch. |
| 2–3. Historical USN/batch immutable | Direct local HTTP PUT tests, each field and combined changes. |
| 4. Safe non-identity edits | Direct local HTTP test changes name/email/category/status and verifies academic rows unchanged. |
| 5–6. Direct request bypass rejected | Actual Express student route; forged history flag does not alter server decision. |
| 7–11. Generic GPA/status/attempt/type/association edits rejected | Eight direct HTTP PUT tests with valid-looking changed values; no persistence calls or row changes. |
| 12. Generic deletion rejected | Direct HTTP DELETE and POST/method-override manipulation tests. |
| 13–14. Child rows preserved | Mock Result/SR/revaluation fixture remains unchanged after rejected deletion; no live destructive query. |
| 15. REGULAR import | Existing result-persistence/registration/GPA tests, including successful confirmation. |
| 16–18. BACKLOG import/sequence/period | Existing persistence/history/exam-type tests, including cross-session sequence, repeated normalized period rejection and later valid period. |
| 19. Backlog SGPA null | Existing successful backlog persistence assertion. |
| 20. Revaluation upload/review/approval | Existing extraction/upload/review/duplicate tests plus new successful approval fixture. These are separate isolated stages, not one interactive end-to-end browser run. |
| 21. Original rows unchanged after revaluation | New successful approval test compares original Result/SR snapshot and verifies a separate approved/effective event. |
| 22. Session historical identity freeze | Existing session-identity-safety suite. |
| UI feedback/reset | VM client tests protect USN/batch only with history and restore editable Add Student fields. Existing EJS render test also passed. |
| Restore identity | Existing create/import restore tests and new stale-USN restoration test. |
| Import/edit race | Four isolated controller interleavings; live MySQL stress not performed. |

`git diff --check` passed. No interactive visual redesign/review was performed; the only UI addition is the edit-form notice and field protection. Existing demo-seed suite failures recorded in the audit were not fixed or rerun in this scoped batch; the passing regression run does not claim the whole repository is green.

## Real-data safety

All mutation tests used isolated fixtures/mocks, including the local HTTP tests. No real Student, Result, SubjectResult or RevaluationResult was created, edited, deleted or restored. No uploaded academic document was changed. No seed or migration was run.

Read-only checks loaded the four academic tables ordered by primary key, recording only row counts and SHA-256 digests rather than copying personal rows into the report. Before/after checksums matched:

| Table | Rows | SHA-256 |
|---|---:|---|
| students | 88 | 0c1b18b081bf59c84c72f4097de04dae47343a36278ca313c1380313b4734ae9 |
| results | 18 | cec0f0031860caa2a2e33af571d9549f822f09062e3068a6356c51fa710d98b3 |
| subject_results | 117 | ca2cf18d26fe61bc2ed37ef4806ba834e71122d50285e33c0f214fff810f7dd6 |
| revaluation_results | 1 | 477d607de2ce99c8062cd99caf0b0f7b42339b378abe8e3116f78e8bbac0eb80 |

Machine-readable DB checks, final test log and the pre-existing Git diff are under `C:\Users\Ravi\AppData\Local\Temp\sraas-remediation-batch-1`.

## Findings intentionally unresolved

**CRITICAL:** C4, conflicting-USN revaluation document acceptance, remains unresolved by instruction. Student-name edits remain allowed as explicitly requested; this batch protects the authoritative USN/batch identity, not an immutable name label.

**HIGH:** H1 incomplete legacy Result POST; H2 weak batch updates; H3 backlog subject eligibility; H4 permissive marks parsing; H5 document-period/stale-session binding; H6 conflicting OCR row handling; H7 roster/course confirmation concurrency; H8 revaluation document-to-attempt matching; H9 stale revaluation proposal approval. Other MEDIUM/LOW audit findings remain deferred. No new overall SAFE rating is claimed.

## Git status

The earlier 34 modified tracked files and 6 untracked files were retained. This batch adds five newly modified tracked files, changes the already-modified result controller, and adds the focused test and this report. Final working tree: **39 modified tracked files and 8 untracked files** (Git short status groups the analytics partial directory). No commit/push.

Exact final status follows.
```text
 M controllers/resultController.js
 M controllers/sessionController.js
 M controllers/studentController.js
 M database/models/Result.js
 M docs/academic-result-semantics.md
 M docs/database-structure.md
 M public/js/analytics/failed.js
 M public/js/analytics/overview.js
 M public/js/analytics/subjects.js
 M public/js/analytics/toppers.js
 M public/js/reports/result-analysis.js
 M public/js/results/uploadSession.js
 M public/js/students.js
 M services/academicPolicy.js
 M services/reportsService.js
 M services/resultHistoryService.js
 M services/settingsService.js
 M tests/academic-form-edits.test.js
 M tests/academic-outcomes.test.js
 M tests/pdf-extraction-completeness.test.js
 M tests/reports.test.js
 M tests/result-history.test.js
 M tests/result-persistence.test.js
 M tests/result-preview-cgpa.test.js
 M tests/result-student-registration.test.js
 M tests/student-directory-client.test.js
 M tests/student-validation.test.js
 M views/analytics/failed.ejs
 M views/analytics/overview.ejs
 M views/analytics/semesters.ejs
 M views/analytics/students.ejs
 M views/analytics/subjects.ejs
 M views/analytics/toppers.ejs
 M views/reports/partials/page.ejs
 M views/reports/partials/result-analysis-table.ejs
 M views/results/preview.ejs
 M views/results/review.ejs
 M views/results/upload.ejs
 M views/students/index.ejs
?? docs/backlog-session-safety-report.md
?? docs/exam-type-simplification-report.md
?? docs/historical-record-protection-report.md
?? tests/exam-types.test.js
?? tests/historical-record-protection.test.js
?? tests/session-identity-safety.test.js
?? views/analytics/partials/exam-type-filter.ejs
?? views/results/partials/import-scope.ejs
```
