'use strict';
const { AcademicCourse, Subject, SubjectResult, Result, ExamSession } = require('../database/models');
const { Op } = require('sequelize');
const { SCHEME } = require('./academicPolicy');
const fields = ['subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks'];
async function resolve(session, definition, transaction) {
  if (!session || !/^\d+$/.test(String(session.semester)) || Number(session.semester) < 1 || Number(session.semester) > 24) {
    throw Object.assign(new Error('The examination session has no valid academic semester.'), { status: 409 });
  }
  const identity = { batch_id: session.batch_id, semester: String(Number(session.semester)), subject_code: definition.subject_code.trim().toUpperCase() };
  const [course, created] = await AcademicCourse.findOrCreate({ where: identity, defaults: { ...definition, ...identity, grading_scheme_version: SCHEME, roster_verified: false }, transaction });
  if (created && await Result.count({ include: [{ model: ExamSession, required: true, where: { batch_id: session.batch_id, semester: identity.semester } }], transaction, lock: true })) throw Object.assign(new Error('A new academic course cannot be added to a semester with saved results. Reuse the original course for a backlog offering, or configure the new syllabus in its own batch.'), { status: 409 });
  if (course.status !== 'active' || fields.some(field => String(course[field]) !== String(definition[field]))) {
    const error = new Error('The course definition conflicts with this semester\'s existing course. Review the academic course roster before saving.'); error.status = 409; throw error;
  }
  return course;
}
async function updateOffering(subject, session, definition, transaction) {
  if (!session) throw Object.assign(new Error('The subject examination session was not found.'), { status: 404 });
  const scope = { batch_id: session.batch_id, semester: String(Number(session.semester)) };
  let course = subject.course_id
    ? await AcademicCourse.findByPk(subject.course_id, { transaction, lock: transaction.LOCK?.UPDATE })
    : await AcademicCourse.findOne({ where: { ...scope, subject_code: subject.subject_code }, transaction, lock: transaction.LOCK?.UPDATE });
  if (!course && subject.course_id) throw Object.assign(new Error('The linked academic course is missing. Review this course roster before editing.'), { status: 409 });
  if (!course) course = await resolve(session, Object.fromEntries(fields.map(field => [field, subject[field]])), transaction);
  if (String(course.batch_id) !== String(scope.batch_id) || String(Number(course.semester)) !== scope.semester) throw Object.assign(new Error('The linked course belongs to a different batch or semester. Review this course roster before editing.'), { status: 409 });

  // Apply only user changes; an offering with legacy metadata must not silently overwrite its canonical course.
  const changes = Object.fromEntries(fields.filter(field => String(subject[field]) !== String(definition[field])).map(field => [field, definition[field]]));
  const updated = Object.fromEntries(fields.map(field => [field, changes[field] ?? course[field]]));
  const offerings = await Subject.findAll({ where: { course_id: course.course_id }, transaction, lock: transaction.LOCK?.UPDATE });
  const ids = [...new Set([...offerings.map(row => row.subject_id), subject.subject_id])];
  const structural = ['subject_type', 'credits', 'max_internal', 'max_external', 'max_marks'].some(field => Object.hasOwn(changes, field));
  if ((structural || Object.hasOwn(changes, 'subject_code')) && await SubjectResult.count({ where: { [Op.or]: [{ subject_id: { [Op.in]: ids } }, { course_id_snapshot: course.course_id }] }, transaction, lock: true })) {
    throw Object.assign(new Error('Course code, credits, subject type and marking limits cannot change after results exist for this course. The descriptive name can still be corrected.'), { status: 409 });
  }
  const duplicate = await AcademicCourse.findOne({ where: { ...scope, subject_code: updated.subject_code, course_id: { [Op.ne]: course.course_id } }, transaction });
  if (duplicate) throw Object.assign(new Error('Another academic course already uses this subject code in the selected batch and semester.'), { status: 409 });
  if (await Subject.findOne({ where: { exam_session_id: { [Op.in]: [...new Set([...offerings.map(row => row.exam_session_id), subject.exam_session_id])] }, subject_code: updated.subject_code, subject_id: { [Op.notIn]: ids } }, transaction })) {
    throw Object.assign(new Error('This subject code is already used by another offering in a linked examination session.'), { status: 409 });
  }
  await course.update({ ...changes, ...(structural ? { roster_verified: false, reviewed_by: null, reviewed_at: null } : {}) }, { transaction });
  if (Object.keys(changes).length) await Subject.update(changes, { where: { course_id: course.course_id }, transaction });
  await subject.update({ ...changes, course_id: course.course_id }, { transaction });
  return course;
}
module.exports = { resolve, updateOffering, fields };
