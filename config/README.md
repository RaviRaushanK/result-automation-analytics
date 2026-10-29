# Configuration

Reviewed on 17 October 2026. See [Setup](../README.md#setup) before first use.

## Files and Loading

- `config/.env.example`: committed configuration template.
- `config/.env`: private local configuration; do not commit it.
- `config/db.js` and `config/config.js`: application/Sequelize CLI database setup.
- `config/session.js`: MySQL-backed sessions and cookie policy.
- `config/sidebar.json`: menu labels, Material Icons and navigation visibility.
- `config/reportCenter.js`: the eight report-center destinations.
- `config/uploadLimits.js`: actual upload byte limits.

The application also loads a root `.env`, while database/session/AI modules load
`config/.env`. Dotenv does not override pre-existing process values in these
calls. Avoid conflicting root/config environment files. Sidebar roles control
visibility, not endpoint authorization.

## Database and Sessions

| Variable | Meaning |
| --- | --- |
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port, normally 3306 |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `DB_NAME` | Installed database name |
| `SESSION_SECRET` | Private random session-signing secret |
| `NODE_ENV` | Deployment environment |
| `APP_PORT` | HTTP port; default 3000 |

Session storage uses `express-mysql-session` and may create its session table.
Cookies are HTTP-only, SameSite Lax, four-hour rolling, and secure in production.
A strong secret is required; the source fallback is not a production setting.
HTTPS/proxy handling and wider session revocation need deployment review.

Generate a secret locally:

~~~bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

## Invitation Email and Mobile Verification

Account configuration updated on 22 October 2026:

| Variable | Meaning |
| --- | --- |
| `APP_BASE_URL` | Reachable application origin for invitation URLs; defaults to localhost with `APP_PORT` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP connection, authentication and sender for invitations and email OTPs |
| `SMS_PROVIDER` | `twilio-verify` for provider-managed mobile OTPs, or `twilio` for custom Messaging API bodies |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Private Twilio account credentials |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service identifier for `twilio-verify` mode |
| `TWILIO_FROM`, `TWILIO_MESSAGING_SERVICE_SID` | Alternative senders for `twilio` Messaging mode; unused in Verify mode |

Set a reachable `APP_BASE_URL` before inviting remote users. SMTP acceptance
does not prove inbox delivery. Restart the server after changing environment
values. Never commit real credentials. The manual SMTP diagnostic script and
its npm command are no longer present.

## OCR, Vision and LLM

| Variable | Default / Behavior |
| --- | --- |
| `GROQ_API_KEY` | Optional; enables hybrid dispatch when present |
| `GROQ_VLM_MODEL` | `qwen/qwen3.8-27b` |
| `GROQ_LLM_MODEL` | `openai/gpt-oss-20b` |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` |
| `GROQ_TIMEOUT_MS` | 60000 per request |
| `EXTRACTION_MODE` | `auto`; use `tesseract` for local-only processing |
| `VLM_MAX_PAGES` | 3 pages for rasterized PDF paths |
| `VLM_RENDER_SCALE` | 2 |
| `VLM_PAGE_CONCURRENCY` | 2; bounded to 1–2 simultaneous hybrid pages; use 1 on constrained hosts or provider quotas |

`auto` uses hybrid AI when configured, with local fallback. `vlm` currently
takes the same branch; it is not a strict force-AI/no-fallback mode. Complete
meaningful embedded PDF result tables bypass AI even when rows need review.
PDF uploads longer than three pages without meaningful result-table text are
rejected before any raster/OCR/AI call. Admission is separate from strict marks,
identity and required-roster validation. A candidate roster with no matching
detected subject code produces a separate subject-scope error. This policy is independent
of `VLM_MAX_PAGES`. Rasterized PDF limits still apply to admitted local sparse
fallbacks. No OCR/VLM settings or provider retry behavior are changed by admission.

Hybrid extraction sends images and OCR/transcription data outside the machine.
Use local-only mode for records that must not leave the institution. Provider
availability, supported models, charges and quotas are external constraints.
No claim of free/unlimited access is made by the software documentation.

Model JSON is reviewed and validated, not automatically authoritative. Stage
diagnostics identify incomplete/unavailable OCR, vision or reconciliation.
See [Extraction](../docs/result-extraction.md).

## Upload Limits

| Input | Formats | Limit |
| --- | --- | --- |
| Result/revaluation marks card | PDF, PNG, JPG, JPEG | 15 MB each |
| Students import | CSV, XLS, XLSX | 10 MB |
| Institution logo | PNG, JPEG, WebP | 2 MB |

Result images must be readable single-frame PNG/JPEG within 40 megapixels.
Logos have separate decoding limits and are re-encoded to PNG. Legacy
`UPLOAD_PATH`, `MAX_UPLOAD_SIZE`, `OCR_PROVIDER` and `DEBUG_MODE` example
variables are not active controls in the current pipeline; edit neither those
values nor database settings expecting them to change these limits.

## Git and Deployment

Only `.gitkeep` is tracked under each of `uploads/branding`, `uploads/results`,
`uploads/revaluation` and `uploads/temp`. Uploaded content remains local and
must be backed up/deployed separately. Never commit credentials or student cards.

The current ignore rules cover files named `.env`, but not every suffix variant
such as `.env.local`; check staged files. The npm lockfile remains ignored.
These policies were not changed as part of the documentation update.
