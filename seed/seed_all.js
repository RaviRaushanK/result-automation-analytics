'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const { uuid, REAL_STUDENTS, generateRandomStudents, SESSIONS, getSubjectsForSession, computeGrade, computeSGPA, generateMarks } = require('./seed_data');
const { sequelize, Department, Batch, ResultSession, Student, Subject, Result, SubjectResult } = db;

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

async function upsertBatch(deptId) {
  const [row] = await Batch.findOrCreate({
    where: { department_id: deptId, batch_name: 'MCA 2025' },
    defaults: {
      batch_uuid: uuid(),
      department_id: deptId,
      batch_name: 'MCA 2025',
      start_year: 2025,
      end_year: 2028,
      status: 'active'
    }
  });
  return row;
}

async function upsertSessions(batchId) {
  const rows = [];
  for (const s of SESSIONS) {
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
    const subjects = getSubjectsForSession(sess.label);
    for (const sub of subjects) {
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

async function upsertStudents(batchId) {
  const allStudents = [...REAL_STUDENTS, ...generateRandomStudents(75)];
  const studentMap = {};
  for (const s of allStudents) {
    const [row] = await Student.findOrCreate({
      where: { usn: s.usn },
      defaults: {
        student_uuid: uuid(), batch_id: batchId,
        usn: s.usn, student_name: s.name, email: s.email, status: 'active'
      }
    });
    studentMap[s.usn] = { studentId: row.student_id, usn: s.usn, name: s.name };
  }
  return studentMap;
}

async function seed() {
  const t = await sequelize.transaction();
  try {
    console.log('\n=== SEEDING DATABASE ===\n');
    const dept = await upsertDepartment();
    console.log('Department:', dept.department_name, 'id=' + dept.department_id);

    const batch = await upsertBatch(dept.department_id);
    console.log('Batch:', batch.batch_name, 'id=' + batch.batch_id);

    const sessions = await upsertSessions(batch.batch_id);
    for (const s of sessions) console.log('Session:', s.label, 'id=' + s.sessionId);

    const subjectMap = await upsertSubjects(sessions);
    const studentMap = await upsertStudents(batch.batch_id);
    console.log('Students:', Object.keys(studentMap).length, 'total\n');

    for (const sess of sessions) {
      const subjects = subjectMap[sess.sessionId];
      let created = 0, skipped = 0;

      for (const [usn, student] of Object.entries(studentMap)) {
        // Skip the 3 real students in ALL sessions
        if (['1MV25MC052', '1MV25MC061', '1MV25MC074'].includes(usn)) continue;

        const existing = await Result.findOne({ where: { student_id: student.studentId, session_id: sess.sessionId } });
        if (existing) { skipped++; continue; }

        const result = await Result.create({
          result_uuid: uuid(), student_id: student.studentId, session_id: sess.sessionId,
          result_status: 'pass', failed_subject_count: 0,
          attempt_no: 1, exam_type: 'REGULAR'
        }, { transaction: t });

        const subjectResults = [];
        let failedCount = 0;

        for (const sub of subjects) {
          const { total } = generateMarks(usn, sub.code, sub.max_internal, sub.max_external);
          const grade = computeGrade(total);
          const status = grade === 'F' ? 'fail' : 'pass';
          if (status === 'fail') failedCount++;

          await SubjectResult.create({
            result_id: result.result_id, subject_id: sub.id,
            marks: total, grade, result_status: status
          }, { transaction: t });

          subjectResults.push({ subjectId: sub.id, grade, total });
        }

        const sgpa = computeSGPA(subjectResults, subjects);
        const overallStatus = failedCount > 0 ? 'fail' : 'pass';
        await result.update({ sgpa, result_status: overallStatus, failed_subject_count: failedCount }, { transaction: t });
        created++;
      }
      console.log('  ' + sess.label + ': created=' + created + ' skipped=' + skipped);
    }

    await t.commit();
    console.log('\n=== SEED COMPLETE ===\n');

    // Summary
    console.log('=== SUMMARY ===');
    console.log('Department: ' + dept.department_name);
    console.log('Batch: ' + batch.batch_name + '  (' + Object.keys(studentMap).length + ' students)');
    for (const s of sessions) {
      const rc = await Result.count({ where: { session_id: s.sessionId } });
      const sc = await Subject.count({ where: { session_id: s.sessionId } });
      console.log('  ' + s.label + ': ' + sc + ' subjects, ' + rc + ' results');
    }
    console.log('');

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
