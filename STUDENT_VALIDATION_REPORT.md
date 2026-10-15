# Student Validation Correction Report

Date: 2026-10-04

## Issues Found

- Students notifications fell back to the browser's `alert()` because the page had no notification container. This produced the popup headed with localhost.
- The previous email expression accepted malformed addresses, including repeated dots, invalid domain characters, and one-character domain endings.
- The Student model had no email validation, so it provided no additional protection for application writes outside the controller.
- Save handlers returned Sequelize's top-level message, which can be just "Validation error", instead of explaining the affected field.
- General email syntax allowed usernames that Gmail does not permit and did not flag common misspellings of gmail.com.

## Corrections

- Added a dedicated accessible notification area to the Students page. Success and failure messages now appear in the page rather than a browser popup. Warnings remain visible until dismissed.
- Added one shared email validator used by the manual add/edit form, server controller, and Student model.
- Reject empty emails, multiple @ signs, spaces, repeated dots in the local part, and leading/trailing local-part dots. Require the exact domain gmail.com (case-insensitive) as requested by the administrator.
- Enforce the database field's 100-character email limit, the 64-character local-part limit, and 63-character domain-label limit.
- Preserve valid Gmail addresses and +tag aliases, such as student.name+admissions@gmail.com.
- Continue trimming surrounding whitespace before validating and saving through the Students APIs.
- Block invalid email addresses during both student creation and editing before any database write.
- Validate each imported row during preview and again before saving. A client-supplied valid flag cannot bypass email checks. Invalid rows are skipped and their reasons appear in the import results; valid rows can still be imported.
- Reopen the add/edit form with its entered values and an inline error when the server rejects a save.
- Show a warning notification when an import skips records.
- Return a specific reason for each email mistake (missing @, consecutive dots, invalid domain, excessive length, or invalid Gmail username).
- Reject every domain other than gmail.com, including gmdslal.com, gmial.com, googlemail.com, institutional domains and Gmail-looking subdomains. Show: "Only @gmail.com email addresses are allowed. Example: example@gmail.com." Do not silently rewrite the entered address.
- Check Gmail base usernames for letters, numbers and dots, while preserving +tag aliases. Source: [Google Gmail username guidelines](https://support.google.com/mail/answer/9211434).
- Translate Sequelize validation, uniqueness, and missing-batch errors into readable messages for manual saves and affected import rows.
- Include deleted student records in duplicate checks, because their unique USN/email keys remain occupied in the database.
- Check category length before saving and describe USN/name requirements in validation errors.
- Version the Students script URLs so reloaded pages use the updated validation scripts.
- Revalidate emails in the browser import preview and recompute valid/invalid counts before enabling import confirmation. Even a stale API response marking sakldfklaf@gmdslal.com as valid is displayed as invalid and cannot enable confirmation by itself.

## Verification

Command: `node --test tests/student-validation.test.js`

Result: 22 tests passed, 0 failed.

Coverage includes shared validation in Node and browser execution contexts, rejected create/update attempts with no writes, accepted valid addresses, trimming, CSV/XLSX/XLS preview, final import revalidation, and Sequelize model validation. Controller database operations are mocked; model tests require no database connection and do not insert student records.

Additional coverage checks Gmail mistakes through all save paths, specific email messages, readable Sequelize field and uniqueness errors for both create/update, duplicate checks involving deleted records, and readable import-row save failures.

The Students JavaScript syntax check and EJS render check passed. The render check verifies the notification area and that the shared validator loads before the Students script. The updated server on port 3001 returned a successful health response and served the validator with HTTP 200.

## Scope and Limits

Email validation checks address format, not whether a mailbox exists or belongs to a student. Mailbox ownership requires an email verification flow. Existing database records have not been changed or deleted. No database schema migration was applied; model validation protects ordinary Sequelize creates and updates. Raw SQL and bulk writes that explicitly bypass model validation are outside these checks.

An authenticated browser walkthrough was not performed. Automated checks verify controller behavior and template rendering, but do not verify visual presentation or modal transitions in a real browser.

Updated app: http://localhost:3001/students

## Students Page Updates

- Replaced the displayed Student ID column with SL No., numbered consecutively from 1 for each displayed list. Internal student IDs remain in edit/delete actions.
- Sort student records by USN in ascending order.
- Removed the Batch filter's All option and default to the latest batch, ordered by start year, end year, then batch ID, descending. Reset restores this batch.
- Removed the PGCET Students and MGT Students cards. The four summary cards now show Total Students, Active Students, Inactive Students and Categories for the selected batch.
- Categories counts the unique student categories in the selected batch. No existing records are modified.
- Covered default batch selection, USN ordering, batch-specific counts, an empty batch list and rendered labels with focused checks.
