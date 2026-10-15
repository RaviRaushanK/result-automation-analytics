'use strict';

// Retired: attempt-local/legacy grades cannot certify cumulative CGPA.
const { sequelize } = require('../database/models');
async function main() {
  const [rows] = await sequelize.query(`SELECT COUNT(*) AS results,
    SUM(cgpa IS NULL) AS missing_cgpa,
    SUM(cgpa IS NOT NULL AND cgpa_is_cumulative=0) AS uncertified_stored_gpa
    FROM results`);
  console.log('Legacy CGPA backfill is disabled. No academic records were changed.');
  console.log(rows[0]);
  console.log('New imports calculate cumulative GPA only from verified course and grading history.');
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => sequelize.close());
