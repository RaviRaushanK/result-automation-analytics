# SRAAS critical/high remediation and adversarial re-audit

Date: 23 October 2026. This work preserves Remediation Batch 1. No commit or push.

## Outcome and evidence boundaries

The remaining code paths were hardened in controlled batches, followed by adversarial regression runs. Positive conflicting USNs cannot reach revaluation approval; generic Result creation is retired; backlog subject eligibility is enforced; marks parsing is strict; review/configuration staleness is checked; curriculum/history mutations share locks; and historical configuration changes are restricted.

**Overall rating: PARTIALLY SAFE.** All four original CRITICAL findings are fixed in the inspected application paths. H5 and H8 remain **PARTIALLY FIXED as fully automatic document-to-sitting verification**: available contradictions are rejected, but a document that omits its examination period/attempt cannot prove those facts. Explicit administrator verification is now required, as requested. No missing date, attempt, component-status rule, or institutional curriculum rule was invented. The software cannot certify facts absent from both the document and authoritative stored data. The report does not turn that limitation into an unconditional SAFE rating.

Evidence notation throughout:

- **E — EXECUTED AND VERIFIED:** local HTTP/controller/service tests with isolated persistence, executed existing tests, or explicitly identified read-only live database checks.
- **C — CODE-INSPECTION FINDING:** inspected implementation/locking/layer boundaries, not a demonstrated live write.
- **N — NOT VERIFIED:** interactive browser operation, real concurrent MySQL stress, or an academic fact unavailable in the current data.

Mutation tests use fake academic identities, models and transactions. Local HTTP probes exercise the actual Express routes without connecting their mutation handlers to real records. Deterministic concurrency fixtures exercise real controllers with shared mocked locks. They do not constitute a production MySQL stress test.

## 1. Original findings mapped to remediation

| Finding | Severity | Status | Implementation and evidence |
|---|---|---|---|
| C1 — Student identity/batch relabels history | CRITICAL | FIXED (Batch 1 retained) | Student row lock and Result-history guard retained. E: direct HTTP USN/batch rejection, safe edits, restore and import/edit interleavings. |
| C2 — Legacy Result PUT overwrites original GPA/status | CRITICAL | FIXED (Batch 1 retained) | Generic PUT remains 403 with no persistence. E: GPA/status/count/type/attempt/student/session request probes. |
| C3 — Generic Result DELETE cascades away history | CRITICAL | FIXED (Batch 1 retained) | Generic DELETE remains 403. E: direct DELETE/POST manipulation leaves parent/children intact in fixtures; live cascade metadata inspected read-only. |
| C4 — Conflicting-USN revaluation becomes effective | CRITICAL | FIXED | Exact USN comparison, including raw OCR candidate and available document claims; matching name/fuzzy I/1 or O/0/old confirmation flag cannot override contradiction. Independent final approval check against fresh target. E: forged-confirmation final-approval probes. |
| H1 — Incomplete generic Result POST | HIGH | FIXED | POST /results now returns 403 before starting a write. Supported creation remains controlled upload/review/validate/confirm. E: direct HTTP creation rejected; read endpoints retained. |
| H2 — Weak/mass-assigned batch update | HIGH | FIXED | Field allowlist, strict years/ranges, status/department validation, locked dependent-history/registration guard; deletion dependency checks. E: direct invalid/historical mutations; legitimate status/deactivation and prehistory edits. |
| H3 — Passed/cleared/never-attempted backlog course | HIGH | FIXED | Stable course ID + same student/batch/semester history. Reject any prior effective clearance, missing attempt, or unknown outcome. E: Validate/Preview/Confirm probes, including approved effective revaluation clearance and foreign syllabus IDs. |
| H4 — Permissive numeric parsing | HIGH | FIXED | Shared strict integer parser; malformed prefixes, fractions, unsafe integers, arrays/objects, negative/nonfinite/missing required values rejected. E: original and revised marks probes, including direct review submission. |
| H5 — Wrong period / stale empty session | HIGH | PARTIALLY FIXED | E: source contradictions, session/configuration snapshot changes, stale review token, and processing-state changes rejected. C: all current final-write guards run under locks. N: actual examination period cannot be established automatically if absent from the card; existing 1900–2200 configuration range was not replaced with an invented institutional plausibility rule. Explicit verification is required. |
| H6 — Conflicting OCR rows silently first-win | HIGH | FIXED | Duplicate candidates and conflicting readings are retained as blocking integrity conflicts. Ambiguous duplicate rows receive no arbitrary initial marks. Conflict survives Review and final confirmation. E: final conflict rejection; extraction regression fixtures. |
| H7 — Roster/definition change during confirmation | HIGH | FIXED in current runtime writers | Shared Batch lock in import and curriculum mutation paths, configuration fingerprint at Validate/Confirm, structural/course-identity history guards. E: stale configuration and lock/interleaving fixtures; C: common lock contract. N: live MySQL stress. |
| H8 — Document attached to wrong selected sitting | HIGH | PARTIALLY FIXED | Fresh existing Result/SR ownership, student/batch/session/semester/attempt checks, available source claims, old external-mark comparison, and target snapshot. E: wrong subject/period/type/attempt/old-mark and unavailable-target probes. N: a missing document sitting/attempt, or an unstored old external result status, cannot independently identify the original sitting. Explicit verification is required; no fictional comparison was made. |
| H9 — Stale revaluation proposal approval | HIGH | FIXED | Monotonic review version, source token at freeze, proposal token at approval, target/configuration/baseline snapshot, final fresh checks. E: stale proposal and changed original rejected. |

The H5/H8 partial classifications concern missing evidence, not an override for positive contradictions. **A positive available contradiction still blocks even when verification/identity-confirmation fields are forged.** Automatically closing the remaining evidence gap would require authoritative additional data or a stricter institutional rule refusing documents with missing fields. That policy-dependent portion was not guessed; this follows the user's stop condition on inventing academic rules.

Additional issue found and fixed during the re-audit: draft replacement excluded status `approved`, but successful ImportLogs actually use `success`. It could select an earlier successful processing record/file while replacing a later draft. Both successful/approved states are now excluded in SQL and rechecked in code. E: replacement deletes only the open draft and preserves successful source evidence. No real document was removed.

## 2. Files changed in this remediation

Earlier exam-type/session/Batch 1 changes were already present. The following list identifies this remediation's changes, rather than claiming every dirty Git file was changed here.

### Production

| File | Purpose |
|---|---|
| controllers/academicCoursesController.js | Shared batch lock and historical required-roster protection. |
| controllers/batchController.js | Allowlisted validated update, history/dependency guards, safe errors; preserve compact historical names during unchanged split-form status edits. |
| controllers/resultController.js | Retire generic POST; strict marks; source conflict/context checks; snapshot/token validation; processing-state re-read/idempotency; shared locking; safer errors. Existing PUT/DELETE retirement retained. |
| controllers/revaluationController.js | Exact identity checks, source/proposal versioning, target reload including stored components, event-scoped duplicate detection, active reviewer checks, evidence preservation and safe errors. |
| controllers/studentController.js | Sanitize unexpected category/get/delete/import errors. Batch 1 identity/locking/restore rules retained. |
| controllers/subjectController.js | Strict configuration numbers/code/type checks; positive total ceiling; fresh session and shared batch locks; transactional delete recheck. |
| services/academicConfiguration.js (new) | Deterministic configuration fingerprint using existing session/offering/course identity. |
| services/academicIntegrity.js (new) | Strict marks parser, document claim comparison, duplicate-row detection and hashing. |
| services/revaluationIntegrity.js (new) | Target snapshot, source checks, authoritative component comparison, event fingerprint/reference. |
| services/academicCourseService.js | Historical course code/structural freeze; prevent adding a new stable course to a semester with saved results while allowing existing-course backlog offerings/new-batch curriculum. |
| services/documentExtractor.js | Preserve conflicting recovery identity/semester readings as integrity conflicts. |
| services/resultHistoryService.js | Subject-level backlog eligibility with stable course identity and approved effective overlays. |
| services/revaluationExtractor.js | Preserve source context/raw identity and duplicate conflicts for downstream independent validation. |
| services/revaluationPersistence.js | Record event fingerprint/reference in existing remarks JSON. |
| services/revaluationValidator.js | Shared strict parsing and canonical component maxima; final overall consistency uses the existing 50% engine threshold. Existing old-component threshold helper remains distinct; no new VTU rule inferred. |
| services/vlmExtractor.js | Retain duplicate/disagreeing reading evidence and page claims; reject unsafe mark value types before normalization. |
| views/results/review.ejs | Explicit missing-context/mixed-scope verification. |
| views/results/preview.ejs | Bind confirmation to the validated review token. |
| views/revaluation/review.ejs | MATCH/MISMATCH/NOT PRESENT checks, verification explanation, source/proposal tokens. |

### Tests

- New: tests/academic-configuration-integrity.test.js; tests/revaluation-integrity.test.js.
- Extended: tests/academic-form-edits.test.js; tests/academic-outcomes.test.js; tests/historical-record-protection.test.js; tests/hybrid-extraction-stages.test.js; tests/result-history.test.js; tests/result-persistence.test.js; tests/result-student-registration.test.js; tests/revaluation-duplicate-validation.test.js; tests/sparse-table-ocr.test.js; tests/subjects-roster.test.js.
- Existing fixtures now explicitly provide the reviewed context/locks rather than relying on bypassing the newly required validation. Source attribute projection is tested for original external marks and session identity, so a populated mock does not hide an omitted real query field.

### Documentation / migrations

- docs/academic-result-semantics.md updated with current integrity behavior.
- docs/administrator-integrity-remediation-report.md added (this report).
- **No migration, schema, model, index or dependency change introduced in this remediation.** Existing database/models/Result.js dirtiness predates this task.
- No Analytics redesign, historical enum conversion, GPA formula change, automatic splitting, or tokens.css change.

## 3. Database and real-data integrity

No real academic record was created, edited, deleted, restored, normalized or recalculated. No production-like uploaded document was changed. Live access was read-only. Existing migration unit functions ran only against recording mocks; no live migration/schema operation ran.

Sorted-row SHA-256 checks before and after the remediation matched exactly:

| Table | Rows | Before = after SHA-256 |
|---|---:|---|
| students | 88 | 0c1b18b081bf59c84c72f4097de04dae47343a36278ca313c1380313b4734ae9 |
| results | 18 | cec0f0031860caa2a2e33af571d9549f822f09062e3068a6356c51fa710d98b3 |
| subject_results | 117 | ca2cf18d26fe61bc2ed37ef4806ba834e71122d50285e33c0f214fff810f7dd6 |
| revaluation_results | 1 | 477d607de2ce99c8062cd99caf0b0f7b42339b378abe8e3116f78e8bbac0eb80 |

Read-only live information_schema checks confirmed InnoDB for the audited tables and existing unique indexes for student identities, session(batch,semester,month,year), course(batch,semester,code), offering(session,code), Result(student,session,attempt), SR(result,subject), and revaluation(SR,revaluation_no).

No database exact-one-effective constraint was added. Current application approval locks the parent Result and target SRs, checks duplicates, allocates the next event number, demotes prior effective events and inserts the approved effective event in one transaction. The existing SR+event-number unique key remains a backstop. Different later documents/events remain permitted; the original blanket “any prior approval blocks this Result” rule was removed. Raw privileged SQL is outside this application contract.

Existing cascades remain Result → SubjectResult → RevaluationResult. Ordinary generic deletion is blocked; relevant parent/configuration dependencies are restricted. Before/after foreign-key metadata matched. No FK was blindly rebuilt.

Additional live read-only integrity aggregates all returned zero:

- Result student/session batch mismatch.
- SR offering-session/parent Result-session mismatch.
- Offering course batch/semester scope mismatch.
- Subjectless Result headers.
- Missing stable course identity in saved subject history.
- More than one approved effective event for a SubjectResult.
- Non-approved effective events.

These aggregates do not prove document authenticity or every historical GPA's correctness. They establish the stated checks only. The existing real dataset has no live backlog history used for write/race testing; those mutation scenarios were isolated fixtures.

Separate maintenance remains: the explicitly guarded local development/demo reset script can delete academic tables after environment/database confirmation and backup. It is not an ordinary administrator HTTP operation, was not executed/changed, and must not be used against real academic history. Application immutability is not a promise against privileged SQL or explicit maintenance resets.

## 4. Academic Management re-audit

| Area | Administrator mistake | Current protection / evidence | Status | Severity / residual | Recommendation |
|---|---|---|---|---|---|
| Department | Direct CRUD / duplicate/empty authoring | C: no department authoring route; lookup only. Department code unique, referenced deletion restricted. | NOT APPLICABLE | INFORMATIONAL | Re-audit if CRUD is introduced. |
| Batch | Reversed/malformed years, invalid status/department, mass assignment | E: invalid direct updates rejected before write; active department required when changing association. | BLOCKED | INFORMATIONAL | Retain allowlist and validation. |
| Batch | Change identity/department/years with dependent students/history | E: locked history/registration guard rejects; no Result reassignment. | BLOCKED | INFORMATIONAL | Use a separate cohort for new identity/syllabus. |
| Batch | Deactivate historical compact-name cohort | E: full existing split-form payload can change status while preserving MCA2025 spelling. | ALLOWED BUT SAFE | INFORMATIONAL | Retain historical identity. |
| Batch | Delete populated historical cohort | E: dependency rejection; C/live FK RESTRICT backstop. | BLOCKED | INFORMATIONAL | Preserve history; no restore redesign. |
| Batch | Duplicate/ambiguous business names | C: business-name uniqueness was not added; ID-based UI selection is distinct, but legacy name-based resolution can be ambiguous. | POTENTIAL DEFECT | MEDIUM | Define business identity/ambiguity handling separately. |
| Session | Duplicate identity or identity edit after Results | E: existing tests retain normalized uniqueness, semester limits and identity freeze. | BLOCKED | INFORMATIONAL | Preserve guards. |
| Session | Change empty session after review | E: final snapshot/token detects changed examination period/configuration. | BLOCKED | INFORMATIONAL | Re-review current session. |
| Session | Very old/future configured year | C: existing 1900–2200 policy retained; actual source contradiction rejected, absent source period needs verification. | PARTIALLY BLOCKED | H5 evidence limit | Establish authoritative period evidence/policy rather than guess. |
| Subject | Duplicate/invalid code, malformed numbers, bad maxima/credits | E: strict configuration checks, scoped uniqueness and marking-sum validation. Zero-credit and zero-component legitimate courses remain valid; zero total grading ceiling is rejected. | BLOCKED | INFORMATIONAL | Retain constraints. |
| Subject/course | Rewrite historical code/type/credits/ceilings | E: history guard covers offerings and stable snapshots. | BLOCKED | INFORMATIONAL | No ordinary historical repurposing. |
| Subject/course | Descriptive name correction | E: retained editable and synchronized; numerical history untouched. | ALLOWED BUT SAFE | INFORMATIONAL | Names are descriptive metadata, not immutable text snapshots. |
| Required courses | Change required roster after saved results | E: locked dependency guard; before-history corrections still allowed. | BLOCKED | INFORMATIONAL | New cohort for curriculum changes; controlled correction would be separate work. |
| Student | USN/batch relabeling or stale restore | E: Batch 1 direct HTTP and restore regressions retained. | BLOCKED | INFORMATIONAL | Keep primary USN/batch identity. |
| Student | Name/email/category/status edit | E: established safe fields remain editable. | ALLOWED BUT SAFE | INFORMATIONAL | Existing validation retained. |
| Student | Soft deletion / inactive import visibility | C: existing lifecycle/inclusion policy preserved; rows retained and restoration identity protected. | PARTIALLY BLOCKED | MEDIUM policy/visibility | Reconcile report visibility/inactive policy separately. |
| Syllabus | Same code reused by a new cohort | E: distinct stable Course IDs and definitions for batch 1 vs batch 2. | ALLOWED BUT SAFE | INFORMATIONAL | Existing batch-scoped model is sufficient; no redesign. |
| Old syllabus backlog | New cohort's same code incorrectly selected | E: old-student backlog persists the old batch course snapshot; foreign-course insertion rejected. | BLOCKED | INFORMATIONAL | Retain course-ID, batch and semester scope. |

Initial curriculum accuracy still requires institutional review: the system cannot know that a plausible credit value or required-course selection is factually wrong without an authoritative catalogue. No outside VTU rule or new duration rule was invented. Historical protection prevents later ordinary repurposing; it cannot retroactively certify initial configuration truth.

## 5. REGULAR re-audit

| Mistake | Protection and evidence | Result |
|---|---|---|
| Attempt 2/3, legacy type on new import | E: only REGULAR Attempt 1; historical labels remain readable. | BLOCKED |
| Second REGULAR / another session / concurrent duplicate | E: final semester history, Student lock and existing DB uniqueness; concurrent fixture keeps one original. | BLOCKED |
| Missing required theory/lab or wrong subject/session ID | E: full verified roster and canonical offering/course checks at Validate and final confirmation. | BLOCKED |
| Malformed/negative/over-max/fractional marks | E: strict parser and applicable maxima; genuine zero supported. | BLOCKED |
| Inject grade/status/SGPA/CGPA/failure count | E: derived server-side from validated stored inputs; generic POST/PUT disabled. | BLOCKED |
| Conflicting duplicate rows / AI readings | E: persistent blocking conflicts; no first-match arbitrary marks; final check. | BLOCKED |
| Wrong source USN/semester/period when present | E: positive contradictions cannot be acknowledged away in a single-scope card. | BLOCKED |
| Missing source examination information | E: unchecked verification fails; selected context must be explicitly verified. N: actual missing fact. | PARTIALLY BLOCKED — H5 |
| Mixed card's global semester/type header | E: separate upload, visible exclusions, explicit mixed verification and unambiguous existing course scope. Excluded rows never persisted. | ALLOWED BUT SAFE within verified scope |
| Roster/session/subject changes after review | E: fingerprint mismatch and full fresh validation reject. | BLOCKED |
| Review changes after initial Confirm load | E: locked processing-state/OCR re-read rejects stale extraction/decisions. | BLOCKED |
| Reopen a successful processing record to create unrelated history | C/E: success is terminal for validation/confirmation; logical duplicate checks remain. | BLOCKED |
| Rename/re-upload same logical original | E: history identity and duplicate rules do not depend on filename. | BLOCKED |

SGPA/CGPA policy is unchanged. REGULAR includes all applicable required credits and F=0 grade points. Cumulative values require verified course history; otherwise null. No source GPA is trusted and no historical GPA was recalculated. The new Result may finish its existing cumulative calculation before its own transaction commits.

## 6. BACKLOG re-audit

- E: REGULAR 1, BACKLOG 2/3/4… sequencing across sessions retained; no artificial maximum introduced.
- E: same normalized examination period is rejected even with another session ID/full-vs-abbreviated month; semester 2 REGULAR can coexist in the same calendar period as semester 1 BACKLOG.
- E: the selected course must have an earlier attempted, known failed and uncleared effective history in the student's original batch/semester.
- E: previously PASS, cleared in an earlier backlog, cleared by an approved effective revaluation, never-attempted, unknown and foreign-syllabus courses are rejected. Every selected course is checked; one valid course does not excuse another invalid course.
- E: one/several eligible subjects remain a valid partial backlog; complete REGULAR roster is not imposed on retakes.
- E: injected SGPA does not change the null backlog SGPA; the original REGULAR header remains unchanged.
- E: simultaneous Attempt 2 controller confirmations produce one retake and preserve the original record. C: shared current-history locking and existing uniqueness are the server/DB backstops. N: real concurrent MySQL stress.
- Source-period absence has the same H5 verification limitation as REGULAR; a future “reasonable exam year” rule was not fabricated.

## 7. REVALUATION re-audit

- E: positive conflicting USN, subject, semester, period, year, attempt/type and old external marks are rejected again at final approval. The old identity-confirmation flag cannot override them.
- E: original target must exist, have authoritative Student/session/subject context, belong to the exact selected Result and offering, and match the reviewed target snapshot. Missing/deleted authoritative context cannot be approved merely by acknowledging a missing document USN.
- E: original external components are actually selected by the real query, not merely supplied by an overpopulated mock. The current nine-column oldMarks is compared to stored external_marks, not to the overall total.
- The original external result status is not stored separately. Comparing that column to overall SR pass/fail would invent a component rule. Its verification limitation is explicitly displayed and acknowledgment is required. Current extraction does not provide a dependable original grade column; no fictional old-grade extraction was claimed.
- E: revised components are strict integers within subject limits; totals/status/grade are server-derived. Positive, zero and negative deltas are permitted. Original Result/SR/parent GPA remain unchanged.
- E: source/proposal tokens and monotonic review versions prevent approving unseen replacement proposals; changed original targets require fresh review.
- E: reviewer must be an authoritative positive ID and a current active, non-deleted administrator. No implicit default administrator is used.
- E/C: validated approval controls event state; pending/rejected or client-supplied status/effective fields cannot directly become an overlay. Only approved+effective events affect current/effective semantics.
- E: concurrent fixture approvals serialize, retain both legitimate distinct event rows and leave one effective event per SR. Old event rows are demoted, not deleted.
- E: document hashes reject renamed identical uploads for the same target. Explicit printed revaluation references also reject the same identified event after re-encoding. Later distinct events remain allowed; a previously unprocessed subject on the same document is not blocked by another subject's history.
- E: successful import/document evidence is excluded from draft superseding. No academic Result or SubjectResult is created by revaluation.
- N: no live browser end-to-end approval, actual AI service evaluation, or concurrent MySQL approval stress was performed. Extraction/review/approval fixtures are distinct executed stages.

## 8. Direct request / UI bypass and error handling

E: direct local HTTP/controller probes exercised student USN/batch updates, Result POST/PUT/DELETE, batch identity/years/status/IDs, roster changes, source conflicts, stale tokens, malformed marks, target selection and revaluation status/effective injection. Query-critical scope comes from saved server processing state and fresh database definitions, not hidden identity fields. Marks/status/GPA are independently derived and validated.

The ordinary Result workflow cannot be reached as a Revaluation import type, and revaluation requires its own existing Result/SR processing context. No automatic mixed-document splitting or cross-table attempt authoring was added.

New/changed failure messages explain the invalid field/context, why saving is blocked and how to re-review/select the correct attempt. Unexpected batch/student/result/revaluation errors are sanitized instead of returning SQL, stack traces or filesystem paths. Known validation messages remain specific. No broad visual redesign was performed.

Broader authorization remains a MEDIUM concern: some academic/original-result mutations still rely on the existing authenticated session/menu role model rather than uniform current-account/role/CSRF enforcement. This task hardened final revaluation approval, not the whole authentication architecture. SameSite=Lax provides partial CSRF mitigation; no exploit was claimed or executed.

## 9. Tests actually executed

Counts are per run, overlap, and must not be added as unique tests.

| Run | Passed | Failed | Skipped | Exit | Scope |
|---|---:|---:|---:|---:|---|
| Batch 2 checkpoint | 75 | 0 | 0 | 0 | Revaluation integrity, duplicate/success, Batch 1, effective analytics. Later additions are covered by final broad runs. |
| Batch 3 checkpoint | 163 | 0 | 0 | 0 | Original/backlog history/persistence/type/registration/extraction. |
| Batch 4 checkpoint | 162 | 0 | 0 | 0 | Snapshot/token/registration/session/Batch 1 regressions. |
| Batch 5 checkpoint | 56 | 0 | 0 | 0 | Academic edits, roster, batch creation, sessions, Batch 1. |
| Academic adversarial checkpoint | 147 | 0 | 0 | 0 | Invalid/historical config, scope, old syllabus and roster immutability. |
| Result/revaluation adversarial checkpoint | 206 | 0 | 0 | 0 | Direct bypass, malformed input, duplicate/concurrent/stale cases. Subsequent target/reviewer cases are in the final broad run. |
| Final all existing safe-discovered .test.js files | **612** | **4** | **11** | **1** | **627 total**, including unchanged demo consistency suite. |
| Final suite excluding known failing demo-seed file | **609** | **0** | **10** | **0** | **619 total**; source authoring/regression tests. |
| Explicit read-only DB subset | **83** | **0** | **0** | **0** | Real SELECT/CTE report/outcome/search tests. |

The safe-suite final counts above include the final authoritative Student/subject/reviewer cases. Intermediate regression failures were resolved before continuing: mocks needed the newly requested transactional context/attributes, old tests expecting generic creation or historical code edits were updated to the authorized policy, and the recovery test now expects preserved conflict evidence. No failed test was reported as passed.

### Commands

```powershell
# Broadest discovered existing suite (DB/write integration flags unset)
$safeTestFiles = @(rg --files tests test -g '*.test.js')
node --test @safeTestFiles

# Separate green regression run, preserving the known demo failures in the broad report
$safeTestFiles = @(rg --files tests test -g '*.test.js' |
  Where-Object { $_ -ne 'tests\demo-seed.test.js' })
node --test @safeTestFiles

# Explicit read-only database subset; no settings/account write integration enabled
$env:REPORTS_DB_TEST = '1'
node --test tests/reports.test.js tests/academic-outcomes.test.js tests/analytics-failed.test.js tests/analytics-progress.test.js tests/student-directory.test.js tests/analytics-student-search.test.js tests/reports-student-search.test.js
```

The four demo failures are the same pre-existing audit failures: missing seed/seed_all.js; planned Result count 92 vs expected 102; refusal to fabricate marks for a protected real identity; ledger count 8 vs expected 9. The demo/reset operation was never run. These failures are not hidden by claiming the repository fully green and were not repaired by changing real data or seed plans.

Optional persisted demo/Progress, account-verification database and settings-write/rollback integration cases remain unexecuted. Seven optional read-only cases skipped in the broad run were separately activated in the successful DB subset. EJS rendering and VM client tests ran; an interactive visual/browser audit did not.

Logs, test manifest, before/after database digests, FK/index/engine checks and the pre-task Git diff are in `C:\Users\Ravi\AppData\Local\Temp\sraas-full-remediation`.

## 10. Remaining risks and verification limits

| Severity | Remaining issue | Current boundary / next requirement |
|---|---|---|
| CRITICAL | None reproduced in the remediated inspected runtime paths | Not a claim about arbitrary privileged SQL or unknown external code. |
| HIGH — evidence-dependent H5/H8 | Missing authoritative examination/attempt/document facts cannot prove an actual sitting | Available contradictions block; missing facts require explicit verification. Fully automatic assurance needs authoritative source data or an institutional missing-document policy. No rule was invented. |
| MEDIUM | Initial curriculum truth: plausible but wrong credits/required selections | No external authoritative catalogue is encoded. Explicit roster review remains necessary; subsequent historical repurposing is blocked. |
| MEDIUM | Duplicate/ambiguous batch business names / legacy name-based lookup | No business-name unique migration introduced. ID-based current UI selection remains preferred; ambiguity deserves a separate targeted fix. |
| MEDIUM | Programme duration/year plausibility and wider semester limits | Existing numeric policies retained; no new MCA-specific rule guessed. Some configuration may be syntactically valid but institutionally implausible. |
| MEDIUM | Soft-deletion/inactive inclusion differs across reports/raw Analytics | Established reporting policy retained. Rows preserved; inactive is not assumed to mean backlog/revaluation ineligibility. |
| MEDIUM | Uniform current-account role/CSRF policy outside approval | Existing auth architecture remains; final approval is hardened. Review tokens are not a whole-application authorization redesign. |
| MEDIUM | Legacy event/document provenance without hash, accessible file or explicit reference | Exact duplicate cannot always be established; comparing only marks would wrongly prohibit legitimate later events. New events record hashes/references. |
| MEDIUM | PDF header/type validation does not certify document authenticity or all OCR content | Extraction/review/strict final validation help; semantic source verification remains necessary. No full corrupted/scanned real-document corpus was approved. |
| MEDIUM / operational | Explicit development reset / privileged SQL | Can bypass application history protections; guarded CLI remains outside ordinary administration and was not executed. |
| MEDIUM / recoverable draft | Unapproved draft file cleanup is not a database-transactional filesystem operation | Successful evidence is protected. A failed replacement can still require re-uploading an unapproved document. |
| Verification limitation | Live concurrent MySQL stress / throughput / real browser end-to-end | Not executed. InnoDB and locking implementation inspected; deterministic isolated interleavings executed. Coarse batch serialization can require retry under contention. |
| LOW / intentional | Descriptive names remain mutable; strict OCR conflicts may require re-extraction | Stable identity/marks protected; harmless label corrections retained. No immutable label archive or conflict-resolution redesign introduced. |

No destructive migration, unsafe historical normalization, major syllabus redesign, GPA-policy change or historical exam-type conversion was needed. The policy-dependent missing-evidence portion is reported rather than guessed, consistent with the requested stop conditions.

## 11. Required invariants and final ratings

| Invariant | Result / evidence |
|---|---|
| 1. Original imported Result/SR not silently overwritten | E: generic mutation rejection, separate event approval, parent/child snapshot tests; live rows unchanged. |
| 2. USN/batch cannot relabel history | E: Batch 1 HTTP/restore/concurrency regressions retained. |
| 3. REGULAR full applicable semester, Attempt 1 | E: required-roster/type/history/duplicate tests. |
| 4. BACKLOG eligible course, original semester, new period, sequential attempts | E: subject history/scope/period/sequence/concurrent tests. H5 actual absent-source period remains verification-dependent. |
| 5. BACKLOG SGPA null | E: successful retake and injected SGPA tests. |
| 6. Revaluation targets existing exact attempt and never creates Result/SR | E: ownership/context and wrong-target probes, separate approval. H8 missing source sitting remains verification-dependent. |
| 7. Approved+effective only; maximum one per SR in current approval path | E: overlay tests and serialized approval fixtures; C: Result/SR locks and transactional demote/insert. N: live stress/global raw SQL. |
| 8. New syllabus cannot reinterpret old batch/backlog | E: independent course IDs and old-course backlog snapshot. |
| 9. Historical configuration cannot silently change academic identity/marks | E: batch/session/course/roster guards; descriptive names intentionally editable. Initial institutional truth is not auto-certified. |
| 10. Critical rules rechecked at final commit | E/C: fresh state, source/context, tokens, snapshot, scope/eligibility/history/marks/duplicates and locks. |

| Area | Rating |
|---|---|
| ACADEMIC MANAGEMENT | PARTIALLY SAFE |
| REGULAR RESULT | PARTIALLY SAFE |
| BACKLOG RESULT | PARTIALLY SAFE |
| REVALUATION RESULT | PARTIALLY SAFE |
| OVERALL ADMINISTRATOR ERROR PROTECTION | PARTIALLY SAFE |

These ratings recognize substantial server-side protection without claiming unavailable facts are verified or unresolved MEDIUM/operational issues disappear. The old critical direct-write and conflicting-USN paths are closed; the document-evidence limits remain explicit.

## 12. Git status

Pre-existing exam-type/session/Batch 1 work was retained. No commit or push. No tokens.css, package/dependency or migration change. The exact final working-tree status is appended below; it includes earlier work as well as this remediation.
```text
 M controllers/academicCoursesController.js
 M controllers/batchController.js
 M controllers/resultController.js
 M controllers/revaluationController.js
 M controllers/sessionController.js
 M controllers/studentController.js
 M controllers/subjectController.js
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
 M services/academicCourseService.js
 M services/academicPolicy.js
 M services/documentExtractor.js
 M services/reportsService.js
 M services/resultHistoryService.js
 M services/revaluationExtractor.js
 M services/revaluationPersistence.js
 M services/revaluationValidator.js
 M services/settingsService.js
 M services/vlmExtractor.js
 M tests/academic-form-edits.test.js
 M tests/academic-outcomes.test.js
 M tests/hybrid-extraction-stages.test.js
 M tests/pdf-extraction-completeness.test.js
 M tests/reports.test.js
 M tests/result-history.test.js
 M tests/result-persistence.test.js
 M tests/result-preview-cgpa.test.js
 M tests/result-student-registration.test.js
 M tests/revaluation-duplicate-validation.test.js
 M tests/sparse-table-ocr.test.js
 M tests/student-directory-client.test.js
 M tests/student-validation.test.js
 M tests/subjects-roster.test.js
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
 M views/revaluation/review.ejs
 M views/students/index.ejs
?? docs/administrator-integrity-remediation-report.md
?? docs/backlog-session-safety-report.md
?? docs/exam-type-simplification-report.md
?? docs/historical-record-protection-report.md
?? services/academicConfiguration.js
?? services/academicIntegrity.js
?? services/revaluationIntegrity.js
?? tests/academic-configuration-integrity.test.js
?? tests/exam-types.test.js
?? tests/historical-record-protection.test.js
?? tests/revaluation-integrity.test.js
?? tests/session-identity-safety.test.js
?? views/analytics/partials/
?? views/results/partials/import-scope.ejs
```

Final verification: 54 tracked files modified; 14 untracked entries (including pre-existing work). `git diff --check` exited 0; only existing LF/CRLF conversion notices were emitted. No commit or push.
