'use strict';
const { digest } = require('./academicIntegrity');
const policy = require('./academicPolicy');
function snapshot(session, subjects, courses) {
  const definitions = ['subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks'];
  const rows = (values, fields, id) => values.map(row => Object.fromEntries(fields.map(field => [field, String(row[field] ?? '')])))
    .sort((a, b) => a[id].localeCompare(b[id]));
  return digest({ batch: String(session.batch_id), semester: String(Number(session.semester)), period: policy.periodKey(session),
    subjects: rows(subjects, ['subject_id','course_id', ...definitions], 'subject_id'),
    courses: rows(courses, ['course_id','is_required','roster_verified','status', ...definitions], 'course_id') });
}
module.exports = { snapshot };
