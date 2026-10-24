'use strict';
const crypto = require('crypto');
const { AcademicCourse, Subject, ExamSession, Batch, sequelize } = require('../database/models');
const configuration = require('./academicConfiguration');
const { fields } = require('./academicCourseService');
const policy = require('./academicPolicy');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const id = value => typeof value === 'string' || typeof value === 'number'
  ? /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) : false;
async function context(sessionId, batchId, transaction) {
  if (!id(sessionId)) throw fail('Select a valid examination session.', 400);
  const options = transaction ? { transaction, lock: true } : {};
  const session = await ExamSession.findByPk(sessionId, options);
  if (!session) throw fail('The selected examination session was not found.', 404);
  if (!/^\d+$/.test(String(session.semester)) || Number(session.semester) < 1 || Number(session.semester) > 24) throw fail('The examination session has no valid academic semester.');
  if (batchId !== undefined && (!id(batchId) || String(batchId) !== String(session.batch_id))) throw fail('The selected examination session does not belong to this batch.', 400);
  const batch = await Batch.findByPk(session.batch_id, options);
  if (!batch) throw fail('The academic batch is unavailable.', 404);
  const courses = await AcademicCourse.findAll({ where: { batch_id: session.batch_id, semester: String(Number(session.semester)) },
    order: [['subject_code', 'ASC']], raw: true, ...options });
  const offerings = await Subject.findAll({ where: { exam_session_id: session.exam_session_id }, raw: true, ...options });
  const snapshot = configuration.snapshot(session, offerings, courses);
  const exists = course => offerings.some(row => String(row.course_id) === String(course.course_id)
    || String(row.subject_code).trim().toUpperCase() === String(course.subject_code).trim().toUpperCase());
  return { session, batch, courses, offerings, snapshot, exists };
}
async function list(sessionId, batchId) {
  const data = await context(sessionId, batchId);
  return { snapshot: data.snapshot, session: { exam_session_id: data.session.exam_session_id, batch_id: data.session.batch_id,
    semester: data.session.semester, label: 'Semester ' + data.session.semester + ' - ' + policy.formatExamPeriod(data.session) },
    courses: data.courses.filter(row => row.status === 'active').map(course => ({ course_id: course.course_id,
      ...Object.fromEntries(fields.map(field => [field, course[field]])), is_required: course.is_required,
      already_added: data.exists(course) })) };
}
async function reuse(sessionId, body = {}, validate) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Select existing subjects from the reuse list before adding them.', 400);
  if (!Array.isArray(body.course_ids) || !body.course_ids.length || !body.course_ids.every(id)
    || new Set(body.course_ids.map(String)).size !== body.course_ids.length) throw fail('Select one or more distinct existing subjects.', 400);
  if (typeof body.snapshot !== 'string' || !body.snapshot) throw fail('Reload the existing-subject list before adding subjects.', 400);
  return sequelize.transaction(async transaction => {
    // Match curriculum writers: session first, then the shared batch lock.
    const data = await context(sessionId, body.batch_id, transaction);
    if (body.snapshot !== data.snapshot) throw fail('The examination session, subjects or semester course roster changed. Reload the existing-subject list and review it again.');
    const selected = body.course_ids.map(courseId => data.courses.find(course => String(course.course_id) === String(courseId)));
    if (selected.some(course => !course || course.status !== 'active')) throw fail('A selected course is unavailable or belongs to another batch or semester. Reload the existing-subject list.');
    if (selected.some(data.exists)) throw fail('A selected subject is already offered in this examination session. Reload the list; existing subjects will not be overwritten.');
    const definitions = selected.map(course => Object.fromEntries(fields.map(field => [field, course[field]])));
    // Use the same structural validation as ordinary subject creation.
    for (const definition of definitions) {
      const checked = validate(definition);
      if (checked.errors.length) throw fail('An existing course has invalid configuration: ' + definition.subject_code + '. Review its semester course definition before reusing it.');
    }
    return Subject.bulkCreate(selected.map((course, index) => ({ ...definitions[index], course_id: course.course_id,
      exam_session_id: data.session.exam_session_id, subject_uuid: crypto.randomUUID() })), { transaction });
  });
}
module.exports = { list, reuse };
