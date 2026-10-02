'use strict';

const { Batch, Student } = require('../database/models');

function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value, label) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) invalid(`Invalid ${label}.`);
  return Number(value);
}
function category(value) {
  if (value === null) return null;
  if (typeof value !== 'string') invalid('Admission category must be text or blank.');
  const cleaned = value.trim();
  if (cleaned.length > 30 || /[\x00-\x1f\x7f]/.test(value)) invalid('Admission category must be at most 30 characters without control characters.');
  return cleaned || null;
}
async function requireBatch(value) {
  const batch_id = id(value, 'Batch');
  if (!await Batch.findOne({ where: { batch_id, deleted_at: null }, attributes: ['batch_id'] })) invalid('Batch not found.', 404);
  return batch_id;
}
async function list(query) {
  const batch_id = await requireBatch(query.batch_id);
  const page = query.page === undefined ? 1 : id(query.page, 'Page');
  const count = await Student.count({ where: { batch_id, deleted_at: null } });
  const totalPages = Math.ceil(count / 25);
  const currentPage = Math.min(page, Math.max(totalPages, 1));
  const students = await Student.findAll({ where: { batch_id, deleted_at: null }, attributes: ['student_id', 'usn', 'student_name', 'category'], order: [['usn', 'ASC'], ['student_id', 'ASC']], limit: 25, offset: (currentPage - 1) * 25 });
  return { students, batch_id, page: currentPage, totalPages, count };
}
async function update(studentId, body) {
  const student_id = id(studentId, 'Student');
  const value = category(body.category);
  const batch_id = await requireBatch(body.batch_id);
  const student = await Student.findOne({ where: { student_id, batch_id, deleted_at: null }, attributes: ['student_id', 'category'] });
  if (!student) invalid('Student does not belong to the selected batch.', 404);
  await student.update({ category: value });
  return { student_id, category: value };
}
module.exports = { category, list, update };
