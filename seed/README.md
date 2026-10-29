# Academic Demo Dataset

Reviewed on 17 October 2026 against `academic/data.js`, `persist.js`,
`safety.js`, `verify.js` and the root npm commands.

**Use only a disposable local development/test database.** This is a destructive
reset of academic data, not an append-only import or a production repair tool.

## Commands

After installing dependencies, configuring MySQL and applying migrations:

~~~powershell
npm.cmd run demo
npm.cmd run demo:verify
~~~

These shortcuts use only local `academic_result_analytics_db`, default
`NODE_ENV` to development only when absent, and refuse production/remote or
unsupported environments. Verification is read-only; it does not reset data.

For another explicitly confirmed local test database:

~~~powershell
$env:NODE_ENV = 'development'
npm.cmd run seed:demo -- --reset --confirm-db your_local_demo_database
npm.cmd run seed:demo:verify -- --confirm-db your_local_demo_database
~~~

The confirmation must match `DB_NAME`. Stop imports, revaluation reviews and
other writes before reset. `npm start`, `npm run setup` and migrations do not
automatically seed this dataset.

The retired `seed/seed_all.js` file and its broken `all` npm alias are removed.
Use the documented root demo commands above. `seed_clean.js` is a retired guard that refuses
writes; the retired history generator was removed. `seed_summary.js`,
`seed_check.js` and the disabled legacy GPA backfill are maintenance/diagnostic
utilities, not alternate instructions for creating verified academic history.
The root Sequelize `seed` command is not the demo-reset workflow.

## Reset Scope and Safety

Before deletion, a JSON backup of academic tables is written to the OS temporary
directory. The path is printed. It may contain real identity/marks data: protect
and retain it separately. There is no automatic restore command.

The reset deletes original results, subject results, revaluation events,
import/OCR staging, assignments, subject offerings, exam sessions and academic
courses. It force-deletes non-protected student rows. Existing accounts, faculty,
departments, batches and institution settings are retained subject to validation.

The three protected MCA 2025 student profiles are identity-only after reset:
`1MV25MC061`, `1MV25MC052` and `1MV25MC074`. Existing identity IDs/UUIDs,
names, USNs and emails are checked/preserved; mismatches cause rollback.
**Their existing academic results are removed by reset**, and no synthetic
marks, GPA, backlog history or revaluation is generated for them. Their presence
is not a promise that real academic history survives demo reset.

Data generation/persistence explicitly refuses demo academic results for those
USNs. Do not bypass that guard to satisfy an outdated test or old scenario table.

Reset, insertion and integrity assertions are transactional with foreign keys
enabled. Report/Analytics smoke checks run after commit; a later smoke failure
does not imply the earlier commit was rolled back. Never reset concurrently
with application write workflows.

## Current Generated Plan

The following counts come from the in-memory plan, not a new database seed:

| Item | Count |
| --- | ---: |
| Student profiles, including the three protected identities | 36 |
| Academic courses | 48 |
| Examination sessions | 12 |
| Session offerings | 72 |
| Result headers | 92 |
| Subject-result values | 508 |
| REGULAR results | 83 |
| BACKLOG results | 5 |
| SUPPLEMENTARY results | 2 |
| REPEAT results | 2 |
| Revaluation events | 8 |

The eight events comprise five approved, two pending and one rejected; four
approved events are effective and one approved event is historical. No original
SubjectResult or stored Result GPA is overwritten by the revaluation fixtures.

The plan covers MCA 2025, MCA 2026 and isolated TEST UNVERIFIED MCA. It illustrates
course/attempt semantics, not an official curriculum or programme-duration rule.
Some examination dates are deliberately future-dated test scenarios. The reset
prints actual persisted counts and a logical dataset SHA-256 digest.

## Synthetic Scenarios

| Demo USN suffix / Batch | Scenario |
| --- | --- |
| 001 / MCA 2025 | Credit-weighted SGPA/cumulative GPA example across semesters |
| 002 | Two failures cleared through supplementary participation |
| 003 | A course remains failed after a backlog attempt |
| 004 | Multiple failed/retake attempts followed by clearance |
| 005 | REPEAT participation clears a failed course |
| 006, 007 | Pending/rejected revaluation does not change Effective outcomes |
| 008 | Historical approved, effective approved and pending event selection |
| 009 | Semester 2 backlog clearance |
| 010 | Grade-boundary examples |
| 011 | Strong synthetic performance; no claimed tie with a protected real student |
| 012 | Historical missing IA/EX components with canonical total retained |
| 014, 015 | Marks-only increase and PASS-to-FAIL effective revision |
| 016 | Backlog attempt revised from FAIL to PASS |
| 017 | Explicit second attempt in the same examination session |
| 025 | No results: unavailable, not zero/fail |
| 026, 027 | No generated Semester 3 result; useful for manual upload checks |
| MCA 2026 demo students | Partial current-cohort history |
| TEST UNVERIFIED MCA | Unverified roster/legacy evidence remains unknown |

Full regular cards contain the required semester subjects; retakes contain only
attempted subjects. Course mappings, maxima and credits come from the fixture
definitions. The 150-mark MMC305 scenario tests actual maxima rather than
assuming six subjects each out of 100. Retake GPA stays unavailable where the
production policy does not certify it.

Canonical ledger revised marks are complete totals. This differs from the
printed final external-mark cell on a revaluation source card; source extraction
does not silently replace that independent cell with a derived total.

## Accounts and Manual Uploads

The development demo administrator is `demo_admin / DemoAdmin2026!`. A demo
faculty login is created only if the installed login-role schema permits it;
the initial schema is admin-only. Existing account passwords are not overwritten,
and incompatible pre-existing demo account identities/credentials cause refusal.

No fake marks-card documents or OCR provenance are generated. Upload real,
institutionally authorized cards only through the normal review/validation flow.
Manual later-semester uploads require prior saved original cards; a reserved
demo student with no previous history cannot bypass that rule.

## Verification and Known Gaps

~~~powershell
node --test tests/demo-seed.test.js
~~~

Four baseline unit assertions are stale: a missing legacy entry point,
102-versus-92 result expectations, generation for a protected real student, and
nine-versus-eight event expectations. Documentation now follows source behavior;
these tests were not rewritten or bypassed during the documentation update.

Persisted checks require `DEMO_SEED_DB_TEST=1` and the matching disposable demo
dataset. They do not seed automatically. Do not enable them against arbitrary
real academic data expecting all scenario assertions to hold.

See [Implementation Status](../docs/implementation-status.md) for the latest
default-suite result, and [Academic Semantics](../docs/academic-result-semantics.md)
for production course/GPA rules.
