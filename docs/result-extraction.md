# Extraction and Upload Workflows

Base workflow reviewed on 17 October 2026; manual revaluation review updated
on 26 October 2026. This is the current workflow reference, not a
guarantee of OCR accuracy or a report that every external model is always available.

## Supported Input

| Workflow | Accepted formats | Maximum size |
| --- | --- | --- |
| Original result card | PDF, PNG, JPG, JPEG | 15 MB |
| Revaluation card | PDF, PNG, JPG, JPEG | 15 MB |
| Student spreadsheet import | CSV, XLS, XLSX | 10 MB |
| Institution logo | PNG, JPEG, WebP | 2 MB |

Limits are defined in `config/uploadLimits.js`. Marks-card middleware verifies
extension/MIME and content: PDFs need a PDF signature; images must decode as
PNG/JPEG, be single-frame and stay within 40 million pixels. Logo validation is
a separate Settings flow with its own stricter decoding/re-encoding limits.

Internal renderer support for WebP/TIFF does not enable those formats in result
or revaluation upload routes. Legacy `MAX_UPLOAD_SIZE`, `UPLOAD_PATH` and
`OCR_PROVIDER` example values do not override the current middleware.

## Extraction Order

### Administrator corrections to OCR identity

Regular and Backlog Review & Edit, and Revaluation Review & Validate, allow USN
and Student Name corrections. Selecting Validate explicitly confirms the corrected
fields against the original card; no extra identity-confirmation step is needed.
Both fields must match the registered student. Original imports additionally
check the selected batch; Revaluation retains its exact existing student/result/
attempt target and cannot redirect an original result to another student.

`services/reviewIdentity.js` creates a manual correction in the processing JSON,
bound to the original identity evidence, raw-text hash, document reference where
available, registered target, actor and time. Original OCR claims are not replaced.
The UI uses MANUALLY CORRECTED rather than automatic MATCH. Only the corresponding
single-document OCR/AI identity disagreement is resolved; multiple-student page
conflicts, marks/subject conflicts, semester/period contradictions and roster rules
remain blocked. Missing-field acknowledgments retain their existing behavior when
no explicit identity correction is submitted.

Source tokens reject stale correction forms. Final import/approval rechecks the
registered identity and source binding, including a frozen correction digest at
revaluation approval. Re-extraction clears a previous manual correction. Editing
the form or opening Review/Preview never updates student records or original
academic records. Draft correction persistence happens only through Validate.

Original-result drafts retain each extracted subject's printed PASS/FAIL as
document evidence. A printed FAIL is not promoted to PASS merely because its
component total reaches 50: Review, Validate, Preview and final import preserve
FAIL with grade F and zero grade points. A printed PASS with marks below the
configured total pass band blocks validation for review. This does not invent
an external-component pass threshold from that evidence or alter historical records. The browser
cannot supply or override authoritative document-result evidence.

For older drafts that omitted this evidence, Review can recover it from their
own saved OCR text only when subject code and both marks identify a unique row
and the parsed student identity does not contradict the draft. This read-time
recovery does not rewrite uploaded files or saved academic results. Unknown or
ambiguous evidence is not guessed. Subjects without usable printed-result
evidence use the shared MCA component passing requirements described below.

Complete embedded PDF subject tables take precedence over earlier OCR/AI result
letters when identity, subject code and both marks match. Code-like fragments
before an explicit subject-table header are not course rows; missing/ambiguous
actual table rows still prevent the native-text fast path. A printed result must
appear after the component marks and total, not merely as a letter in a name.
For malformed PDF text-layer identities, a local visual OCR rereading must verify
the same USN and corroborating name. The existing same-length I/1 and O/0 OCR
comparison is allowed; extra-character truncation and approximate USN matching
are not. A different valid native USN cannot be overridden. No external AI call
is made for this evidence recovery.
Successful evidence is cached in bounded process memory by document-content hash,
student identity and subject scope; changing any key invalidates reuse. Cached
evidence never replaces final validation or writes to academic tables.

Existing draft corrections are read-only on Review/Preview and require Validate
again before import. Validate retains the recovered result's PDF-text provenance;
final save rechecks the document evidence. Genuine printed FAIL results remain
FAIL/F/zero points. No saved academic outcomes are backfilled. Review & Edit
shows maximum-mark hints without displaying pass-minimum numbers; the server
and browser passing checks are unchanged.

### MCA component requirements (24 October 2026)

The authoritative source for this implementation is the MCA 2022 regulations,
not the engineering circular. Theory/lab courses require 50% CIE, 40% SEE and 50%
aggregate. Project SEE requires 50%; CIE eligibility remains 50% where CIE exists.
For 50+50 theory/lab courses, pass minima are 25/20/50. Failing a component gives
F and zero points regardless of total. Review, validation, Preview and final save
share these checks for Regular/Backlog, and revaluation repeats them at approval.
Old validated drafts require validation again; no academic backfill is performed.
Result Preview compares the saved validation status, configuration/rule snapshot
and review token with current validation prerequisites. Stale or unvalidated
drafts show an informational current-rules notice, use a "Preview - Validate
again" heading and disable Confirm & Save. Display calculations remain read-only:
opening Preview does not refresh validation, change timestamps or persist marks,
SGPA or CGPA. Return to Review & Edit and select Validate to refresh the draft;
final confirmation independently rechecks stale-validation protection.
Unchanged original/revised stored outcomes are used for historical outcome display.
The existing GPA aggregation rules and grade bands are preserved; the document's
separate project reference to grade E does not add an unsupported grade/point.

Result Review & Edit uses Bootstrap invalid-field feedback for missing student
details, invalid attempt numbers, whole-number component marks and total ceilings.
Only displayed missing-document acknowledgments and mixed-scope confirmations
are required. Checkbox feedback appears after a validation attempt and clears
when corrected. Backlog subjects may remain completely blank; attempted subjects
require both marks and at least one subject must be attempted. The frontend does
not impose an attempt maximum or override registration, mismatch, roster or
final-import checks on the server.

Mixed-semester cards remain separate uploads per academic semester/attempt. A
document identifying the selected semester alongside others displays a mixed-scope
notice, not an unconditional wrong-semester message. The administrator confirms
the included/excluded scope. When the document explicitly identifies the selected
semester, unconfigured rows can be intentionally excluded without inventing a
course or assigning those rows to another semester. Excluded rows never enter the
import payload. Required-course completeness and unambiguous included-course
membership remain enforced on the server, again at final import. A required or already
included selected-semester course cannot be treated as an unrelated exclusion.
Non-required same-semester courses outside the selected offerings may be excluded. When the
selected semester is absent, unknown exclusions cannot excuse a semester mismatch;
the existing verified other-semester scope path still supports separate backlog
uploads. Multiple other semesters are supported. Period contradictions remain
blocked; OCR identity corrections use the controlled Validate path described
above. No subject-code-specific exceptions are used.

### Review warning clarification (24 October 2026)

A hybrid-stage diagnostic reports an incomplete/unavailable OCR or vision stage;
it does not establish that the final extracted values are incorrect. Result Review
classifies known intermediate-stage messages as recovered information only when
all selected subjects have found-on-card evidence, high confidence, valid complete
component marks within configured limits, and no conflicts, excluded rows,
identity mismatches, missing identity fields, or other warnings. It rechecks the
current configured subject roster. Partial retakes additionally require recorded
source coverage; a legacy retake draft cannot assume complete coverage.

Recovered information appears under a collapsed **Extraction details** section,
not a yellow warning. Missing marks/subjects, conflicting readings, unknown
warnings, and unresolved failures stay prominent. Review still asks administrators
to compare subject rows and marks with the original card; identity MATCH does not
verify every mark. Validation and mismatch blocking remain unchanged.

New extraction drafts retain available stage/per-page diagnostics and source
coverage metadata in their existing JSON payload, preserved across review saves.
Existing drafts are classified at display time without rewriting their saved
evidence, and do not claim a particular failed page when none was recorded.
Canonical period keys remain unchanged; display labels use the shared formatter.

Verification: 106 focused extraction/review, conditional-verification,
examination-period, preview-GPA and revaluation-integrity tests passed (zero
failed/skipped). A read-only classification of upload 20 produced zero prominent
warnings and one recovered informational diagnostic for six subjects, without
stored per-page diagnostics or any academic writes.

Revaluation Review formats document examination periods with the shared formatter
(for example, `Dec 2025 / Jan 2026`). A printed old external PASS/FAIL status
remains internally `UNVERIFIED` when it cannot be compared with a separately
stored original component status. Review displays **Manual verification required**
when its acknowledgment is unchecked and **Manually confirmed** when checked,
including when reopening a saved review. The label updates immediately and is
announced accessibly; it never becomes **MATCH**. Only the required state's text
is highlighted in amber, with no background, border or icon. The confirmed state
uses the surrounding text color. Both support light and dark themes. The checkbox explicitly asks
the administrator to compare that field with the original marks card. Its selection
is persisted through **Validate**, not merely by checking it, and does not approve
the review. Final approval still rechecks the saved acknowledgment and original
target. This is distinct from missing
OCR data and from the stored overall subject outcome. Matching identity fields
require no acknowledgment; a mismatch cannot be overridden by a checkbox alone.
OCR identity corrections require edited USN/name matching the registered target
and the source-bound Validate action described above.

### Optional manual subjects (26 October 2026)

The revaluation table keeps the usual subject-code order. Extracted subjects
start in scope. Roster subjects not detected on the card remain optional rows,
default to Reject, and contribute no missing-subject warning or verification count.
Their Internal and revised External inputs are disabled until Accept is selected.
Internal starts from the selected original SubjectResult in the database.

Accepting a non-detected subject adds a manual-verification requirement: confirm
it appears on the uploaded card and verify the entered marks. The checkbox shows
Manual verification required until checked, then Manually confirmed; Validate
persists the acknowledgment. Reject removes the row from approval scope. Unknown
or cross-session extracted subjects still block under existing integrity rules.
Approval processes only accepted, validated targets for the exact original attempt.


Revaluation Review & Validate uses Bootstrap client-side validation feedback.
Only displayed document-verification acknowledgments are required. Accepted rows
require whole-number internal/revised external marks within their configured
component and total ceilings, plus an ambiguous-subject pick or exceptional-status
acknowledgment where those controls are present. Rejected rows do not require
marks or those row-specific confirmations. Valid mark inputs do not display green
validation ticks; Bootstrap alerts/feedback appear for failed input rules. Invalid
submission shows field feedback,
opens a collapsed invalid subject selector when necessary and focuses the first
invalid control. Corrections clear the feedback. Browser validation does not
replace server validation, final approval checks or mismatch blocking, and does
not save data until a valid form is submitted through the existing workflow.

Revaluation approval compares saved/current original-target snapshots using a
key-order-independent digest. MySQL may reorder JSON object keys during storage;
that alone must not trigger a stale-review error after Validate. The comparison
still preserves field values/types and array order, and rejects real changes to
the original student, attempt, marks or subject configuration. Review/source-token
checks remain unchanged. Existing snapshots need no data migration.

The revaluation completion page shows saved subject changes with original/revised
marks, status changes, revised grade and whether the change is currently applied.
Technical record IDs are available under collapsed **Audit references**.
Each subject heading is followed by separately labelled **Revaluation record ID**
and **Original result record ID** lines. A note explains that these references
identify saved records and are not marks. The import reference is labelled
**Import record ID**.
Subject labels come only from each event's linked SubjectResult/Subject and show
the code and name when available. Missing relations show **Subject name unavailable**
with the original audit identifiers; labels are never borrowed from nearby rows.
Raw fingerprints and JSON remarks are not rendered; their stored audit data is
preserved. This is a presentation change only, with no outcome/GPA calculation
or persistence changes.

### Processing stages

1. **Embedded PDF text:** `documentExtractor` reads text and word coordinates,
   keeping PDF pages separate. A complete, consistent table can be used directly.
   Full REGULAR result uploads supply expected session subject codes; retake and
   revaluation cards may legitimately contain only a subset.
2. **Hybrid when configured:** unless `EXTRACTION_MODE=tesseract`, a configured
   Groq key enables `vlmExtractor`. The document is rendered to page images.
   Tesseract and vision run for each page; a text LLM reconciles those signals.
3. **Local path:** without AI configuration, or when dispatch fails, the shared
   extractor uses native PDF text/local Tesseract. Scanned PDFs are rasterized
   before OCR rather than passed directly to `sharp` as PDFs.
4. **Missing-row recovery:** if there is no usable exact-roster-matched row,
   sparse OCR requests nested word coordinates. If still necessary, focused
   row crops retry at most six detected anchors per page.

`VLM_MAX_PAGES` defaults to three for rasterized PDF paths, including local
scanned-PDF recovery; `VLM_RENDER_SCALE` defaults to two. Embedded text extraction
is a separate path. Verify long documents explicitly rather than assuming every
page was processed.

Sparse recovery is not a general merge of every partially missing table.
An already usable extraction is retained. A failed or incomplete retry preserves
the first extraction, and conflicting USNs prevent combining student identities.
Known course-code candidates are compared exactly; codes are not fuzzy-remapped.

## Hybrid Integrity and Diagnostics

The vision schema includes normal internal/external/total/result fields and all
independent revaluation cells: internal, old marks/result, RV marks/result and
final marks/result. The printed revaluation final external mark is not the
derived internal-plus-external total.

Reconciliation rejects malformed schemas. Empty, failed or incomplete LLM output
cannot silently discard complete vision rows, and omitted vision rows remain
available. Disagreements on marks/status produce review warnings and lower row
confidence. A conflicting reconciliation USN does not replace the vision
identity/marks with another student's payload.

Mark parsing accepts bounded integer values, including zero. It does not turn
`-5`, `1.5`, `20/50` or `abc20` into plausible different marks. High model
confidence alone cannot mark an incomplete row validated. Backend subject limits,
roster requirements and workflow validation still apply.

Hybrid payloads record `stages.ocr`, `stages.vision`, and `stages.llm`; recovered
payloads also record `stages.recovery`. Per-page statuses and overall
ok/partial/failed/empty states describe what ran. Revaluation retains these
diagnostics in its stored OCR envelope. They are not certificates of accuracy.

The provider retries rate-limit/transient server responses with bounded retries.
Provider/model outages, invalid credentials, timeouts and rendering failures can
still require local fallback or a new document. Do not assume all stages ran
merely because `extractionMethod` says `vlm-hybrid`; inspect the stage metadata.

## Original-Result Review and Import

~~~text
/results/upload
  -> extracted Review & Edit
  -> Validate
  -> validated Preview
  -> explicit Import
  -> persisted Success
~~~

The original document and editable marks are shown together. Configured component
maxima retain zero rather than falling back to 100. Neither extraction nor
validation alone inserts academic results.

Validate checks registered student/batch ownership, USN/name agreement, exact
attempt duplicates, previous original cards, subject scope and marks. Name
comparison uses NFKC, case and whitespace normalization, not partial-name matching.
The registered Student record is authoritative and is not renamed by OCR.

Registration/name/duplicate alerts are deferred until Validate. The admin can
correct the extracted identity. A rejected registration can disable validation
until the invalid identity is corrected. Preview and final import recheck the
relevant guards; direct URLs cannot bypass validation.

A first regular Semester N import requires saved original REGULAR cards with
subject rows for Semesters 1 through N-1 in the same batch, no later than the
selected exam period. A retake or later attempt also needs the same-semester
original before that sitting/attempt. Failed originals satisfy presence;
unapproved staging and empty headers do not. These checks do not by themselves
certify course completeness or cumulative GPA.

Final persistence is transactional and retains duplicate/history protections.
Stored SGPA/CGPA and their provenance follow
[Academic Result Semantics](academic-result-semantics.md).

## Revaluation Review and Approval

~~~text
/revaluation/start
  -> session -> student -> saved result attempt
  -> document upload/extraction
  -> /revaluation/review/:importId
  -> Validate
  -> approval confirmation
  -> explicit approval/rejection -> outcome
~~~

Successful extraction opens editable review directly. Legacy pending/extraction
URLs redirect or resume the canonical flow; pending remains useful for errors and
retry. The backend resolves the result/student and eligible SubjectResults from
saved context, not submitted identity IDs.

Preview includes OCR identity warnings. Cases requiring explicit identity
confirmation use the existing administrator-only confirmation route; this differs
from the original-result exact registered-name gate. Duplicate revaluation checks
run when validating and again under the result lock at approval.

Accepted decisions create ledger events with reviewer/provenance; only approved
effective events affect Effective reports. Original marks, Result headers and
stored SGPA/CGPA are not overwritten. A celebration is shown only for the
successfully persisted outcome, not a pending/failed extraction.

## Stored Extraction and Recovery Notice

"Please verify the recovered subject marks against the original card before
validating." is an informational recovery notice. Manual comparison is still
required, especially for low-confidence or conflicting values.

Old imports keep their saved extraction. To apply a new extractor version use
**Replace document** or a fresh upload; refreshing the review page does not
automatically re-extract. Already saved results are not silently re-imported.

## Privacy, Storage and Tests

Hybrid extraction transmits document images and OCR/transcription text to the
configured external AI provider. Use `EXTRACTION_MODE=tesseract` for local-only
processing and approve sensitive-data transfers under the institution's policy.
Do not put real result cards or API keys in source control.

Upload folders contain tracked `.gitkeep` placeholders; uploaded contents are
ignored. Git ignore rules do not restrict HTTP access: the current application
mounts `/uploads` as static storage. Database and upload backups are separate
deployment responsibilities.

Focused tests include:

~~~powershell
node --test tests/marks-card-upload.test.js tests/pdf-extraction-completeness.test.js tests/sparse-table-ocr.test.js tests/hybrid-extraction-stages.test.js test/vlm-extraction.test.js
node --test tests/result-student-registration.test.js tests/result-history.test.js tests/result-persistence.test.js tests/revaluation-duplicate-validation.test.js
~~~

These suites use isolated fixtures/local OCR and mocked AI; they do not imply a
fresh live-provider test. Prior live verification used invented student cards
in all four formats for both result types. The affected real card was checked
with local-only OCR. No academic result was saved by those checks.
