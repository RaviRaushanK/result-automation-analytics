'use strict';

const service = require('../services/studentCategoryService');
const reportsRepository = require('../repositories/reportsRepository');

exports.page = async (req, res, next) => {
  try {
    const batches = await reportsRepository.options('batches', {});
    const data = req.query.batch_id ? await service.list(req.query) : { students: [], page: 1, totalPages: 0, count: 0, batch_id: '' };
    res.render('students/index', { title: 'Students - SRAAS', pageStyles: ['/css/reports.css'], batches, ...data,
      breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }, { label: 'Students' }] });
  } catch (err) { if (err.status) return res.status(err.status).send(err.message); next(err); }
};
exports.updateCategory = async (req, res) => {
  try { res.json({ success: true, student: await service.update(req.params.studentId, req.body || {}) }); }
  catch (err) { if (!err.status) console.error('Student category update failed:', err.message); res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Unable to save admission category.' }); }
};
