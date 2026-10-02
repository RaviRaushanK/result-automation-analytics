'use strict';
const { AcademicCourse } = require('../database/models');
const { SCHEME } = require('./academicPolicy');
const fields = ['subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks'];
async function resolve(session, definition, transaction) {
  if (!session || !/^\d+$/.test(String(session.semester)) || Number(session.semester) < 1 || Number(session.semester) > 24) {
    throw Object.assign(new Error('The examination session has no valid academic semester.'), { status: 409 });
  }
  const identity = { batch_id: session.batch_id, semester: String(Number(session.semester)), subject_code: definition.subject_code.trim().toUpperCase() };
  const [course] = await AcademicCourse.findOrCreate({ where: identity, defaults: { ...definition, ...identity, grading_scheme_version: SCHEME, roster_verified: false }, transaction });
  if (course.status !== 'active' || fields.some(field => String(course[field]) !== String(definition[field]))) {
    const error = new Error('The course definition conflicts with this semester\'s existing course. Review the academic course roster before saving.'); error.status = 409; throw error;
  }
  return course;
}
module.exports = { resolve, fields };
