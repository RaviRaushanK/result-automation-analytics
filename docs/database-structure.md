# Recommended Database Folder Structure

```
project-root/
│
├─ config/
│   ├─ .env                # Environment variables (DB credentials, etc.)
│   └─ db.js               # Sequelize instance configuration
│
├─ database/
│   ├─ schema.sql          # Raw MySQL schema (for manual execution)
│   └─ models/             # Individual Sequelize model files
│       ├─ Department.js
│       ├─ AdminUser.js
│       ├─ Batch.js
│       ├─ Faculty.js
│       ├─ ResultSession.js
│       ├─ Subject.js
│       ├─ SubjectFaculty.js
│       ├─ Student.js
│       ├─ Result.js
│       ├─ SubjectResult.js
│       ├─ RevaluationResult.js
│       ├─ ImportLog.js
│       ├─ OcrExtraction.js
│       └─ SystemSetting.js
│
├─ migrations/             # Sequelize migration files (schema only)
│   └─ 20231001000000-create-all-tables.js
│
├─ init/                   # **Required system data** (run in every environment)
│   ├─ 01-default-settings.js
│   ├─ 02-default-admin.js
│   └─ README.md
│
├─ seeders/                # **Sample / demo / testing data** (dev only)
│   └─ 20231001000100-seed-mca.js
│
├─ scripts/                # Helper scripts
│   └─ runInit.js          # Executes all files in ./init
│
├─ models/
│   └─ models.js           # Central import & association definition
│
├─ docs/
│   ├─ database-structure.md
│   └─ er-diagram.md
│
├─ controllers/            # Express route handlers
│   └─ … (existing)
│
├─ routes/                 # Express route definitions
│   └─ … (existing)
│
├─ public/                 # Static assets (CSS, JS, images)
│   └─ …
│
├─ views/                  # EJS templates
│   └─ …
│
├─ app.js                  # Express application entry point
└─ package.json
```

## Database Initialization Workflow

1. **Create the schema**  
   ```bash
   npx sequelize-cli db:migrate
   ```

2. **Load required system data** (run in **all** environments)  
   ```bash
   npm run init-db
   ```
   This executes every script in the `init/` folder (e.g., default settings, default admin account).  
   The scripts are idempotent, so the command can be safely re‑run.

3. **Load optional demo data** (development / demo only)  
   ```bash
   npx sequelize-cli db:seed:all
   ```

4. **Start the application**  
   ```bash
   npm start
   ```

The separation ensures that production deployments never receive demo data, while required configuration is always present.

---

### Adding New Init Scripts

* Place a new file in `init/` with the next numeric prefix (e.g., `03-add-feature-flags.js`).  
* Export an async function receiving `{ sequelize, DataTypes }`.  
* Use `findOrCreate` or `upsert` to make the operation safe to run multiple times.

---

### Adding New Seeders

* Follow the existing naming convention (`YYYYMMDDHHMMSS-description.js`).  
* Seeders are intended for sample data and should **not** be run in production pipelines.

---

**Note:** The `npm run init-db` script is defined in `package.json` and points to `scripts/runInit.js`.