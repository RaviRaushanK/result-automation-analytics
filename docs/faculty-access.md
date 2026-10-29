# Faculty Access and Account Lifecycle

Status-management controls reviewed on 30 October 2026 against current routes,
middleware, models and views.

## Registration

An active administrator uses Settings > My Account > Invite faculty to select an
existing active faculty record by name/code and enter its invitation email. An
email on the faculty record is optional. The invitation binds to the faculty ID
and the administrator-provided email; it does not create a faculty record.

The recipient enters the matching faculty code, a username and a password, then
verifies the invited email. Codes are trimmed/uppercased consistently with faculty
creation. Registration does not collect a phone number or send mobile OTPs.

Invitations expire after seven days. A registration session lasts 30 minutes.
Email codes expire after five minutes, with a 60-second resend cooldown, four
sends and five guesses per registration. Replacement invitations revoke pending
links for the same faculty member or email. The existing hourly invitation limit
is 20 per administrator.

Activation rechecks the faculty record and creates a `faculty` login account and
consumes the invitation in one transaction. Unique account `faculty_id` storage
prevents duplicate accounts, including concurrent activation attempts. A posted
role or another faculty identifier cannot choose the account's identity or role.

## Permissions

| Area | Faculty access |
| --- | --- |
| Dashboard | View institutional metrics and filters |
| Analytics | All eight existing pages and their authenticated read APIs |
| Reports | Overview, all eight reports, filters, CSV exports and print views |
| Settings | My Account, Account Security, Appearance and read-only Academic Policy |
| Academic management and student directory | Administrator-only |
| Results/revaluation management and uploaded source documents | Administrator-only |
| Invitations, institution branding and system information | Administrator-only |

Faculty reporting is institution-wide, not limited to assigned subjects. Teaching
assignments do not grant editing permissions. Protected requests reload the
current account, and faculty accounts also require an active, undeleted linked
faculty record. An old session's cached role does not override current authority.

Only institution-branding images remain publicly served under `/uploads/branding`.
Other `/uploads` paths require authenticated administrator access.

## Activate or Deactivate Faculty

Administrators open Academic Management > Faculty > Manage Faculty. This dialog
works without a batch or exam-session selection. It lists active and inactive
faculty, supports name/code search and status filtering, and confirms every
Activate/Deactivate action before saving.

Deactivation changes the existing faculty status to `inactive` and updates its
timestamp. New logins fail and existing sessions lose access on their next
protected request. Inactive faculty are unavailable for new assignments and new
registration. Historical assignments, result records and report faculty names
are retained. No schema migration is needed for this control.

Blocked browser requests show a branded, theme-aware access page explaining
that access is disabled and directing the user to their institution administrator.
The response remains HTTP 403. Return to sign in signs out the blocked session
before opening Login, avoiding a redirect loop. API callers still receive JSON
with HTTP 403 and code `ACCOUNT_ACCESS_DISABLED`; protected content is not rendered.
The same page handles a verified-password login when account/faculty access is
disabled. Incorrect credentials continue to show the generic login error.

Reactivation changes the faculty record back to `active`. It does not create a
login account or override a separately inactive login account. Existing accounts
can resume access only when both their account and faculty record are active.

The registry API is `GET /faculty/api/registry`. Status changes use
`PATCH /faculty/api/:facultyId/status` with `status` and `expectedStatus` values
(`active`/`inactive`) and the current CSRF token. Both routes require a current
administrator. The write rechecks administrator authority and locks the faculty
record in a transaction. Stale confirmations return 409 rather than overwriting
another administrator's status change. Failed writes do not show a success state.

## Sidebar

Faculty sees Dashboard, Analytics, Reports and Settings with a subtle Faculty
Workspace label. Analytics expands by default. Reports expands for its active
destination or when opened manually. Original submenu labels, icons and spacing
are preserved, including Progress / Backlog Trends. There is no faculty identity
card above Settings. Admin navigation retains its existing behavior.

The sidebar still uses the shared width, a tablet rail, mobile drawer and
scrolling. Active links expose `aria-current="page"`. Visibility is presentation;
backend routes enforce permissions independently.

## Compatibility and Retired Features

Migration `20261029100000-faculty-account-access.js` adds the Faculty role and
faculty references to accounts/invitations. Existing administrator roles remain
unchanged. Unused legacy invitations, including registrations in progress, are
revoked and must be replaced with faculty invitations. Apply migrations through
the normal setup/upgrade command; do not recreate the database.

Phone registration, account phone editing and SMS/Twilio provider modules are
removed. Email registration, email changes and email-based password recovery
remain supported. An unexpired registration that already verified email while
awaiting the retired mobile step can finish with Activate account.

Legacy `admin_users.mobile`, `mobile_verified_at`, and the `mobile_change` OTP enum
value are retained for historical data compatibility. They are not active account
features. Old mobile-verification requests are rejected. Retaining these fields
does not require reintroducing phone inputs or provider credentials.

## Verification

Default checks do not seed or reset the academic database:

~~~powershell
node --test tests/account-access.test.js tests/faculty-status.test.js tests/faculty-access.test.js tests/faculty-sidebar.test.js tests/registration.test.js tests/settings.test.js tests/analytics-reports-ux.test.js
node tests/faculty-sidebar-browser.js
node tests/faculty-status-browser.js
node tests/account-access-browser.js
~~~

The browser harness uses installed Edge (or `REPORTS_BROWSER`) and an isolated
render server. It checks 1440, 1024, 768 and 375px, both themes, original submenu
styling, active routes, drawer/rail transitions, short-screen scrolling and the
absence of the removed sidebar profile. Artifacts go to the OS temporary directory.

The status browser harness uses in-memory faculty writes to exercise confirmation,
cancel, filtering, status changes and stale-state conflicts in both themes at the
same four widths. It does not deactivate real faculty.

Opt-in registration database checks:

~~~powershell
$env:REGISTRATION_DB_TEST = '1'
node --test tests/registration.test.js tests/faculty-registration-race.test.js
Remove-Item Env:REGISTRATION_DB_TEST
~~~

The registration fixture rolls back. The concurrency fixture creates temporary
account/faculty/invitation records and removes them in cleanup. Neither resets
academic data nor sends a real email; test delivery is stubbed.
