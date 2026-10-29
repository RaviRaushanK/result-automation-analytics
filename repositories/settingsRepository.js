'use strict';
const { Op } = require('sequelize');
const { sequelize, SystemSetting, SettingAudit, AdminUser, Faculty } = require('../database/models');
const ACCOUNT_FIELDS = ['admin_id', 'username', 'email', 'role', 'status', 'last_login', 'faculty_id'];
async function account(id) {
  const row = await AdminUser.findOne({ where: { admin_id: id, deleted_at: null, status: 'active' }, attributes: ACCOUNT_FIELDS, raw: true });
  if (!row || !['admin', 'faculty'].includes(row.role)) return null;
  if (row.role === 'faculty') {
    if (!row.faculty_id) return null;
    const faculty = await Faculty.findOne({ where: { faculty_id: row.faculty_id, status: 'active', deleted_at: null }, attributes: ['faculty_name', 'faculty_code'], raw: true });
    if (!faculty) return null;
    Object.assign(row, faculty);
  }
  return row;
}
async function emailTaken(email, id) {
  return Boolean(await AdminUser.findOne({ where: { email, admin_id: { [Op.ne]: id } }, attributes: ['admin_id'], paranoid: false }));
}
async function updateEmail(id, email) {
  return AdminUser.update({ email, updated_at: new Date() }, { where: { admin_id: id, deleted_at: null, status: 'active' } });
}
async function values(keys, transaction, lock = false) {
  return SystemSetting.findAll({ where: { setting_key: { [Op.in]: keys } }, attributes: ['setting_key', 'setting_value'], order: [['setting_key', 'ASC']], raw: true, transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) });
}
async function save(updates, actor) {
  return sequelize.transaction(async transaction => {
    // Lock the writer's current account and re-check its authority in the same transaction.
    const writer = await AdminUser.findOne({ where: { admin_id: actor, role: 'admin', status: 'active', deleted_at: null }, attributes: ['admin_id'], transaction, lock: transaction.LOCK.UPDATE });
    if (!writer) throw Object.assign(new Error('Administrator access is required.'), { status: 403 });
    const existing = new Map((await values(Object.keys(updates), transaction, true)).map(row => [row.setting_key, row.setting_value]));
    const now = new Date(), audits = [];
    for (const [key, value] of Object.entries(updates)) {
      if (existing.get(key) === value) continue;
      await SystemSetting.upsert({ setting_key: key, setting_value: value, updated_at: now }, { transaction });
      audits.push({ setting_key: key, old_value: existing.get(key) ?? null, new_value: value, changed_by: actor, changed_at: now });
    }
    if (audits.length) await SettingAudit.bulkCreate(audits, { transaction });
    return audits.length;
  });
}
async function audit() { return SettingAudit.findAll({ attributes: ['audit_id', 'setting_key', 'old_value', 'new_value', 'changed_by', 'changed_at'], order: [['changed_at', 'DESC'], ['audit_id', 'DESC']], limit: 10, raw: true }); }
async function health() { try { await sequelize.authenticate(); return 'Connected'; } catch { return 'Unavailable'; } }
module.exports = { account, emailTaken, updateEmail, values, save, audit, health };
