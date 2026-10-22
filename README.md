# Student Result Automation and Analytics System (SRAAS)

Public pages and account workflows updated on 22 October 2026. Academic feature
documentation was last reviewed on 17 October 2026.

An Express, EJS, Sequelize and MySQL application for managing MCA students and
academic sessions, importing result/revaluation cards, exploring academic
outcomes, and generating reports.

## Requirements

- Node.js 24, the runtime used for local verification. Node 18 is not sufficient
  for the currently installed PDF dependency set.
- npm and MySQL 8.0+, running before setup.
- A modern browser. The optional browser harness uses installed Microsoft Edge.
- OCR runs through `tesseract.js`; a separate Tesseract CLI is not required.
  Image processing and scanned-PDF rendering use `sharp`, `pdfjs-dist`, and
  `@napi-rs/canvas`. English OCR language data may download on first use.
- Groq access is optional. Local-only extraction does not require an AI API key.

## Setup

Run from the repository root in Windows PowerShell:

~~~powershell
npm.cmd install
Copy-Item config/.env.example config/.env
# Configure the database and a strong SESSION_SECRET before continuing.
npm.cmd run setup
npm.cmd start
~~~

Do not overwrite an existing `config/.env`. On macOS/Linux use `npm` and
`cp config/.env.example config/.env` for a new configuration.

`setup` creates the database if missing, applies migrations, and runs the
initialization scripts. The database user needs the corresponding permissions.
For an existing installation, back up the database and apply pending migrations
with `npm.cmd run migrate`; do not run a demo reset to upgrade it.

The default URL is **http://localhost:3000**. The application uses `APP_PORT`,
not `PORT`. To use a different free port:

~~~powershell
$env:APP_PORT = '3005'
npm.cmd start
~~~

Fresh initialization creates the MCA department, initial settings, and the
development administrator `admin / admin123`. Change the password in
**Settings > Account Security** before storing real data. Initialization does
not reset an existing administrator's password. See [Initialization](init/README.md).

## Invitation-only registration

Invitations are emailed through the configured SMTP service when the
administrator selects **Create & email invitation**. Set `APP_BASE_URL` to the
application's reachable origin (for example `https://results.your-institution.edu`).
The default localhost URL is suitable only for testing on the server computer;
remote recipients cannot open it. The page reports email-delivery failures and
retains the generated link for private manual sharing. Mail-server acceptance
does not guarantee inbox placement; recipients should check spam as well.

For mobile OTPs compatible with a Twilio Verify trial, configure `SMS_PROVIDER=twilio-verify` and
`TWILIO_VERIFY_SERVICE_SID` with the existing Twilio Account SID and Auth Token.
Verify generates and checks mobile OTPs through its API; this mode does not use
`TWILIO_FROM`, a Messaging Service, or custom SMS bodies. Trial recipients must
be verified in Twilio. Email OTPs continue to use SMTP. No account upgrade is
required while eligible trial units remain.

An active administrator creates and emails a seven-day invitation from **Settings > My
Account > Invite a user**. After mail-server acceptance the form collapses under
**Invite another user**. Invitations grant the application's current administrator
role and access to this installation's shared institution data; this is not a
separate-institution signup flow. Creating another invitation for the same email
revokes the old invitation.

The recipient chooses a username, searches/selects a country calling code,
enters the national mobile number, and chooses a password of at least 12
characters (maximum 72 UTF-8 bytes). The server combines the calling code and
number into international format. Password fields have visibility controls.
The invited email is fixed. Separate OTPs go to that email and mobile number.
An active account is created atomically only after both codes are verified.
Passwords and locally generated codes are stored as bcrypt hashes. With Twilio
Verify, mobile codes are generated and checked by Twilio and the app stores the
verification identifier instead of a mobile-code hash. Verification timestamps are
recorded on the account. Existing accounts are preserved without being marked
verified retroactively. Contact changes in Settings also require an OTP sent
to the new contact; the former direct email-update bypass is disabled.

Configure real `SMTP_*` delivery for email. The alternative `SMS_PROVIDER=twilio` uses
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM` or
`TWILIO_MESSAGING_SERVICE_SID` in `config/.env`. See Twilio's
[Messages API](https://www.twilio.com/docs/messaging/api/message-resource).
This alternative sends custom SMS bodies and is not compatible with the current
Messaging trial's predefined-content restriction. For Verify mode, configure
`TWILIO_VERIFY_SERVICE_SID` instead of a sender number or Messaging Service.
Missing configuration or delivery errors block verification. Codes are never
printed as an SMS fallback. Credentials are not included in the example config.

For Gmail SMTP, `SMTP_USER` must be the sending Gmail account and `SMTP_PASS`
must be a current App Password created by that same account, with 2-Step
Verification enabled. A normal Google sign-in password does not work for this
configuration. See [Google's App Password instructions](https://support.google.com/accounts/answer/185833).
Update `config/.env` locally and restart the app. Gmail error
`535 / EAUTH` means the configured credentials were rejected. Failed delivery
invalidates the generated OTP and leaves the user on the forgot-password form.

Registration is bound to its browser session and expires after 30 minutes.
Codes expire after five minutes, with a 60-second resend cooldown, four sends
and five guesses per contact for the whole registration. Resending does not
reset the guess budget. Locally generated codes are replaced on resend; Twilio
Verify manages its own mobile-code lifecycle. An expired or locked
registration requires a fresh invitation. Administrators may create up to 20
invitations per hour. Invitations are single-use and their tokens are stored as
SHA-256 hashes. After activation, temporary registration details are cleared.

Run `node --test tests/registration.test.js` for isolated checks. The rollback-only
database verification is opt-in:

~~~powershell
$env:REGISTRATION_DB_TEST = '1'
node --test tests/registration.test.js
Remove-Item Env:REGISTRATION_DB_TEST
~~~

## Public pages and password recovery

The landing page uses an unboxed navigation header with right-aligned links,
a collapsible mobile menu, and a workspace preview. Login, registration,
Forgot Password and Reset Password use coordinated responsive layouts. Landing
and workspace footers show **MCA Department, SMVIT** with an automatic year.

Forgot Password starts at `/forgot-password`. After successful email delivery,
the same page displays the six-digit OTP field and a resend cooldown. Invalid
codes stay on that page. OTP verification is bound to the requesting session.
After a valid code, the user sets a new password on Reset Password and receives
the login form with a password-updated message. The password-reset minimum is
currently six characters; registration requires twelve. The old `/verify-otp`
URL redirects to `/forgot-password`.

Email format checks run in the browser and server without provider/address
allowlists. Server DNS checks reject confirmed nonexistent or non-mail domains;
temporary DNS failures defer to email delivery and mandatory OTP verification.
Format and DNS checks alone do not establish mailbox ownership. My Account
keeps existing contacts until their replacements pass verification and supports
the same country-code selection for mobile changes.

## Configuration

Database/session configuration loads `config/.env`; the application also loads
a root `.env` if present. Existing process environment values take precedence.
Avoid conflicting values across these locations.

| Variable | Purpose / Default |
| --- | --- |
| `DB_HOST`, `DB_PORT` | Local MySQL host and port; normally `localhost`, `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database credentials and database name |
| `SESSION_SECRET` | Strong private session-signing secret; do not use the fallback |
| `APP_PORT` | HTTP port; `3000` |
| `NODE_ENV` | Deployment environment; production enables secure session cookies |
| `GROQ_API_KEY` | Optional key enabling the hybrid extraction path |
| `GROQ_VLM_MODEL` | Configured vision model; default `qwen/qwen3.8-27b` |
| `GROQ_LLM_MODEL` | Reconciliation model; default `openai/gpt-oss-20b` |
| `GROQ_BASE_URL` | Default `https://api.groq.com/openai/v1` |
| `GROQ_TIMEOUT_MS` | Per-request timeout; `60000` |
| `EXTRACTION_MODE` | `auto` by default; `tesseract` disables external AI extraction |
| `VLM_MAX_PAGES` | Rasterized PDF page limit; `3` |
| `VLM_RENDER_SCALE` | PDF rasterization scale; `2` |

`vlm` currently follows the same configured-AI branch as `auto`: it does not
force every document through AI or disable fallback. Complete embedded PDF
tables can be accepted before AI in either mode.

Legacy example variables `UPLOAD_PATH`, `MAX_UPLOAD_SIZE`, `OCR_PROVIDER`,
and `DEBUG_MODE` do not control the current extraction/upload implementation.
Actual limits come from `config/uploadLimits.js`.

**Privacy:** hybrid extraction sends document images and OCR/transcription text
to the configured external provider. Use `EXTRACTION_MODE=tesseract` when records
must stay local. Provider availability, model support, pricing, and rate limits
are external constraints; the application does not guarantee free or unlimited use.

See [Configuration](config/README.md) for details.

## Main Modules

| Module | Current experience |
| --- | --- |
| Dashboard | Interactive pass/fail pie, subject and grade analysis, attention list, contextual report links |
| Academic Management | Batches, sessions, examination subjects, Semester Roster, faculty and multi-faculty assignments |
| Student Repository | One searchable/paginated Students page, add/edit, soft delete, restore and spreadsheet import |
| Result Management | Original-card upload, review, Validate, preview, import and logs |
| Revaluation | Session/student/attempt selection, upload, extracted review, Validate and approval |
| Analytics | Overview, Students, Toppers, Failed Students, Subjects, Semesters, Progress / Backlog Trends, Revaluation |
| Reports | Report center and eight report types with CSV and browser Print / Save as PDF |
| Settings | Account, security, browser appearance, institution/report branding, read-only academic policy and system information |

Latest-batch defaults are used in the relevant academic forms, student forms,
result upload and report filters. Session semester options derive from batch
duration. Calendar-derived session labels do not certify academic completion.
See [Academic Forms](docs/academic-form-defaults.md).

Student USNs and names are saved uppercase; email is saved lowercase.
Current student email validation permits Gmail addresses only and is shared
between browser/server paths. Student deletion preserves academic history via
soft deletion; supported re-add/import paths restore the same deleted student
in the original batch rather than duplicating its identity.
See [Students Search and Lookup](docs/students-search-lookup.md).

## Result and Revaluation Uploads

Both workflows accept **PDF, PNG, JPG and JPEG**, up to **15 MB** per document.
Image content must decode correctly, match its declared type, be single-frame,
and remain within the 40-megapixel decode limit. Unsupported formats are rejected
even if an internal renderer supports additional image types.

### Original Results

1. Select the batch/session and upload a marks card.
2. Review the extracted USN, student name, attempt and marks against the original.
3. Click **Validate**. Registration, name, duplicate-attempt, prior-result and
   academic/marks checks must pass.
4. Inspect the validated preview, then explicitly import.
5. Success feedback/celebration appears only after persistence succeeds.

Imports require an existing non-deleted student in the selected batch. Student
names must match after Unicode, case and whitespace normalization; partial or
fuzzy names are not accepted. Duplicate-result alerts are deferred to Validate,
not presented as a blocking alert immediately after extraction.

Semester 2 requires an original Semester 1 result; Semester 3 requires original
results for Semesters 1 and 2, and so on. Retakes/later attempts also require a
prior original result in their own semester. Failed original cards count as
uploaded history; drafts and empty result headers do not. Examination chronology
is checked. Preview/direct-save requests repeat the guards, including under the
final transaction. Missing history is not repaired by inventing marks or GPA.

Full REGULAR results require a verified required-course roster. Partial retakes
contain only the attempted subjects. Subject creation shows the roster-review
notice below **Create Subject**, with the existing timed dismissal.

### Revaluation

Start at `/revaluation/start`: select session, student and saved result attempt,
then upload. Successful extraction opens the editable review directly. Validate
must succeed before approval; extraction alone never writes academic results.
The selected result/student/subject scope is resolved by the server. Identity
warnings/confirmation, duplicate checks and final locked approval guards remain
part of this workflow. Existing pending/extraction/approval links are retained
where needed for recovery or compatibility.

The card's internal mark, old mark/result, RV mark/result, and final mark/result
are independent evidence. The printed final external mark is not silently
replaced with internal-plus-external total. Approval creates canonical ledger
events without overwriting original results or their stored GPA.

### Extraction Reliability

Complete embedded PDF text is preferred when it passes completeness checks.
Other documents use local OCR or the configured OCR + VLM + LLM hybrid pipeline.
Sparse coordinate OCR and bounded focused-row OCR retry when there is no usable
matched row. Existing usable rows are not automatically overwritten.

Malformed mark strings are rejected, omitted vision rows are retained when the
LLM loses them, and conflicting AI readings are flagged for review. Stored
hybrid stage diagnostics distinguish OCR, vision, reconciliation and recovery.
A recovery notice is informational, not proof that every value is correct.

Extraction is not guaranteed for every layout or image. Review uncertain rows;
use **Replace document** or a fresh upload to regenerate an older stored
extraction. A page refresh alone does not rerun it. Rasterized PDF paths honor
the configured page limit, so check longer cards for omitted pages.

See [Extraction and Upload Workflows](docs/result-extraction.md).

## Reports and Academic Meaning

`GET /reports` renders the report center; it does not redirect to a single report.

| Report | Page |
| --- | --- |
| Student Result | `/reports/student` |
| Class Result | `/reports/class` |
| Subject Result | `/reports/subject` |
| Consolidated Result | `/reports/consolidated` |
| Toppers | `/reports/toppers` |
| All Students Progress | `/reports/student-progress` |
| Result Analysis | `/reports/result-analysis` |
| Revaluation | `/reports/revaluation` |

For each report type, protected routes provide the page, JSON API
(`/reports/api/<type>`), CSV (`/reports/<type>/export.csv`) and print
(`/reports/<type>/print`). PDF output uses the browser's Print / Save as PDF;
native XLSX export is not implemented. Shared compact print headers apply across
reports; consolidated student names are left-aligned. Disable the browser's own
headers/footers in its print dialog when they are unwanted.

**Original** uses saved academic values. **Effective** overlays only approved
effective revaluation events, with the original as fallback. Pending/rejected
events never change outcomes. IA/EX remain original stored components; revised
totals are not reverse-engineered into external marks. Revaluation does not
recalculate stored Result SGPA/CGPA.

Stable course identity is batch + academic semester + exact normalized course
code. Course clearance uses verified cross-session history, not the highest
marks or approximate names. Unknown/missing evidence stays unavailable.
SGPA is credit-weighted, including failed credits; cumulative CGPA requires
verified course/grading history from Semester 1, not an average of SGPAs.
See [Academic Semantics](docs/academic-result-semantics.md) and
[Analytics and Reports](docs/analytics-reports-ux.md).

## Upload Folders and Git

GitHub retains these folders through tracked placeholders:

~~~text
uploads/
  branding/.gitkeep
  results/.gitkeep
  revaluation/.gitkeep
  temp/.gitkeep
~~~

`.gitignore` excludes their runtime contents, including uploaded PDFs/images and
nested files. Keep the placeholders when committing. The previously tracked
branding upload was removed from current tracking, not deleted locally; old
commits may still contain it. Do not commit student documents or database backups.

GitHub does not store uploaded content for deployment. Back up both the database
and upload storage separately. A cloned environment needs its own branding file
if database settings reference a local uploaded logo.

## Demo Data

**Only use a disposable local development/test database.** `npm run demo` is a
destructive reset, not an append-only import. It backs up then replaces academic
history, staging, course offerings/rosters and non-protected student rows.

~~~powershell
npm.cmd run demo
npm.cmd run demo:verify
~~~

The shortcut requires local `academic_result_analytics_db` and defaults
`NODE_ENV` to development only when absent. Advanced commands require explicit
environment and exact database confirmation. The three protected real student
profiles are retained, but the reset removes their existing result history and
does not generate demo results for them.

The current in-memory plan has 36 students, 92 results and eight revaluation
events. Earlier documentation's 102-result/nine-event plan is obsolete.
`seed/seed_all.js` is absent; do not use that old alias.
See [Demo Data and Safety](seed/README.md) before executing any reset.

## Verification

Run the complete test suite:

~~~powershell
node --test tests/*.test.js test/*.test.js
~~~

Optional database checks are opt-in using `REPORTS_DB_TEST=1` and
`DEMO_SEED_DB_TEST=1`. The Edge harness is `node tests/reports-browser.js`;
it writes screenshots/PDFs to an OS temporary directory. Some test modules load
database configuration even when integration checks are skipped.

Known baseline issues remain in `tests/demo-seed.test.js`: the missing legacy
entry point, old result/event counts, and an attempt to generate marks for a
protected real student. Do not interpret a focused suite pass as a green full
suite, or run a seed to make test expectations pass against real records.

Current verification notes are maintained in
[Implementation Status](docs/implementation-status.md).

## Access and Deployment Limits

- Reports, Analytics and the Students router enforce admin/faculty access.
  Required-course confirmation and Faculty management are administrator-only.
- The initial login-role schema is admin-only. Faculty records/assignments are
  separate from login accounts; there is no implemented student self-service.
- Settings changes use current-account checks, field allowlists and CSRF.
  These protections should not be assumed to cover every older write endpoint.
- Use a strong session secret, change development credentials, configure HTTPS,
  review proxy/cookie behavior, restrict database privileges, and establish backups.
- `/uploads` is currently mounted as static storage before authentication.
  Ignoring files in Git does not make the HTTP endpoint private. Review document
  access controls before deploying sensitive records.
- `/api/health` confirms HTTP health, not complete database/dependency readiness.
  Restart the application after backend code/environment changes.
- Current ignore rules protect `.env` but not every environment-file variant;
  manually check staged files for credentials. The npm lockfile is currently
  ignored; dependency reproducibility remains a repository-policy limitation.

## Documentation

- [Configuration](config/README.md)
- [Initialization](init/README.md)
- [Project Structure](docs/project-structure.md)
- [Database Structure](docs/database-structure.md)
- [Entity Relationships](docs/er-diagram.md)
- [Views](views/README.md)
- [Extraction and Upload Workflows](docs/result-extraction.md)
- [Academic Forms](docs/academic-form-defaults.md)
- [Academic Result Semantics](docs/academic-result-semantics.md)
- [Students Search and Lookup](docs/students-search-lookup.md)
- [Analytics and Reports](docs/analytics-reports-ux.md)
- [Settings](docs/settings-first-release.md)
- [Demo Dataset](seed/README.md)
- [Implementation Status](docs/implementation-status.md)

Source code and applied migrations are authoritative. `package.json` declares ISC;
the repository currently has no standalone license file.
