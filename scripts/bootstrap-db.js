#!/usr/bin/env node
/**
 * Bootstrap the MySQL database.
 * Creates the target database if it does not exist.
 * Uses the same .env variables as the rest of the app.
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

async function createDatabase() {
  // Connect to MySQL without specifying a database
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });

  const dbName = process.env.DB_NAME;
  const charset = 'utf8mb4';
  const collate = 'utf8mb4_unicode_ci';

 const sql = `
   CREATE DATABASE IF NOT EXISTS \`${String(dbName)}\`
   CHARACTER SET ${charset}
   COLLATE ${collate};
 `;

  await connection.query(sql);
  console.log(`✅ Database "${dbName}" ensured.`);
  await connection.end();
}

createDatabase().catch(err => {
  console.error('❌ Failed to bootstrap database:', err);
  process.exit(1);
});