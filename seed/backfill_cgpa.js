/**
 * seed/backfill_cgpa.js
 *
 * One-off, idempotent backfill for `results.cgpa`.
 *
 * Why this exists
 * ---------------
 * `seed_all.js` originally stored only `sgpa`, so every result row created by
 * it (the current MCA 2025 batch and its sessions) has `cgpa = NULL`. The
 * Analytics "Rank" column is derived from the stored CGPA, so those rows show
 * no rank until the column is populated.
 *
 * What it does
 * ------------
 * For EVERY result whose `cgpa` IS NULL it recomputes the value from the
 * committed subject results using the repository's documented definition
 * (mirrors controllers/resultController.buildValidatedPayload):
 *
 *   CGPA = Σ(grade_points × credits) / Σ(credits)   over PASSED courses only
 *          (F-grade courses are excluded from numerator AND denominator,
 *           P.G. 2022/2024 definition)
 *
 * Grade points come from the SAME scale the seeded grade letters were produced
 * with (`seed_data.GRADE_POINTS`), so the backfilled CGPA is consistent with the
 * stored SGPA of the same subject results.
 *
 * Rules
 * -----
 *   - Only rows with `cgpa IS NULL` are touched; existing values are never
 *     overwritten.
 *   - A result where every subject failed stays NULL (no fake 0 is written).
 *   - Read-only unless it actually writes: pass `--dry-run` to preview.
 *
 * Run
 * ---
 *   node seed/backfill_cgpa.js --dry-run   # preview only
 *   node seed/backfill_cgpa.js             # apply
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const { computeCGPAFromRows } = require('./seed_data');
const { sequelize, Result } = db;

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await sequelize.authenticate();
  console.log('\n=== CGPA BACKFILL ' + (DRY_RUN ? '(dry run — nothing is written)' : '(applying)') + ' ===\n');

  const [rows] = await sequelize.query(`
    SELECT r.result_id        AS resultId,
           st.usn             AS usn,
           rs.exam_year       AS examYear,
           rs.semester        AS semester,
           sr.grade           AS grade,
           sub.credits        AS credits
    FROM results r
    INNER JOIN students st        ON st.student_id  = r.student_id
    INNER JOIN result_sessions rs ON rs.session_id  = r.session_id
    LEFT  JOIN subject_results sr ON sr.result_id   = r.result_id
    LEFT  JOIN subjects sub       ON sub.subject_id = sr.subject_id
    WHERE r.cgpa IS NULL
    ORDER BY r.result_id ASC, sr.subject_result_id ASC
  `);

  const byResult = new Map();
  for (const row of rows) {
    if (!byResult.has(row.resultId)) {
      byResult.set(row.resultId, {
        usn: row.usn, examYear: row.examYear, semester: row.semester, subjects: []
      });
    }
    byResult.get(row.resultId).subjects.push({ grade: row.grade, credits: row.credits });
  }

  console.log('Results with NULL cgpa:', byResult.size, '(from ' + rows.length + ' subject-result rows)');
  if (byResult.size === 0) {
    console.log('Nothing to do.\n=== BACKFILL COMPLETE ===\n');
    return;
  }

  let updated = 0, allFailed = 0;
  for (const [resultId, group] of byResult) {
    const cgpa = computeCGPAFromRows(group.subjects);
    const label = group.usn + ' Sem ' + group.semester + ' ' + group.examYear;
    if (cgpa === null) {
      allFailed++;
      console.log('  SKIP  result ' + resultId + ' (' + label + '): every registered course failed — cgpa stays NULL');
      continue;
    }
    if (!DRY_RUN) await Result.update({ cgpa }, { where: { result_id: resultId } });
    updated++;
    if (updated <= 10) {
      console.log('  ' + (DRY_RUN ? 'WOULD SET' : 'SET      ') + ' result ' + resultId +
        ' (' + label + ') -> cgpa=' + cgpa.toFixed(2));
    }
  }

  if (updated > 10) console.log('  ... ' + (updated - 10) + ' more result(s)');

  console.log('\n' + (DRY_RUN ? 'Would update' : 'Updated') + ': ' + updated +
    '  |  left NULL (all failed): ' + allFailed);
  console.log('\n=== BACKFILL COMPLETE ===\n');
}

main()
  .catch((err) => {
    console.error('BACKFILL FAILED:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
