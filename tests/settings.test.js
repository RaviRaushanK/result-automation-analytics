'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const session = require('express-session');
const layouts = require('express-ejs-layouts');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const db = require('../database/models');
const repository = require('../repositories/settingsRepository');
const service = require('../services/settingsService');
after(() => db.sequelize.close());

test('branding defaults, allowed values, persistence and CSV fallback', async () => {
  const saved = repository.values;
  let rows = [];
  repository.values = async keys => { assert.deepEqual(keys, service.KEYS); return rows; };
  try {
    assert.deepEqual(await service.getBranding(), service.DEFAULTS);
    assert.deepEqual(service.brandingMetadata(service.DEFAULTS), []);
    rows = [{ setting_key: 'institution_name', setting_value: ' Example College ' }, { setting_key: 'institution_logo', setting_value: '../../secret.png' }, { setting_key: 'PASS_PERCENTAGE_RULE', setting_value: '99' }];
    const branding = await service.getBranding();
    assert.equal(branding.institution_name, 'Example College'); assert.equal(branding.institution_logo, '');
    assert.equal(branding.PASS_PERCENTAGE_RULE, undefined);
    assert.equal((await service.getBranding()).institution_name, 'Example College', 'No stale in-process cache');
    assert.deepEqual(service.brandingMetadata(branding), [['Institution', 'Example College']]);
  } finally { repository.values = saved; }
});
test('institution validation rejects arbitrary keys, oversized values and invalid email', () => {
  const fields = Object.fromEntries(service.FIELDS.map(f => [f.key, service.DEFAULTS[f.key]]));
  assert.equal(service.validateInstitution({ ...fields, institution_name: ' College ' }).institution_name, 'College');
  for (const mutation of [{ role: 'admin' }, { PASS_PERCENTAGE_RULE: '80' }, { institution_logo: '/any/path' }, { institution_address: 'x'.repeat(256) }, { report_footer: 'x'.repeat(256) }, { institution_name: '' }, { institution_email: 'invalid' }, { institution_phone: {} }]) assert.throws(() => service.validateInstitution({ ...fields, ...mutation }));
});
test('logo validation checks extension, MIME, real image format and re-encodes pixels', async () => {
  const buffer = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#008080' } }).png().toBuffer();
  const valid = { originalname: '../../logo.png', mimetype: 'image/png', buffer };
  const result = await service.logoImage(valid); assert.equal((await sharp(result).metadata()).format, 'png');
  for (const file of [{ ...valid, originalname: 'logo.svg' }, { ...valid, buffer: Buffer.from('<script>bad</script>') }, { ...valid, originalname: 'logo.jpg', mimetype: 'image/jpeg' }, { ...valid, buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }]) await assert.rejects(service.logoImage(file));
});

test('repository saves settings and audit atomically with explicit timestamps and current admin authority', async () => {
  const saved = { transaction: db.sequelize.transaction, account: db.AdminUser.findOne, all: db.SystemSetting.findAll, upsert: db.SystemSetting.upsert, audit: db.SettingAudit.bulkCreate };
  let values = { institution_name: 'Old' }, audits = [], failAudit = false, activeAdmin = true;
  db.sequelize.transaction = async callback => {
    const priorValues = { ...values }, priorAudits = [...audits];
    try { return await callback({ LOCK: { UPDATE: 'UPDATE' } }); }
    catch (err) { values = priorValues; audits = priorAudits; throw err; }
  };
  db.AdminUser.findOne = async options => { assert.equal(options.where.role, 'admin'); assert.equal(options.where.status, 'active'); assert.ok(options.transaction); return activeAdmin ? { admin_id: 1 } : null; };
  db.SystemSetting.findAll = async options => { assert.ok(options.lock); return Object.entries(values).map(([setting_key, setting_value]) => ({ setting_key, setting_value })); };
  db.SystemSetting.upsert = async (row, options) => { assert.ok(options.transaction); assert.ok(row.updated_at instanceof Date); values[row.setting_key] = row.setting_value; };
  db.SettingAudit.bulkCreate = async (rows, options) => { assert.ok(options.transaction); if (failAudit) throw new Error('Audit failed'); audits.push(...rows); };
  try {
    assert.equal(await repository.save({ institution_name: 'New' }, 1), 1);
    assert.deepEqual([audits[0].old_value, audits[0].new_value, audits[0].changed_by], ['Old', 'New', 1]); assert.ok(audits[0].changed_at instanceof Date);
    assert.equal(await repository.save({ institution_name: 'New' }, 1), 0); assert.equal(audits.length, 1);
    failAudit = true; await assert.rejects(repository.save({ institution_name: 'Invalid' }, 1), /Audit failed/); assert.equal(values.institution_name, 'New'); assert.equal(audits.length, 1);
    failAudit = false; activeAdmin = false; await assert.rejects(repository.save({ institution_name: 'Invalid' }, 1), /Administrator/); assert.equal(values.institution_name, 'New');
  } finally {
    db.sequelize.transaction = saved.transaction; db.AdminUser.findOne = saved.account; db.SystemSetting.findAll = saved.all; db.SystemSetting.upsert = saved.upsert; db.SettingAudit.bulkCreate = saved.audit;
  }
});

test('MySQL settings persistence, updated_at and audit history roll back without changing stored data', { skip: process.env.REPORTS_DB_TEST !== '1' }, async () => {
  const admin = await db.AdminUser.findOne({ where: { status: 'active', role: 'admin', deleted_at: null }, attributes: ['admin_id'], raw: true });
  assert.ok(admin, 'An existing active administrator is required for the rollback-only fixture');
  const realTransaction = db.sequelize.transaction.bind(db.sequelize), realValues = repository.values;
  const transaction = await realTransaction();
  try {
    const before = await realValues(service.KEYS, transaction);
    db.sequelize.transaction = async callback => callback(transaction);
    await repository.save({ institution_name: 'ROLLBACK ONLY SETTINGS TEST' }, admin.admin_id);
    const row = await db.SystemSetting.findOne({ where: { setting_key: 'institution_name' }, transaction, raw: true });
    assert.equal(row.setting_value, 'ROLLBACK ONLY SETTINGS TEST'); assert.ok(new Date(row.updated_at).getTime() > Date.now() - 60000);
    const audit = await db.SettingAudit.findOne({ where: { setting_key: 'institution_name', new_value: row.setting_value, changed_by: admin.admin_id }, transaction, raw: true });
    assert.ok(audit); assert.equal(audit.old_value, before.find(r => r.setting_key === 'institution_name')?.setting_value ?? null);
    repository.values = keys => realValues(keys, transaction);
    assert.equal((await service.getBranding()).institution_name, row.setting_value);
    await transaction.rollback();
    repository.values = realValues;
    const afterRows = await realValues(service.KEYS);
    assert.deepEqual(afterRows, before, 'Existing global settings are unchanged after the test');
  } finally {
    if (!transaction.finished) await transaction.rollback();
    db.sequelize.transaction = realTransaction; repository.values = realValues;
  }
});

test('Settings routes enforce account ownership, CSRF, admin authority, PRG and read-only policy', async () => {
  const original = { ...repository };
  const originalPasswordFind = db.AdminUser.findByPk, originalPasswordUpdate = db.AdminUser.update;
  const users = new Map([['1', { admin_id: 1, username: 'Ravi', email: 'admin@example.com', role: 'admin', status: 'active', last_login: new Date('2026-10-13') }], ['2', { admin_id: 2, username: 'Faculty User', email: 'faculty@example.com', role: 'faculty', status: 'active', last_login: null }]]);
  const values = new Map(), audits = [], writtenLogos = [];
  repository.account = async id => users.get(String(id));
  repository.values = async () => [...values].map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
  repository.audit = async () => audits;
  repository.health = async () => 'Connected';
  repository.emailTaken = async (email, id) => [...users.values()].some(u => u.email === email && u.admin_id !== Number(id));
  repository.updateEmail = async (id, email) => { users.get(String(id)).email = email; return [1]; };
  repository.save = async (updates, actor) => {
    assert.equal(Number(actor), 1);
    for (const [key, value] of Object.entries(updates)) { audits.push({ setting_key: key, old_value: values.get(key) ?? null, new_value: value, changed_by: actor, changed_at: new Date() }); values.set(key, value); if (key === 'institution_logo' && value) writtenLogos.push(value); }
  };
  const passwordHash = await bcrypt.hash('current-password', 10);
  let passwordWrites = 0;
  db.AdminUser.findByPk = async () => ({ password_hash: passwordHash });
  db.AdminUser.update = async update => { assert.ok(update.password_hash); assert.notEqual(update.password_hash, 'new-password'); passwordWrites++; };
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.set('layout', 'layouts/main'); app.use(layouts); app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'settings-test-session-secret', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { if (req.get('x-test-user')) { const u = users.get(req.get('x-test-user')); req.session.adminId = u.admin_id; req.session.username = u.username; req.session.role = u.role; } res.locals.flash = []; res.locals.breadcrumbItems = []; next(); });
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.use('/settings', require('../routes/settingsRoutes')); app.use(require('../routes/authRoutes'));
  app.use((err, req, res, next) => res.status(500).send('Unable to complete this request.'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (id, section = 'account') => {
    const response = await fetch(base + '/settings?section=' + section, { headers: { 'x-test-user': id } });
    const html = await response.text();
    return { response, html, cookie: response.headers.get('set-cookie')?.split(';')[0], token: html.match(/name="_csrf" value="([a-f0-9]{64})"/)?.[1] };
  };
  const post = (route, body, identity, extra = {}) => fetch(base + route, { method: 'POST', redirect: 'manual', headers: { Cookie: identity.cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(body) });
  try {
    assert.equal((await fetch(base + '/settings', { headers: { Accept: 'application/json' } })).status, 401);
    const admin = await get('1'), faculty = await get('2');
    assert.equal(admin.response.status, 200); assert.match(admin.html, /Ravi/); assert.match(admin.html, /Administrator/); assert.match(admin.html, /admin@example.com/); assert.ok(!admin.html.includes('password_hash'));
    assert.equal((await get('2', 'institution')).response.status, 403); assert.equal((await get('2', 'system')).response.status, 403);
    assert.equal((await fetch(base + '/profile', { headers: { Cookie: admin.cookie }, redirect: 'manual' })).headers.get('location'), '/settings?section=account');
    assert.equal((await post('/settings/account', { email: 'new@example.com' }, admin)).status, 403);
    assert.equal((await post('/settings/account', { _csrf: admin.token, email: '  NEW@example.com  ' }, admin)).status, 400); assert.equal(users.get('1').email, 'admin@example.com');
    assert.doesNotMatch(admin.html, /Email \(direct update\)/);
    for (const email of ['invalid', 'faculty@example.com']) { const r = await post('/settings/account', { _csrf: admin.token, email }, admin); assert.equal(r.status, 400); const html = await r.text(); assert.match(html, /Email changes require a verification code/); assert.ok(!html.includes('Your email address has been updated.')); }
    assert.equal((await post('/settings/account', { _csrf: admin.token, email: 'safe@example.com', role: 'admin' }, admin)).status, 400);
    const fields = Object.fromEntries(service.FIELDS.map(f => [f.key, service.DEFAULTS[f.key]]));
    assert.equal((await post('/settings/institution', { ...fields, _csrf: faculty.token }, faculty)).status, 403);
    assert.equal((await post('/settings/institution', fields, admin)).status, 403);
    assert.equal((await post('/settings/institution', { ...fields, _csrf: admin.token, PASS_PERCENTAGE_RULE: '80' }, admin)).status, 400); assert.equal(audits.length, 0);
    assert.equal((await post('/settings/institution', { ...fields, institution_name: 'Test College', _csrf: admin.token }, admin)).status, 303); assert.equal(values.get('institution_name'), 'Test College'); assert.ok(audits.every(a => a.changed_by === 1));
    const institution = await get('1', 'institution'); assert.match(institution.html, /Test College/); assert.match(institution.html, /settings-branding/);
    assert.equal((await post('/settings/institution', { ...fields, institution_name: '<script>window.injected=true</script>', _csrf: admin.token }, admin)).status, 303);
    const escaped = await get('1', 'institution'); assert.ok(escaped.html.includes('&lt;script&gt;')); assert.ok(!escaped.html.includes('<script>window.injected=true</script>'));
    const policy = await get('1', 'academic-policy'); assert.match(policy.html, /PG_2022_2024_V1/); assert.match(policy.html, /50% to below 55%/); assert.ok(!policy.html.includes('<form')); assert.equal((await post('/settings/academic-policy', { _csrf: admin.token }, admin)).status, 404);
    const system = await get('1', 'system'); assert.match(system.html, /15 MB/); assert.match(system.html, /10 MB/); assert.ok(!system.html.includes('DB_PASSWORD')); assert.ok(!system.html.includes('SESSION_SECRET'));
    const security = await get('1', 'security'); assert.match(security.html, /action="\/account-security"/);
    assert.equal((await post('/account-security', { _csrf: admin.token, role: 'admin', currentPassword: 'current-password', newPassword: 'new-password', confirmPassword: 'new-password' }, admin)).status, 400);
    assert.equal((await post('/account-security', { currentPassword: 'current-password', newPassword: 'new-password', confirmPassword: 'new-password' }, admin)).status, 403);
    const badPassword = await post('/account-security', { _csrf: admin.token, currentPassword: 'wrong', newPassword: 'new-password', confirmPassword: 'new-password' }, admin); assert.match(await badPassword.text(), /Current password is incorrect/); assert.equal(passwordWrites, 0);
    const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00aa88' } }).png().toBuffer();
    const unverified = new FormData(); unverified.set('logo', new Blob([buffer], { type: 'image/png' }), 'logo.png');
    assert.equal((await fetch(base + '/settings/logo', { method: 'POST', headers: { Cookie: admin.cookie }, body: unverified })).status, 403);
    assert.equal((await fetch(base + '/settings/logo', { method: 'POST', headers: { Cookie: faculty.cookie }, body: unverified })).status, 403);
    const logo = new FormData(); logo.set('_csrf', admin.token); logo.set('logo', new Blob([buffer], { type: 'image/png' }), 'logo.png');
    const uploaded = await fetch(base + '/settings/logo', { method: 'POST', redirect: 'manual', headers: { Cookie: admin.cookie }, body: logo }); assert.equal(uploaded.status, 303); assert.ok(service.safeLogo(values.get('institution_logo')));
    const invalidLogo = new FormData(); invalidLogo.set('_csrf', admin.token); invalidLogo.set('logo', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'logo.svg'); assert.equal((await fetch(base + '/settings/logo', { method: 'POST', headers: { Cookie: admin.cookie }, body: invalidLogo })).status, 422);
    const changedPassword = await post('/account-security', { _csrf: admin.token, currentPassword: 'current-password', newPassword: 'new-password', confirmPassword: 'new-password' }, admin); assert.equal(changedPassword.headers.get('location'), '/login?passwordChanged=1'); assert.equal(passwordWrites, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(repository, original); db.AdminUser.findByPk = originalPasswordFind; db.AdminUser.update = originalPasswordUpdate;
    for (const logo of writtenLogos) { assert.ok(service.safeLogo(logo)); await fs.unlink(path.join(__dirname, '..', logo)).catch(() => {}); }
  }
});
