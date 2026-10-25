# Report and Analytics presentation

Presentation changes do not change academic passing rules, stored GPA or historical data. Report projections now share the [Original/Effective contract](report-mode-semantics.md); ranking and completion classification policies remain unchanged.

## Reports

Report screens and print/PDF keep scope, Result View and Generated at, with at
most two short basis notes. Full provenance explanations remain in CSV/API
context. Programme/institution branding remains separate from repeated context.

| Report | Meaning retained |
| --- | --- |
| Student | Subject outcomes grouped by recorded semester, sitting and attempt. Effective IA/EX use explicit revisions or original fallbacks, with consistent unavailable markers. |
| Class | Result-attempt rows, with distinct-student and result-row counts distinguished. |
| Subject | Subject-result attempts, not distinct students. Uses the same Original/Effective subject outcome as Student and Consolidated. |
| Revaluation | Event ledger, including pending/rejected and approved non-effective events. Only approved effective events affect current outcomes. |
| Toppers | Existing eligibility and stored original CGPA ranking/tie order. Multiple result attempts can belong to one student. |
| Consolidated | Numeric EX/IA/T cells. Approved revised components may use original fallbacks only when they reconcile with the approved total. Otherwise components remain unavailable; no component is inferred. |
| Result Analysis | Exact result-attempt participation and subject-result counts; existing historical exam-type compatibility is unchanged. |
| Student Progress | Verified completion and cumulative-history availability. Its existing notes remain distinct from stored-header GPA guidance. |

Stored original SGPA/CGPA are unchanged by revaluation. Displaying historical GPA does not certify cumulative course history. Missing values remain unavailable and valid zero values remain zero.

## Analytics

Overview, Students and Toppers qualify GPA as stored values. Subject Analysis counts subject-result attempts; Semester Analysis counts result attempts, not distinct students. Failed Students remains a recorded subject-failure view. Revaluation Analysis retains separate raw event-pipeline and approved-effective outcome semantics.

Progress keeps the internal `unknown` category and exposes it as **Not determined**. It never means PASS, FAIL or confirmed uncleared work. Completion cannot be determined from the available verified academic history. Missing results, unverified rosters and ambiguous histories can contribute to this category.

The batch-wide completion summary and semester trends have different populations: each trend bar includes recorded participants for that semester through the selected scope. The clearance-rate denominator continues to exclude undetermined completion and students without verified backlog. **Calculation details** shows eligibility and counts; **Chart data** retains accessible category counts and a readable chart fallback.

Progress uses green (cleared without backlog), teal (cleared through retake), red (uncleared), and purple (not determined). Missing-grade chart labels read **Grade unavailable**; backend grade categories are unchanged. Disclosure controls use existing theme text tokens and keyboard focus styling.

## Historical verification (25 October 2026)

- Focused reports, Progress, Analytics, revaluation and GPA: 203 passed, 0 failed, 7 skipped; exit 0.
- Read-only MySQL report/Progress fixtures: 44 passed, 0 failed, 0 skipped; exit 0. Queries are restricted to SELECT fixtures.
- Complete tests/test suite: 802 passed, 5 failed, 13 skipped; exit 1 (820 tests). Existing failures remain the uppercase batch-name expectation and four demo-seed tests; no changes were made to those implementations.
- JavaScript syntax checks and EJS compilation passed; diff whitespace check passed.
- Desktop/mobile browser visual inspection in both themes remains unverified: no browser integration was exposed, and earlier native browser control was blocked. Theme-token and disclosure-accessibility checks are automated, not visual confirmation.

That wording change did not alter academic records, GPA, schema, API metric keys or calculation/classification rules. Working-tree notes in dated reports describe those earlier runs, not the current checkout. Current report semantics are defined in [the report audit](report-mode-semantics.md).

## Revaluation detail presentation

The applied-change table groups subject name/code and student name/USN, then shows original total, effective total, signed mark change and result change. **View references** opens an **Audit references** popup with revaluation/import record IDs, approval status, recognized review metadata and the source document filename. It explains that these IDs identify saved records, not marks. Stored JSON, fingerprints and local directory paths are not displayed as administrator-facing remarks. Plain-text remarks remain readable text; malformed structured metadata gets an explicit unavailable message. Stored audit payloads and API responses remain unchanged.

The seven-column layout preserves search and numeric sorting, keeps names/statuses from breaking mid-word, and uses existing theme colors. Printed USN cells use no-wrap styling so the identifier stays together. Popup/report/integrity tests: 62 passed, 0 failed, 1 skipped (exit 0); JavaScript syntax, three EJS compilations and whitespace checks passed. Popup rendering remains browser-unverified; regression tests exercise the button, target dialog, record-specific content replacement and close-control markup.

The outcome summary uses **Applied revaluations**, **Student subject results affected**, and **Results with increased/unchanged/decreased marks**. Average/maximum/minimum changes are mark differences, not result counts. Existing API keys, numbers and formulas are unchanged. The system-wide integrity counts are under **System-wide integrity checks**, explicitly distinguished from filtered outcomes. Focused label/presentation tests: 13 passed, 0 failed, 0 skipped (exit 0); syntax, EJS compilation and diff checks passed.

## Screen table and session GPA comparison

The on-screen revaluation report keeps identifiers on one line and reserves readable widths for student/subject names. The wide table scrolls horizontally instead of squeezing identifiers or splitting names mid-word. Print USN protection remains in place.

Semester Analysis displays stored SGPA/CGPA averages as separate bars per exam session, with result-attempt counts in category labels. Different session populations are not connected as an individual student's progression. Missing/invalid chart GPA values are unplotted, valid zero stays zero, and an available stored backlog CGPA is still shown. No stored values, averages, denominators or GPA policies change. A read-only database check confirmed the single backlog result has NULL SGPA and stored CGPA 0.89; the dash is a missing-value display, not a stored SGPA symbol.

Relevant report/Analytics/Progress/revaluation/GPA suite: 212 passed, 0 failed, 7 skipped (exit 0). Regression fixtures cover missing/invalid/zero GPA, preserved backlog CGPA, separate session bars, unchanged input data, readable report identifiers and existing print/GPA output.

The chart orientation changes were reverted at the user's request. Both charts retain their earlier vertical-bar presentations. The GPA explanation is collapsed behind the native arrow beside **About these averages**. The revaluation outcome summary's explicit text styling remains. Chart axis and legend text now follows the light/dark theme and refreshes on theme changes, without altering graph layout or values. Focused chart-text/GPA checks: 16 passed, 0 failed, 0 skipped (exit 0); syntax and diff checks passed.


## Short report notes (26 October 2026)

Every formal report uses at most two short notes on screen and print/PDF. Notes start with familiar labels (Marks, Results, Ranking, Counts or Completion), explain the selected view, and avoid repository terminology. Student, Subject and Consolidated explain unavailable marks and separate backlog attempts; GPA guidance appears only where relevant. Class explains selected attempt results; Toppers explains saved CGPA ranking; Analysis explains attempt counts; Revaluation explains approval and active revisions; Progress explains history and missing verified data. Original Progress notes do not imply revaluation was included.

Analytics notes use the same plain language. Saved overall results are distinguished from subject results, past failures remain separate from later backlog clearance, and session GPA comparisons retain their limitations. Detailed provenance remains available in exports and calculation details. No calculations or academic records changed.

Wording verification: 500 tests, 498 passed, 0 failed, 2 opt-in tests skipped; exit 0. JavaScript syntax: 23 passed; EJS compilation: 74 passed; diff check passed (exit 0).
