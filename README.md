# Result Automation Analytics (SRAAS)

A Node.js/Express + MySQL application for managing academic results, students, subjects, revaluations, and analytics.

---

## Prerequisites

- **Node.js** v18+ with npm v9+
- **MySQL** v8.0+ (must be running before setup)
- **Tesseract OCR** (required for PDF/table extraction in the revaluation workflow)

---

## Required `.env` variables

Create `config/.env` and set these:

| Variable | Default | Notes |
|----------|---------|-------|
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | — | MySQL password |
| `DB_NAME` | `academic_result_analytics_db` | Database name |
| `SESSION_SECRET` | — | **Change for production.** Long random string recommended. |
| `APP_PORT` | `3000` | App listen port |
| `MAX_UPLOAD_SIZE` | `20MB` | Max file upload size |
| `OCR_PROVIDER` | `tesseract` | OCR engine |

---

## Features

- Manage **departments, batches, students, faculty, and subjects**
- Record **semester results** with SGPA, CGPA, and grade tracking
- **Revaluation workflow** with PDF upload, OCR extraction, and manual review
- **Analytics dashboards** — toppers, failed students, subject performance
- **Role-based access control** (admin, faculty, student)
- Idempotent seed scripts for demo data (`seed/`)

---

## Tech stack

- Node.js / Express 5
- EJS templates (with `express-ejs-layouts`)
- MySQL via Sequelize 6
- `express-session` + `bcryptjs` authentication
- Bootstrap 5, Material Icons
- `tesseract.js` + `pdfjs-dist` for OCR / PDF extraction

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure (copy + edit credentials)
cp config/.env.example config/.env      # macOS / Linux
# On Windows, create config/.env manually

# 3. Initialize the database (create DB + run migrations + init scripts)
npm run setup

# 4. (optional) populate with test data
node seed/seed_all.js                   # see seed/README.md for details

# 5. Start the app
npm start
```

The app is served at <http://localhost:3000>.

---

## Default admin account

| Field    | Value               |
|----------|---------------------|
| Username | `admin`             |
| Email    | `admin@example.com` |
| Password | `admin123`          |

(Seeded by `init/02-default-admin.js`. Change immediately in production.)

---

## npm scripts

| Script              | What it does                                                |
|---------------------|-------------------------------------------------------------|
| `npm run setup`     | Create DB → run migrations → run init scripts               |
| `npm run migrate`   | Run Sequelize migrations only                               |
| `npm run init-db`   | Run `init/*.js` initialization scripts (settings, admin)   |
| `npm start`         | Start the Express server (`node app.js`)                    |

`npm run seed` is reserved for the (optional) `seeders/` directory; **demo data lives in `seed/`** and is run manually via `node seed/seed_all.js`.

---

## Project layout

```text
result-automation-analytics/
├── app.js                       # Express entry point
├── config/                      # .env, db, session, sidebar
├── controllers/                 # Route handlers (auth, dashboard, results, revaluation, …)
├── database/models/             # Sequelize models
├── docs/                        # Database ER diagram, project structure
├── init/                        # 01-default-settings, 02-default-admin
├── middlewares/                 # auth, layout, menu, theme, user
├── migrations/                  # Sequelize CLI migrations
├── public/                      # css, js, images, charts
├── routes/                      # Express route modules
├── scripts/                     # bootstrap-db.js, runInit.js
├── seed/                        # Manual test-data seeder (see seed/README.md)
├── services/                    # OCR, document/revaluation extractors
├── uploads/                     # Uploaded revaluation files
└── views/                       # EJS templates
```

---

## Routes (high level)

| Path           | Purpose                  | Access          |
|----------------|--------------------------|-----------------|
| `/`            | Landing page             | Public          |
| `/login`       | Login                    | Public          |
| `/dashboard`   | Admin/faculty dashboard  | Authenticated   |
| `/batches`     | Batch management         | Authenticated   |
| `/subjects`    | Subject management       | Authenticated   |
| `/sessions`    | Result session mgmt      | Authenticated   |
| `/results`     | Result entry & review    | Authenticated   |
| `/revaluation` | Revaluation workflow     | Authenticated   |
| `/analytics/*` | Reports & analytics      | Authenticated   |

---

## User roles

| Role | Access |
|------|--------|
| `admin` | Full CRUD on all entities, revaluation review, settings |
| `faculty` | View dashboard, results, analytics; no admin settings |
| `student` | Read-only access to own results |

---

## Troubleshooting

### `subject_code must be unique` on seed

The database may have a stale single-column unique index on `subjects.subject_code` that prevents the same code from appearing in multiple sessions. Fix:

```sql
ALTER TABLE subjects DROP INDEX subject_code;
```

The composite index `UNIQUE(session_id, subject_code)` remains and is correct.

---

## Documentation

- `docs/er-diagram.md` — entity-relationship diagram
- `docs/database-structure.md` — schema and constraints
- `seed/README.md` — how to populate test data
