# Database Initialization

Reviewed on 17 October 2026.

Initialization inserts baseline configuration and development access after the
schema exists. It is separate from demo seeding and does not run automatically
on every application start.

## Execution

~~~powershell
npm.cmd run init-db
~~~

The root `npm run setup` also invokes this after database bootstrap/migrations.
`scripts/runInit.js` loads JavaScript files in lexical order and passes
`{ sequelize, DataTypes }` to each exported async function.

| Order | Script | Behavior |
| --- | --- | --- |
| 1 | `01-default-settings.js` | Finds/creates the initial OCR confidence, pass-rule and AI-model setting keys |
| 2 | `02-default-admin.js` | Creates the development administrator only when its email is absent |
| 3 | `03-default-department.js` | Finds/creates Master of Computer Applications with department code MCA |

Fresh development credentials are `admin / admin123`. Change the password using
Settings > Account Security before use with real data. Existing matching
administrator records are not reset by initialization. Never treat the default
credentials as production provisioning.

The legacy initialization setting keys are not the source of the current
academic grading policy or Groq model selection. Academic rules come from
`services/academicPolicy.js`; external model configuration is environment-based.

## Adding a Script

1. Add the next numerically prefixed JavaScript file.
2. Export an async function receiving `{ sequelize, DataTypes }`.
3. Use guarded/idempotent writes, preserving existing accounts/configuration.
4. Document its purpose and required privileges.
5. Run only after the relevant schema migration exists.

Initialization is not a backup/restore, migration substitute or academic-data
reset. Back up existing installations before schema/deployment operations.
