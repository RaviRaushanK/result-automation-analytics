'use strict';
const { AcademicCourse, Batch, Subject, ResultSession, sequelize } = require('../database/models');
const { Op } = require('sequelize');
function scope(query) {
  if (!/^[1-9]\d*$/.test(String(query.batch_id)) || !Number.isSafeInteger(Number(query.batch_id)) || !/^[1-9]\d?$/.test(String(query.semester)) || Number(query.semester) > 24) {
    const error = new Error('Select a valid batch and semester.'); error.status = 400; throw error;
  }
  return { batch_id: Number(query.batch_id), semester: String(Number(query.semester)) };
}
exports.page = async (req, res, next) => {
  try {
    const batches = await Batch.findAll({ order: [['start_year','DESC']] });
    const selected = req.query.batch_id ? scope(req.query) : { batch_id: '', semester: '' };
    const courses = selected.batch_id ? await AcademicCourse.findAll({ where: selected, order: [['subject_code','ASC']] }) : [];
    res.render('subjects/courses', { title: 'Semester Courses - SRAAS', pageStyles: ['/css/reports.css'], batches, courses, selected, saved: req.query.saved === '1' });
  } catch (error) { if (error.status) return res.status(error.status).send(error.message); next(error); }
};
exports.confirm = async (req, res, next) => {
  try {
    const selected = scope(req.body);
    if (req.body.confirm !== '1') return res.status(400).send('Explicit course-roster confirmation is required.');
    const ids = [req.body.required_courses || []].flat().map(String);
    if (!ids.length || ids.some(id => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) return res.status(400).send('Select the required semester courses.');
    await sequelize.transaction(async transaction => {
      const courses = await AcademicCourse.findAll({ where: selected, transaction, lock: transaction.LOCK.UPDATE });
      if (ids.some(id => !courses.some(course => String(course.course_id) === id))) throw Object.assign(new Error('A selected course does not belong to this batch and semester.'), { status: 400 });
      const unmapped = await Subject.count({ where: { course_id: null }, include: [{ model: ResultSession, where: selected, required: true }], transaction });
      if (unmapped) throw Object.assign(new Error('Unmapped examination subjects must be reconciled before confirming this semester.'), { status: 409 });
      for (const course of courses) await course.update({ is_required: ids.includes(String(course.course_id)), roster_verified: true, reviewed_by: req.session.adminId, reviewed_at: new Date() }, { transaction });
    });
    res.redirect(`/subjects/courses?batch_id=${selected.batch_id}&semester=${selected.semester}&saved=1`);
  } catch (error) { if (error.status) return res.status(error.status).send(error.message); next(error); }
};
