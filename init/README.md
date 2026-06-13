# Database Initialization Scripts

This folder contains **required system data** that must exist for the application to start correctly.  
Unlike seeders, these scripts are **idempotent** and are executed in every environment (development, staging, production) after the database schema has been created.

## Execution Order
Files are prefixed with a numeric order (`01-`, `02-`, …) to guarantee deterministic execution.

## Running the Init Scripts
```bash
npm run init-db
```
The command runs `scripts/runInit.js`, which loads each file in this folder sequentially.

## Adding New Init Scripts
1. Create a new file with the next numeric prefix, e.g., `03-add-new-feature.js`.  
2. Export an async function that receives `{ sequelize, DataTypes }`.  
3. Use `findOrCreate` or `upsert` to ensure the operation is safe to run multiple times.

```js
module.exports = async ({ sequelize, DataTypes }) => {
  const Model = require('../database/models/YourModel')(sequelize, DataTypes);
  await Model.findOrCreate({
    where: { uniqueColumn: 'value' },
    defaults: { /* other columns */ }
  });
};
```

After adding the file, it will be automatically executed the next time `npm run init-db` is run.