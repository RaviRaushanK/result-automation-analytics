/**
 * seed/seed_history.js
 * ──────────────────────────────────────────────────────────────
 * Seeds 4 PAST MCA batches (2021–2024) with realistic test data
 * so analytics dashboards have multi-batch history to report on.
 *
 * Every batch gets its OWN USN range — no student USN is shared
 * across batches:
 *   MCA 2021 → 1MV21MC001 … 1MV21MC040
 *   MCA 2022 → 1MV22MC001 … 1MV22MC040
 *   MCA 2023 → 1MV23MC001 … 1MV23MC040
 *   MCA 2024 → 1MV24MC001 … 1MV24MC040
 *
 * Per batch:
 *   Students : 40
 *   Sessions : Sem 1 Dec Y (REGULAR)
 *              Sem 1 Jun Y+1 (BACKLOG)  — failed students only, attempt 2
 *              Sem 2 Jun Y+1 (REGULAR)
 *              Sem 3 Dec Y+1 (REGULAR)
 *              Sem 4 Jun Y+2 (REGULAR)
 *   Subjects : 6 per session (5 theory + 1 lab, 4 credits each)
 *
 * Idempotent — safe to re-run (findOrCreate everywhere).
 *
 * Run: node seed/seed_history.js
 */
'use strict';
// Historical generator lacks verified course/GPA provenance. Keep its source,
// but prevent accidental execution against the current academic model.
throw new Error('Legacy history seed retired. Use seed/seed_demo.js --reset --confirm-db <DB_NAME> in development instead.');
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const { uuid, computeGrade, computeSGPA, generateMarks } = require('./seed_data');
const { sequelize, Department, Batch, ResultSession, Student, Subject, Result, SubjectResult } = db;

const STUDENTS_PER_BATCH = 40;

// ── Batch definitions (past cohorts) ─────────────────────────────
const BATCHES = [
  { name: 'MCA 2021', start: 2021, end: 2023, usnYear: '21' },
  { name: 'MCA 2022', start: 2022, end: 2024, usnYear: '22' },
  { name: 'MCA 2023', start: 2023, end: 2025, usnYear: '23' },
  { name: 'MCA 2024', start: 2024, end: 2026, usnYear: '24' }
];


// ── Subject sets keyed by semester ───────────────────────────────
const SUBJECTS_BY_SEMESTER = {
  '1': [
    { code: 'MMC101', name: 'PROGRAMMING AND PROBLEM SOLVING IN C',  type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC102', name: 'DISCRETE MATHEMATICS AND GRAPH THEORY', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC103', name: 'DATABASE MANAGEMENT SYSTEMS (DBMS)',    type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC104', name: 'OPERATING SYSTEM',                      type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC105', name: 'WEB TECHNOLOGIES',                      type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMCL106', name: 'DBMS AND WEB TECHNOLOGIES LABORATORY', type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
  ],
  '2': [
    { code: 'MMC201', name: 'COMPUTER ORGANIZATION AND ARCHITECTURE', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC202', name: 'DATA STRUCTURES AND ALGORITHMS',         type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC203', name: 'SOFTWARE ENGINEERING',                  type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC204', name: 'ARTIFICIAL INTELLIGENCE',               type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC205', name: 'COMPUTER NETWORKS',                     type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMCL206', name: 'DSA AND AI LABORATORY',                type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
  ],
  '3': [
    { code: 'MMC301', name: 'THEORY OF COMPUTATION',                  type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC302', name: 'COMPILER DESIGN',                       type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC303', name: 'CLOUD COMPUTING',                       type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC304', name: 'CRYPTOGRAPHY AND NETWORK SECURITY',     type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC305', name: 'MACHINE LEARNING',                      type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMCL306', name: 'ML AND CC LABORATORY',                 type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
  ],
  '4': [
    { code: 'MMC401', name: 'BIG DATA ANALYTICS',                    type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC402', name: 'INTERNET OF THINGS',                    type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC403', name: 'SOFTWARE PROJECT MANAGEMENT',           type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC404', name: 'DATA SCIENCE',                          type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMC405', name: 'DISTRIBUTED SYSTEMS',                   type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
    { code: 'MMCL406', name: 'BIG DATA AND DATA SCIENCE LABORATORY', type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
  ]
};

// ── Session plan per batch (relative to start year Y) ────────────
function sessionsForBatch(start) {
  return [
    { semester: '1', exam_session: 'Dec', exam_year: start,     exam_type: 'REGULAR', label: `Sem 1 Dec ${start}`,     subjectSem: '1' },
    { semester: '1', exam_session: 'Jun', exam_year: start + 1, exam_type: 'BACKLOG', label: `Sem 1 Jun ${start + 1}`, subjectSem: '1', backlog: true },
    { semester: '2', exam_session: 'Jun', exam_year: start + 1, exam_type: 'REGULAR', label: `Sem 2 Jun ${start + 1}`, subjectSem: '2' },
    { semester: '3', exam_session: 'Dec', exam_year: start + 1, exam_type: 'REGULAR', label: `Sem 3 Dec ${start + 1}`, subjectSem: '3' },
    { semester: '4', exam_session: 'Jun', exam_year: start + 2, exam_type: 'REGULAR', label: `Sem 4 Jun ${start + 2}`, subjectSem: '4' }
  ];
}

// ── Upsert helpers (idempotent) ──────────────────────────────────
async function upsertDepartment() {
  const [row] = await Department.findOrCreate({
    where: { department_code: 'MCA' },
    defaults: {
      department_uuid: uuid(),
      department_code: 'MCA',
      department_name: 'Master of Computer Applications',
      description: 'MCA Department',
      status: 'active'
    }
  });
  return row;
}

async function upsertBatch(deptId, def) {
  const [row] = await Batch.findOrCreate({
    where: { department_id: deptId, batch_name: def.name },
    defaults: {
      batch_uuid: uuid(),
      department_id: deptId,
      batch_name: def.name,
      start_year: def.start,
      end_year: def.end,
      status: 'active'
    }
  });
  return row;
}

async function upsertSessions(batchId, start) {
  const rows = [];
  for (const s of sessionsForBatch(start)) {
    const [row] = await ResultSession.findOrCreate({
      where: {
        batch_id: batchId, semester: s.semester,
        exam_session: s.exam_session, exam_year: s.exam_year
      },
      defaults: {
        session_uuid: uuid(), batch_id: batchId,
        semester: s.semester, exam_session: s.exam_session, exam_year: s.exam_year
      }
    });
    rows.push({ ...s, sessionId: row.session_id });
  }
  return rows;
}

async function upsertSubjects(sessions) {
  const subjectMap = {};
  for (const sess of sessions) {
    subjectMap[sess.sessionId] = [];
    for (const sub of SUBJECTS_BY_SEMESTER[sess.subjectSem]) {
      const [row] = await Subject.findOrCreate({
        where: { session_id: sess.sessionId, subject_code: sub.code },
        defaults: {
          subject_uuid: uuid(), session_id: sess.sessionId,
          subject_code: sub.code, subject_name: sub.name,
          subject_type: sub.type, credits: sub.credits,
          max_internal: sub.max_internal, max_external: sub.max_external, max_marks: sub.max_marks
        }
      });
      subjectMap[sess.sessionId].push({ id: row.subject_id, ...sub });
    }
  }
  return subjectMap;
}

/** 40 students with USNs unique to this batch: 1MV{yy}MC001-040 */
async function upsertStudents(batchId, def) {
  const studentMap = {};
  for (let i = 1; i <= STUDENTS_PER_BATCH; i++) {
    const seq = String(i).padStart(3, '0');
    const usn = `1MV${def.usnYear}MC${seq}`;
    const [row] = await Student.findOrCreate({
      where: { usn },
      defaults: {
        student_uuid: uuid(), batch_id: batchId,
        usn,
        student_name: `STUDENT ${def.usnYear}${seq}`,
        email: `student${def.usnYear}${seq}@test.com`,
        status: 'active'
      }
    });
    studentMap[usn] = { studentId: row.student_id, usn };
  }
  return studentMap;
}

/**
 * Create one Result + its SubjectResults inside the transaction.
 * subsToRecord = all subjects for regular sessions, only the
 * previously-failed subjects for backlog re-sits.
 */
async function createResult(t, studentId, sess, subsToRecord, opts = {}) {
  const attemptNo = opts.attemptNo || 1;
  const result = await Result.create({
    result_uuid: uuid(), student_id: studentId, session_id: sess.sessionId,
    sgpa: null, cgpa: null,
    result_status: 'pass', failed_subject_count: 0,
    attempt_no: attemptNo,
    exam_type: sess.exam_type
  }, { transaction: t });

  const subjectResults = [];
  let failedCount = 0;

  for (const sub of subsToRecord) {
    // Salt by batch so two batches never get identical marks
    const { total } = generateMarks(
      studentId + (opts.markSalt || ''), sub.code, sub.max_internal, sub.max_external
    );
    const grade = computeGrade(total);
    const status = grade === 'F' ? 'fail' : 'pass';
    if (status === 'fail') failedCount++;

    await SubjectResult.create({
      result_id: result.result_id, subject_id: sub.id,
      marks: total, grade, result_status: status
    }, { transaction: t });

    subjectResults.push({ subjectId: sub.id, code: sub.code, grade, status });
  }

  const sgpa = sess.backlog ? null : computeSGPA(subjectResults, subsToRecord);
  const overallStatus = failedCount > 0 ? 'fail' : 'pass';

  // Legacy synthetic grades cannot supply certified cumulative GPA.
  const cgpa = null;

  await result.update(
    { sgpa, cgpa, result_status: overallStatus, failed_subject_count: failedCount },
    { transaction: t }
  );

  const failedCodes = subjectResults.filter(s => s.status === 'fail').map(s => s.code);
  return { result, failedCodes };
}

/**
 * Failed subject codes of an already-committed result.
 * Runs WITHOUT the seed transaction on purpose: it must see rows
 * committed by a previous run (snapshot isolation would hide them).
 */
async function loadFailedCodes(resultId) {
  const failedRows = await SubjectResult.findAll({
    where: { result_id: resultId, result_status: 'fail' }
  });
  if (!failedRows.length) return [];
  const subs = await Subject.findAll({
    where: { subject_id: failedRows.map(f => f.subject_id) }
  });
  return subs.map(s => s.subject_code);
}


// ── Main ─────────────────────────────────────────────────────────
async function seed() {
  const t = await sequelize.transaction();
  try {
    console.log('\n=== SEEDING 4 PAST BATCHES ===\n');
    const dept = await upsertDepartment();
    console.log('Department:', dept.department_name, 'id=' + dept.department_id + '\n');

    for (const def of BATCHES) {
      const batch = await upsertBatch(dept.department_id, def);
      console.log(`Batch: ${batch.batch_name} (${def.start}-${def.end}) id=${batch.batch_id}`);

      const sessions = await upsertSessions(batch.batch_id, def.start);
      const subjectMap = await upsertSubjects(sessions);
      const studentMap = await upsertStudents(batch.batch_id, def);
      console.log(`  Students: ${Object.keys(studentMap).length}`);

      /** usn → Set of subject codes failed in Sem 1 (feeds backlog session) */
      const sem1Failures = {};

      for (const sess of sessions) {
        const subjects = subjectMap[sess.sessionId];
        let created = 0, skipped = 0;

        if (sess.backlog) {
          // Only students who failed at least one Sem-1 subject re-sit
          const failedStudents = Object.keys(studentMap).filter(
            usn => (sem1Failures[usn] || new Set()).size > 0
          );
          for (const usn of failedStudents) {
            const student = studentMap[usn];
            const existing = await Result.findOne({
              where: { student_id: student.studentId, session_id: sess.sessionId }
            });
            if (existing) { skipped++; continue; }

            const failedCodes = sem1Failures[usn];
            const retakeSubjects = subjects.filter(s => failedCodes.has(s.code));
            if (retakeSubjects.length === 0) continue;
            await createResult(t, student.studentId, sess, retakeSubjects, {
              attemptNo: 2,
              markSalt: batch.batch_name + '-backlog'
            });
            created++;
          }
        } else {
          for (const [usn, student] of Object.entries(studentMap)) {
            const existing = await Result.findOne({
              where: { student_id: student.studentId, session_id: sess.sessionId }
            });
            if (existing) {
              // Re-run: reload failures without rewriting committed academic values.
              if (sess.semester === '1') {
                const codes = await loadFailedCodes(existing.result_id);
                if (codes.length) sem1Failures[usn] = new Set(codes);
              }
              skipped++;
              continue;
            }

            const { failedCodes } = await createResult(t, student.studentId, sess, subjects, {
              attemptNo: 1,
              markSalt: batch.batch_name
            });

            // Track Sem-1 failures so the backlog session knows who re-sits
            if (sess.semester === '1' && failedCodes.length) {
              sem1Failures[usn] = new Set(failedCodes);
            }
            created++;
          }
        }
        console.log(`  ${sess.label} [${sess.exam_type}]: created=${created} skipped=${skipped}`);
      }

      console.log('');
    }

    await t.commit();
    console.log('=== SEED COMPLETE ===\n');
  } catch (err) {
    await t.rollback();
    console.error('\nSEED FAILED:', err.message);
    if (err.errors) {
      for (const e of err.errors) {
        console.error('  ValidationError:', e.type, '|', e.path, '=', JSON.stringify(e.value), '|', e.message);
      }
    }
    console.error(err.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

seed();


