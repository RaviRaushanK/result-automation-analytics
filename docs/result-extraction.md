# Extraction and Upload Workflows

Reviewed on 17 October 2026. This is the current workflow reference, not a
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
