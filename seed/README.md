# Seed Scripts

Standalone one-off scripts to populate the database with realistic test data. These scripts are **never loaded by the running application** — they are run manually from the terminal.

---

## Prerequisites

1. MySQL must be running and accessible (check `config/.env`)
2. Run `npm run setup` or `npm run migrate` first to create all tables

---

## Scripts

| File | What it does |
|------|-------------|
| `seed_all.js` | Master script — inserts everything in the right order |
| `seed_summary.js` | Read-only — prints current data counts |
| `seed_clean.js` | Hard-deletes all seeded rows (raw SQL, bypasses FK constraints) |
| `seed_data.js` | Shared test data (students, sessions, subjects, marks/grade logic) |

---

## Quick start

```bash
# 1. (once) ensure schema exists
npm run setup

# 2. (re-runnable) seed data
node seed/seed_all.js

# 3. inspect
node seed/seed_summary.js

# 4. wipe and start over
node seed/seed_clean.js
```

All scripts are idempotent — running `seed_all.js` twice will not duplicate rows.

### What gets created

| Entity          | Count | Notes |
|-----------------|-------|-------|
| Department      | 1     | MCA — Master of Computer Applications |
| Batch           | 1     | MCA 2025 (2025–2028) |
| ResultSessions  | 3     | Sem 1 Dec 2025, Sem 1 Jun 2026 (BACKLOG), Sem 2 Jun 2026 |
| Subjects        | 18    | 6 per session, different codes per session |
| Students        | 78    | 3 real + 75 random |
| Results         | 225   | 75 random students × 3 sessions — **no results for real students** |
| SubjectResults  | 1350  | 6 subjects × 225 results |

---

## Data Details

### 3 Real Students (no results inserted — admin enters manually via Revaluation workflow)

| USN | Name | Email |
|-----|------|-------|
| 1MV25MC061 | RAVI RAUSHAN KUMAR | raviraushan253@gmail.com |
| 1MV25MC052 | PRAFUL KRISHNAPPA VAJJARAMATTI | example1@gmail.com |
| 1MV25MC074 | SINDHUKUMAR S | example2@gmail.com |

### 75 Random Students

USN range `1MV25MC001` – `1MV25MC078`, excluding the 3 real USNs above. Named `STUDENT 001` – `STUDENT 078`.

### Subjects per session

All subjects: `type` = theory/lab, `credits` = 4, `max_internal` = 50, `max_external` = 50, `max_marks` = 100.

**Sem 1 Dec 2025 (REGULAR)**

| Code   | Name                                          | Type   |
|--------|-----------------------------------------------|--------|
| MMC101 | PROGRAMMING AND PROBLEM SOLVING IN C          | theory |
| MMC102 | DISCRETE MATHEMATICS AND GRAPH THEORY         | theory |
| MMC103 | DATABASE MANAGEMENT SYSTEMS (DBMS)            | theory |
| MMC104 | OPERATING SYSTEM                              | theory |
| MMC105 | WEB TECHNOLOGIES                              | theory |
| MMCL106 | DBMS AND WEB TECHNOLOGIES LABORATORY         | lab    |

**Sem 1 Jun 2026 (BACKLOG)**

| Code   | Name                                          | Type   |
|--------|-----------------------------------------------|--------|
| MMC201 | COMPUTER ORGANIZATION AND ARCHITECTURE        | theory |
| MMC202 | DATA STRUCTURES AND ALGORITHMS                | theory |
| MMC203 | SOFTWARE ENGINEERING                          | theory |
| MMC204 | ARTIFICIAL INTELLIGENCE                       | theory |
| MMC205 | COMPUTER NETWORKS                             | theory |
| MMCL206 | DSA AND AI LABORATORY                        | lab    |

**Sem 2 Jun 2026 (REGULAR)**

| Code   | Name                                          | Type   |
|--------|-----------------------------------------------|--------|
| MMC301 | THEORY OF COMPUTATION                         | theory |
| MMC302 | COMPILER DESIGN                               | theory |
| MMC303 | CLOUD COMPUTING                               | theory |
| MMC304 | CRYPTOGRAPHY AND NETWORK SECURITY             | theory |
| MMC305 | MACHINE LEARNING                              | theory |
| MMCL306 | ML AND CC LABORATORY                         | lab    |

### Sessions

| Semester | Exam Session | Year | Type |
|---------|-------------|------|------|
| 1 | Dec | 2025 | REGULAR |
| 1 | Jun | 2026 | BACKLOG |
| 2 | Jun | 2026 | REGULAR |

### Marks Generation

Marks are generated pseudo-randomly per student USN + subject combination. Each call produces the same marks for a given USN (deterministic). Grades follow the standard scheme:

| Total | Grade |
|-------|-------|
| ≥90 | S |
| 80–89 | A |
| 70–79 | B |
| 60–69 | C |
| 50–59 | D |
| 45–49 | E |
| <45 | F |

SGPA is computed as: `Σ(grade_points × credits) / Σ(credits)` where `grade_points = { S:10, A:9, B:8, C:7, D:6, E:4, F:0 }`.

---

## Notes

- All inserts use `findOrCreate` — re-running `seed_all.js` is safe and idempotent.
- **`Subject` rows are keyed on `(session_id, subject_code)`** — the same code can appear in multiple sessions because the unique index is composite.
- **Results are skipped for the 3 real students** in all three sessions — they have no `Result` rows and are reserved for the admin Revaluation workflow.
- Marks are deterministic (seeded by `usn + subject_code` hash) — re-running produces identical numbers.
- All inserts run inside a single Sequelize transaction; any failure rolls back the whole seed.
