'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/models');
const registration = require('../services/registrationService');
after(() => db.sequelize.close());

test('MySQL concurrent activations create only one account per faculty record', { skip: process.env.REGISTRATION_DB_TEST !== '1' }, async () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  let department, faculty, actor;
  const invitations = [];
  try {
    department = await db.Department.create({ department_uuid: crypto.randomUUID(), department_code: 'race-' + suffix, department_name: 'Registration race fixture' });
    faculty = await db.Faculty.create({ faculty_uuid: crypto.randomUUID(), department_id: department.department_id, faculty_code: ('RACE' + suffix).toUpperCase(), faculty_name: 'Concurrent registration fixture' });
    const passwordHash = await bcrypt.hash('test-password-123', 4);
    actor = await db.AdminUser.create({ admin_uuid: crypto.randomUUID(), username: 'race-admin-' + suffix, email: `race-admin-${suffix}@example.com`, password_hash: passwordHash, role: 'admin' });
    const secret = crypto.randomBytes(32).toString('hex');
    const code = '123456';
    for (let i = 0; i < 2; i++) {
      const token = crypto.randomBytes(32).toString('hex');
      // Deliberately simulate overlapping legacy/racing invitations. Each
      // activation must independently enforce the single faculty account rule.
      const row = await db.AccountInvitation.create({ id: crypto.randomUUID(), token_hash: hash(token), email: `race-${i}-${suffix}@example.com`, faculty_id: faculty.faculty_id, invited_by: actor.admin_id, created_at: new Date(), expires_at: new Date(Date.now() + 60000),
        registration: { username: `race-${i}-${suffix}`, password_hash: passwordHash, faculty_code: faculty.faculty_code, browser_hash: hash(secret), expires_at: Date.now() + 60000,
          email: { attempts: 0, sends: 1, hash: await bcrypt.hash(code, 4), expires_at: Date.now() + 60000 } } });
      invitations.push({ row, token });
    }
    const results = await Promise.allSettled(invitations.map(({ token }) => registration.verify(token, secret, 'email', code)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, results.map(result => result.reason?.message).join('; '));
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.equal(await db.AdminUser.count({ where: { faculty_id: faculty.faculty_id } }), 1);
    const account = await db.AdminUser.findOne({ where: { faculty_id: faculty.faculty_id } });
    assert.equal(account.role, 'faculty');
    for (const { row } of invitations) await row.reload();
    assert.equal(invitations.filter(({ row }) => row.accepted_at).length, 1);
    assert.equal((await actor.reload()).role, 'admin');
  } finally {
    for (const { row } of invitations) await row.destroy({ force: true });
    if (faculty) await db.AdminUser.destroy({ where: { faculty_id: faculty.faculty_id }, force: true });
    if (actor) await actor.destroy({ force: true });
    if (faculty) await faculty.destroy({ force: true });
    if (department) await department.destroy({ force: true });
  }
});
