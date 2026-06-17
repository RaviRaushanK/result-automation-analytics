# Result Automation Analytics (SRAAS)

A full-stack Node.js/Express application for managing academic results, students, subjects, and revaluations.

## Overview

This project provides a full-stack solution for:

- Managing **departments**, **batches**, **students**, **faculty**, and **subjects**.
- Recording **semester results** with optional **SGPA** and **CGPA** values.
- Handling **revaluation requests** with metadata such as uploaded file, remarks, and the admin who performed the upload.
- Generating an **effective results view** that combines original and revaluation data.

## Key Features and Recent Updates

| Feature | Description |
|---|---|
| **Composite Unique Constraints** | `subjects` are unique per `session_id`; `result_sessions` are unique per batch/semester/exam session/year. |
| **Nullable SGPA/CGPA** | Results can be stored without SGPA/CGPA values. |
| **Revaluation Metadata** | `revaluation_results` stores `revised_grade`, `file_name`, `file_path`, `remarks`, and `uploaded_by`. |
| **Indexes** | Added missing index on `students.usn` and ensured other critical indexes exist for performance. |
| **Effective View Update** | `effective_student_results` uses `revised_grade` from revaluation results when available. |
| **Seeder Fixes** | Subject seeder syntax was corrected to align with new constraints. |
| **Controller Updates** | `resultController` now accepts nullable SGPA/CGPA without extra validation. |
| **Documentation Updates** | `docs/database-structure.md` and `docs/implementation-status.md` were updated with the latest schema and implementation details. |

## Project Structure

```
.
├── app.js
├── package.json
├── package-lock.json
├── README.md
├── .sequelizerc
├── .gitignore
├── config/
│   ├── .env.example
│   ├── config.js
│   ├── db.js
│   ├── README.md
│   └── session.js
├── controllers/
│   ├── authController.js
│   ├── batchController.js
│   ├── resultController.js
│   ├── sessionController.js
│   └── subjectController.js
├── database/
│   ├── schema.sql
│   └── models/
│       ├── AdminUser.js
│       ├── Batch.js
│       ├── Department.js
│       ├── Faculty.js
│       ├── ImportLog.js
│       ├── index.js
│       ├── OcrExtraction.js
│       ├── Result.js
│       ├── ResultSession.js
│       ├── RevaluationResult.js
│       ├── Student.js
│       ├── Subject.js
│       ├── SubjectFaculty.js
│       ├── SubjectResult.js
│       └── SystemSetting.js
├── docs/
│   ├── database-structure.md
│   ├── er-diagram.md
│   ├── implementation-status.md
│   └── project-structure.md
├── init/
│   ├── 01-default-settings.js
│   ├── 02-default-admin.js
│   └── README.md
├── middlewares/
├── migrations/
│   ├── 20231001000000-create-all-tables.js
│   └── 20231101000000-modify-schema.js
├── public/
│   ├── charts/
│   ├── css/
│   ├── images/
│   └── js/
├── routes/
│   ├── authRoutes.js
│   ├── batchRoutes.js
│   ├── resultRoutes.js
│   ├── sessionRoutes.js
│   └── subjectRoutes.js
├── scripts/
│   ├── bootstrap-db.js
│   └── runInit.js
├── seeders/
│   └── 20231001000100-seed-mca.js
├── services/
├── uploads/
└── views/
    ├── analytics/
    ├── auth/
    ├── batches/
    ├── chat/
    ├── dashboard/
    ├── layouts/
    ├── partials/
    ├── reports/
    ├── revaluation/
    ├── sessions/
    ├── students/
    └── subjects/
```

### Folder Responsibilities

| Path | Purpose |
|---|---|
| `app.js` | Express application entry point and middleware setup. |
| `config/` | Database, session, and environment configuration. |
| `controllers/` | Business logic for auth, batches, results, sessions, and subjects. |
| `database/models/` | Sequelize model definitions and model associations. |
| `database/schema.sql` | SQL representation of the database schema. |
| `docs/` | Project documentation, including database structure, ER diagram, implementation status, and project structure. |
| `init/` | One-time initialization scripts for default settings and default admin user. |
| `middlewares/` | Express middleware utilities. |
| `migrations/` | Sequelize migrations for database schema changes. |
| `public/` | Static assets such as CSS, JavaScript, images, and charts. |
| `routes/` | Express route definitions mapped to controllers. |
| `scripts/` | Database bootstrap and initialization helper scripts. |
| `seeders/` | Sequelize seeders for initial/sample data. |
| `services/` | Reusable service logic. |
| `uploads/` | Uploaded files, including revaluation documents. |
| `views/` | EJS templates for the web UI. |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update the MySQL/database settings.

```bash
cp .env.example .env
```

### 3. Setup the database

```bash
npm run setup
```

This command:

- Creates the database if it does not already exist.
- Runs all migrations, including `20231101000000-modify-schema.js`.
- Executes initialization scripts:
  - `init/01-default-settings.js`
  - `init/02-default-admin.js`
- Seeds the database with sample data.

### 4. Run the application

```bash
npm start
```

The server will be available at:

```text
http://localhost:3000
```

## Usage

- **Departments and Batches**: managed through `/departments` and `/batches` routes.
- **Students**: CRUD operations under `/students`.
- **Subjects**: CRUD operations under `/subjects`; subject codes are unique per session.
- **Results**: create, read, update, and delete results via `/results`; SGPA/CGPA can be omitted.
- **Revaluations**: upload revaluation files and view revised results through `/revaluation`.

## Testing and Validation

After running `npm run setup`, verify that the seed data loads without errors.

You can validate the effective results view with:

```sql
SELECT * FROM effective_student_results LIMIT 10;
```

The `effective_grade` column should reflect `revaluation_results.revised_grade` when a revaluation result exists.

## Documentation

| Document | Description |
|---|---|
| `docs/database-structure.md` | Database tables, fields, relationships, and schema notes. |
| `docs/implementation-status.md` | Current implementation status and completed/missing features. |
| `docs/er-diagram.md` | Entity relationship documentation for the database. |
| `docs/project-structure.md` | Detailed project file and folder structure. |

## Future Enhancements

- Add pagination and filtering to result listings.
- Implement role-based access control for admin and faculty users.
- Provide an API endpoint for bulk revaluation uploads.
- Add automated tests for controllers, routes, and database operations.

---

Feel free to explore the codebase, run the application, and extend its functionality. If you encounter any issues, check the documentation or open an issue on the repository.

Happy coding!