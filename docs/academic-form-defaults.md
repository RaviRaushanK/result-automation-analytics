# Academic Form Defaults

## Batch and department selection

- Create Batch retains its editable Department dropdown and defaults to the active MCA department.
- Create Session, Subjects Management and Faculty Assignments select the latest cohort by start year, then end year, then batch ID, descending.
- Add Faculty defaults its editable Department dropdown to MCA.
- Edit Batch now uses Course Name and Batch Year, composing the same stored batch name as Create Batch. A trailing four-digit year is split automatically; older descriptive names are preserved in Course Name with the start year as the suggested Batch Year.
- Edit Batch Start Year and End Year also offer the existing accessible year picker and manual input.

## Faculty assignments

- Subject assignments support any number of distinct active faculty up to the available faculty pool; the existing many-to-many table needs no migration.
- The pencil action enters row editing. Faculty Count controls how many selectors appear; Review confirms that row only, and Cancel restores saved assignments. The header save action reviews all pending edited rows, not unrelated unassigned subjects.
- Drafts survive search and saving another row. Saved subject counts remain separate from pending changes. Team-Taught Subjects counts subjects with more than one assigned faculty.
- Assignment saves send `faculty_ids` arrays. The server retains legacy `faculty_1`/`faculty_2` support, rejects malformed/duplicate IDs and duplicate subject rows, validates active faculty and batch/session scope, and commits assignments transactionally.
- The removal dialog lists all assigned faculty and supports removing an individual member beyond the original first two, or removing the entire assignment.

## Upload Results

The Batch selector defaults to the same latest-cohort ordering as the other academic forms, including a latest batch with no configured sessions. Session selection remains explicit and offers only that batch's sessions. Changing or clearing batch clears the session/preview; late preview responses cannot overwrite a later selection. Upload submission verifies batch/session agreement before extraction or import writes. Existing clients omitting batch_id remain compatible.

## Sessions

- Month identifies the examination month; it is not a semester starting month.
- Semester choices use `(end_year - start_year) * 2`. A two-year batch offers four semesters; a four-year batch offers eight.
- The server enforces the same range on creation and semester changes. An unchanged legacy semester remains editable for examination month/year; existing configured-course protections remain intact.
- Status is a calendar-derived display, not a stored academic completion decision: past examination months are Completed, the current month is Active, and future months are Upcoming. The preview, confirmation, list and details share this rule. No manual status or schema field was introduced.
- Both session forms offer a year picker and manual year input.
- Edit Session checks configured subjects before enabling semester changes. Configured sessions keep semester locked while month/year corrections remain available. The server restriction still applies to direct API requests.
- The summary shows a current-month session when available, otherwise the latest past session (Latest Session), otherwise the nearest future session (Next Session). It shows No sessions only when no valid examination period exists.

## Subject editing

Updates retain the stable academic course ID instead of creating or resolving a replacement course. Explicit definition edits apply transactionally to that course and its linked examination offerings, with a scope notice in confirmation. Subject code/name corrections and unchanged saves are allowed with existing results. Credits, type and marking-limit changes require no existing course results; these changes also clear roster review. Duplicate course/offering codes and cross-batch/semester links remain protected. Existing marks, grades and result snapshots are not rewritten. Zero-credit/zero-internal and project subjects retain their values in the edit form.

## Faculty email

Email has been removed from Add Faculty and its confirmation summary. Existing faculty email values are retained. The optional email API remains backward-compatible and validates email when an older client supplies it; the current form does not collect or send email.

The legacy email validator uses the bundled IANA top-level-domain snapshot in `public/js/email-tlds.js`, sourced from https://data.iana.org/TLD/tlds-alpha-by-domain.txt. Invalid endings such as `.clh` are rejected without runtime network requests. Refresh this snapshot when newly delegated domains need support; a registered suffix alone does not prove the domain or mailbox can receive mail.

## Verification

- Unit/controller coverage: `tests/academic-form-defaults.test.js`, `tests/academic-form-edits.test.js`, `tests/faculty-assignment-count.test.js`, `tests/batch-create-form.test.js`, and `tests/academic-outcomes.test.js`.
- Browser checks in `tests/reports-browser.js` cover defaults, four/eight semester options, live status, required semester validation, department selection, invalid domain rejection, edit confirmations and mobile/light/dark modal layouts. Save-flow checks use isolated in-memory fixtures, not academic database writes.
- Full suite: 188 tests, 182 passed, two skipped and four existing demo-seed failures. These failures concern the missing legacy seed entry point and protected seed/result/ledger expectations; they are unrelated to the form changes.
