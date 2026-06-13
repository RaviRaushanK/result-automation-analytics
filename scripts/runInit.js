#!/usr/bin/env node
/**
 * Run all initialization scripts located in the ./init folder.
 * Each script must export an async function that receives an object:
 *   { sequelize, DataTypes }
 *
 * The scripts are executed sequentially in lexical order.
 */

const path = require('path');
const fs = require('fs');
const { sequelize, DataTypes } = require('../config/db'); // Adjust if your db config exports these

async function run() {
  const initDir = path.resolve(__dirname, '..', 'init');
  const files = fs.readdirSync(initDir)
    .filter(f => f.endsWith('.js'))
    .sort(); // lexical order respects numeric prefixes

  for (const file of files) {
    const scriptPath = path.join(initDir, file);
    console.log(`Running init script: ${file}`);
    const initFn = require(scriptPath);
    if (typeof initFn !== 'function') {
      console.warn(`Skipping ${file}: does not export a function`);
      continue;
    }
    try {
      await initFn({ sequelize, DataTypes });
    } catch (err) {
      console.error(`Error executing ${file}:`, err);
      process.exit(1);
    }
  }

  console.log('All init scripts completed successfully.');
  await sequelize.close();
}

run();