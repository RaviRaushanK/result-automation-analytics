'use strict';
const { Op } = require('sequelize');
const { Student, Batch } = require('../database/models');
const BATCH_ORDER = [['start_year', 'DESC'], ['end_year', 'DESC'], ['batch_id', 'DESC']];

function where(filters) {
  const conditions = {};
  if (filters.batch_id !== 'all') conditions.batch_id = filters.batch_id;
  if (filters.category) conditions.category = filters.category;
  if (filters.status) conditions.status = filters.status;
  if (filters.search) {
    // Treat LIKE metacharacters as literal search text, not user-selected wildcards.
    const pattern = '%' + filters.search.replace(/[\\%_]/g, '\\$&') + '%';
    conditions[Op.or] = ['usn', 'student_name', 'email'].map(field => ({ [field]: { [Op.like]: pattern } }));
  }
  return conditions;
}

module.exports = {
  BATCH_ORDER,
  latestBatch: () => Batch.findOne({ attributes: ['batch_id'], order: BATCH_ORDER }),
  count: filters => Student.count({ where: where(filters) }),
  rows: (filters, limit, offset) => Student.findAll({
    attributes: ['student_id', 'batch_id', 'usn', 'student_name', 'email', 'category', 'status'],
    where: where(filters), include: [{ model: Batch, attributes: ['batch_id', 'batch_name'] }],
    order: [['usn', 'ASC'], ['student_id', 'ASC']], limit, offset
  }),
  async stats(filters) {
    const scope = where({ ...filters, search: '', category: '', status: '' });
    const total = await Student.count({ where: scope });
    const active = await Student.count({ where: { ...scope, status: 'active' } });
    const inactive = await Student.count({ where: { ...scope, status: 'inactive' } });
    const categories = await Student.count({ where: { ...scope, category: { [Op.ne]: '' } }, distinct: true, col: 'category' });
    return { total, active, inactive, categories };
  }
};
