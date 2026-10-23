'use strict';
const { AcademicCourse, Batch, Subject, Result, ExamSession, sequelize } = require('../database/models');
const { sortBatches, semesterCount } = require('../public/js/academic-form-options');

function positiveInteger(value) {
  return ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }
function scope(query) {
  if (!positiveInteger(query.batch_id) || !positiveInteger(query.semester)) throw invalid('Select a valid batch and semester.');
  return { batch_id: Number(query.batch_id), semester: String(Number(query.semester)) };
}
function checkSemester(batch, semester) {
  const count = semesterCount(batch);
  if (!count || Number(semester) > count) throw invalid('Select a semester within the selected batch duration.');
}

exports.redirectLegacy = (req, res) => {
  const query = new URLSearchParams({ tab: 'roster' });
  for (const key of ['batch_id', 'semester']) {
    if (req.query[key] !== undefined && req.query[key] !== '') {
      if (!positiveInteger(req.query[key])) return res.status(400).send('Select a valid batch and semester.');
      query.set(key, String(req.query[key]));
    }
  }
  if (req.query.saved === '1') query.set('saved', '1');
  return res.redirect('/subjects?' + query);
};

exports.page = async (req, res, next, forceEdit = false) => {
  try {
    const batches = sortBatches(await Batch.findAll({ order: [['start_year', 'DESC'], ['end_year', 'DESC'], ['batch_id', 'DESC']] }));
    const requestedBatch = req.query.batch_id;
    if (requestedBatch !== undefined && requestedBatch !== '' && !positiveInteger(requestedBatch)) throw invalid('Select a valid batch.');
    const batch = requestedBatch ? batches.find(row => String(row.batch_id) === String(requestedBatch)) : batches[0];
    if (requestedBatch && !batch) throw invalid('The selected batch is unavailable.');
    const count = semesterCount(batch);
    const selected = { batch_id: batch?.batch_id || '', semester: count ? '1' : '' };
    if (req.query.semester !== undefined && req.query.semester !== '') {
      if (!positiveInteger(req.query.semester) || !batch) throw invalid('Select a valid batch and semester.');
      checkSemester(batch, req.query.semester);
      selected.semester = String(Number(req.query.semester));
    }
    const courses = selected.semester ? await AcademicCourse.findAll({ where: selected, order: [['subject_code', 'ASC']] }) : [];
    return res.render('subjects/courses', {
      layout: 'layouts/main', title: 'Subjects Management - Semester Roster',
      pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/subjects.css'],
      breadcrumbItems: [{ href: '#', label: 'Academic Management' }, { href: '/subjects', label: 'Subjects' }, { label: 'Semester Roster' }],
      batches, courses, selected, semesterLimit: count, canManageRoster: true,
      editingRoster: courses.length > 0 && (forceEdit || req.query.edit === '1' || courses.some(course => !Number(course.roster_verified))),
      saved: req.query.saved === '1'
    });
  } catch (error) { if (error.status) return res.status(error.status).send(error.message); next(error); }
};

exports.edit = (req, res, next) => exports.page(req, res, next, true);

exports.confirm = async (req, res, next) => {
  try {
    const selected = scope(req.body);
    if (req.body.confirm !== '1') return res.status(400).send('Explicit course-roster confirmation is required.');
    const required = req.body.required_courses || [];
    const ids = (Array.isArray(required) ? required : [required]).map(value => ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && (typeof value === 'string' || Number.isSafeInteger(value)) ? String(value) : '');
    if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) return res.status(400).send('Select the required semester courses.');
    await sequelize.transaction(async transaction => {
      const batch = await Batch.findByPk(selected.batch_id, { transaction, lock: true });
      if (!batch) throw invalid('The selected batch is unavailable.');
      checkSemester(batch, selected.semester);
      const courses = await AcademicCourse.findAll({ where: selected, transaction, lock: transaction.LOCK.UPDATE });
      if (ids.some(id => !courses.some(course => String(course.course_id) === id))) throw invalid('A selected course does not belong to this batch and semester.');
      const changed = courses.some(course => Boolean(Number(course.is_required)) !== ids.includes(String(course.course_id)));
      if (changed && await Result.count({ include: [{ model: ExamSession, required: true, where: selected }], transaction, lock: true })) throw Object.assign(new Error('Required courses cannot change after this semester has saved results. Keep its historical roster and configure curriculum changes in the appropriate new batch.'), { status: 409 });
      const unmapped = await Subject.count({ where: { course_id: null }, include: [{ model: ExamSession, where: selected, required: true }], transaction });
      if (unmapped) throw Object.assign(new Error('Unmapped examination subjects must be reconciled before confirming this semester.'), { status: 409 });
      for (const course of courses) await course.update({ is_required: ids.includes(String(course.course_id)), roster_verified: true, reviewed_by: req.session.adminId, reviewed_at: new Date() }, { transaction });
    });
    return res.redirect(`/subjects?tab=roster&batch_id=${selected.batch_id}&semester=${selected.semester}&saved=1`);
  } catch (error) { if (error.status) return res.status(error.status).send(error.message); next(error); }
};
