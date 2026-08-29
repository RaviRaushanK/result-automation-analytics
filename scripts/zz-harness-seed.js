/**
 * scripts/zz-harness-seed.js — Phase 13C end-to-end harness: fixture seed.
 *
 * Creates a minimal, isolated fixture chain for the revaluation wizard smoke test:
 *   Batch → ResultSession → Student → Result → SubjectResult[×N]
 *
 * Strips the '__RAAS_E2E__' prefix from every name so it is easy to find and
 * clean up in the database.  Run this script BEFORE zz-harness-run.js.
 *
 * Usage:
 *   node scripts/zz-harness-seed.js
 *
 * Output: prints the created ids as JSON to stdout, e.g.
 *   { batchId, sessionId, studentId, resultId, subjectResultIds:[…] }
 *   Callers can capture this and pass ids to zz-harness-run.js.
 *
 * Cleanup (manual, use the IDs printed above):
 *   DELETE FROM subject_results WHERE result_id = <resultId>;
 *   DELETE FROM results         WHERE result_id = <resultId>;
 *   DELETE FROM students        WHERE student_id = <studentId>;
 *   DELETE FROM result_sessions WHERE session_id = <sessionId>;
 *   DELETE FROM batches         WHERE batch_id   = <batchId>;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const crypto = require('crypto');
const db = require('../database/models');
const {
  Batch, ResultSession, Student, Result, Subject, SubjectResult, sequelize
} = db;

async function main() {
  const PREFIX = '__RAAS_E2E__';
  const cleanup = [];   // reversed order in finally block

  try {
    // 1. Batch
    const batch = await Batch.create({
      batch_uuid: crypto.randomUUID(),
      department_id: 1,
      batch_name: PREFIX + 'RevalHarness',
      start_year: 2026,
      end_year: 2027,
      status: 'active'
    });
    cleanup.push(['Batch', batch.batch_id]);
    console.error('[seed] Batch created:', batch.batch_id);

    // 2. ResultSession
    const session = await ResultSession.create({
      session_uuid: crypto.randomUUID(),
      batch_id: batch.batch_id,
      semester: 'Semester 5',
      exam_session: 'NOV',
      exam_year: 2026
    });
    cleanup.push(['ResultSession', session.session_id]);
    console.error('[seed] ResultSession created:', session.session_id);

    // 3. Student
    const student = await Student.create({
      student_uuid: crypto.randomUUID(),
      batch_id: batch.batch_id,
      usn: 'RAAS13C0001',
      student_name: PREFIX + 'Revaluation Tester',
      email: 'reval.test@raas.local',
      status: 'active'
    });
    cleanup.push(['Student', student.student_id]);
    console.error('[seed] Student created:', student.student_id);

    // 4. Subjects (one per mark-range to test gradeFromPercent branches)
    const subjectDefs = [
      { code: 'RAAS13C_SUBJ1', name: 'Computer Networks',     credits: 4, max_internal: 50, max_external: 100, max_marks: 150 },
      { code: 'RAAS13C_SUBJ2', name: 'Cryptography',          credits: 3, max_internal: 40, max_external:  60, max_marks: 100 },
      { code: 'RAAS13C_SUBJ3', name: 'Operating Systems',     credits: 4, max_internal: 50, max_external: 100, max_marks: 150 },
    ];
    const subjectIds = [];
    for (const def of subjectDefs) {
      const subj = await Subject.create({
        session_id: session.session_id,
        ...def
      });
      subjectIds.push(subj);
      cleanup.push(['Subject', subj.subject_id]);
    }
    console.error('[seed] Subjects created:', subjectIds.map(s => s.subject_id));

    // 5. Result (REGULAR, attempt 1)
    const result = await Result.create({
      result_uuid: crypto.randomUUID(),
      student_id: student.student_id,
      session_id: session.session_id,
      attempt_no: 1,
      exam_type: 'REGULAR',
      sgpa: 7.50,
      cgpa: 7.80,
      result_status: 'pass',
      failed_subject_count: 0
    });
    cleanup.push(['Result', result.result_id]);
    console.error('[seed] Result created:', result.result_id);

    // 6. SubjectResults (one pass, one fail, one mid-range)
    const marksRows = [
      { idx: 0, marks:  90, grade: 'A', result_status: 'pass'  },   // 60 % → pass
      { idx: 1, marks:  25, grade: 'F', result_status: 'fail'  },   // 25 % → fail
      { idx: 2, marks: 115, grade: 'B', result_status: 'pass'  },   // 76.7 % → pass
    ];
    const srIds = [];
    for (const row of marksRows) {
      const sr = await SubjectResult.create({
        result_id: result.result_id,
        subject_id: subjectIds[row.idx].subject_id,
        marks: row.marks,
        grade: row.grade,
        result_status: row.result_status
      });
      srIds.push(sr.subject_result_id);
      cleanup.push(['SubjectResult', sr.subject_result_id]);
    }
    console.error('[seed] SubjectResults created:', srIds);

    await sequelize.close();

    // Emit IDs as JSON to stdout (parseable by parent shell)
    const out = {
      batchId: batch.batch_id,
      sessionId: session.session_id,
      studentId: student.student_id,
      resultId: result.result_id,
      subjectIds: subjectIds.map(s => s.subject_id),
      subjectResultIds: srIds
    };
    console.log(JSON.stringify(out));
    console.error('[seed] Done.  Run cleanup in reverse order using the ids above.');
    process.exit(0);
  } catch (err) {
    console.error('[seed] ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
