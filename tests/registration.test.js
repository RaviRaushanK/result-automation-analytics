'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const ejs = require('ejs');
const db = require('../database/models');
const service = require('../services/registrationService');
const sms = require('../services/smsService');
const email = require('../services/emailService');
after(() => db.sequelize.close());

test('SMS fails closed without configuration and uses the provider without exposing codes', async () => {
  const keys = ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  try {
    for (const key of keys) delete process.env[key];
    await assert.rejects(sms.sendOtpSms('+919876543210', 'test'), { status: 503 });
    Object.assign(process.env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM: '+15555550100' });
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++; assert.match(url, /^https:\/\/api\.twilio\.com\//);
      assert.equal(options.body.get('To'), '+919876543210');
      assert.equal(options.body.get('Body'), 'test');
      assert.equal(options.body.get('From'), '+15555550100');
      assert.ok(options.signal); assert.match(options.headers.Authorization, /^Basic /);
      return { ok: true, json: async () => ({ sid: 'SM-test', status: 'queued' }) };
    };
    assert.deepEqual(await sms.sendOtpSms('+919876543210', 'test'), { messageId: 'SM-test' });
    await assert.rejects(sms.sendOtpSms('9876543210', 'test'), { status: 400 });
    assert.equal(calls, 1);
    global.fetch = async () => ({ ok: false, json: async () => ({ message: 'secret provider error' }) });
    await assert.rejects(sms.sendOtpSms('+919876543210', 'test'), error => error.status === 503 && !error.message.includes('secret'));
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ code: 21606, message: 'private provider details' }) });
    await assert.rejects(sms.sendOtpSms('+919876543210', 'test'), error => error.status === 503 && error.providerCode === 21606 && error.message.includes('TWILIO_FROM') && !error.message.includes('private'));
    global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ code: 572002 }) });
    await assert.rejects(sms.sendOtpSms('+919876543210', 'test'), error => error.status === 503 && error.providerCode === 572002 && error.message.includes('assigned to this verified recipient'));
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('all registration views render escaped values and accessible verification forms', async () => {
  for (const stage of ['details', 'verify', 'complete', 'unavailable']) {
    const html = await ejs.renderFile(require('node:path').join(__dirname, '../views/auth/register.ejs'), {
      stage, error: null, notice: null, csrfToken: 'a'.repeat(64), email: '<script>alert(1)</script>', mobile: '******3210', emailVerified: false, mobileVerified: true
    });
    assert.doesNotMatch(html, /<script>alert/);
    if (stage === 'verify') { assert.match(html, /action="\/register\/send"/); assert.match(html, /name="otp"/); assert.match(html, /Verified/); }
  }
});

test('registration rejects malformed submissions before sending or creating accounts', async () => {
  const input = { username: 'valid-user', mobile: '+919876543210', password: 'long-password-123', confirmPassword: 'long-password-123' };
  for (const change of [{ username: {} }, { mobile: '9876543210' }, { password: 'short' }, { password: 'é'.repeat(37) }, { confirmPassword: 'different' }]) {
    await assert.rejects(service.start('a'.repeat(64), 'b'.repeat(64), { ...input, ...change }), { status: 400 });
  }
  await assert.rejects(service.inspect('invalid'), { status: 403 });
  await assert.rejects(service.start('a'.repeat(64), 'b'.repeat(64), { ...input, countryCode: 'Invalid country' }), { status: 400 });
  await assert.rejects(service.start('a'.repeat(64), 'b'.repeat(64), { ...input, countryCode: 'India (+91)', mobile: '+919876543210' }), { status: 400 });
  await assert.rejects(service.verify('a'.repeat(64), 'b'.repeat(64), 'email', 'abc'), { status: 400 });
});

test('contact-change codes go to the new contact for initial delivery and resends', async () => {
  const otp = require('../services/otpService');
  const saved = { create: db.AdminOtp.create, update: db.AdminOtp.update, find: db.AdminOtp.findOne, count: db.AdminOtp.count, admin: db.AdminUser.findByPk, email: email.sendOtpEmail, sms: sms.sendOtpSms };
  let emailTo, smsTo, active;
  try {
    db.AdminUser.findByPk = async () => ({ email: 'old@example.com', mobile: '+15555550100' });
    db.AdminOtp.update = async () => [1];
    db.AdminOtp.create = async row => { active = { ...row, id: 1, created_at: new Date(Date.now() - 61000), resend_at: new Date(Date.now() - 61000) }; };
    db.AdminOtp.findOne = async () => active;
    db.AdminOtp.count = async () => 1;
    email.sendOtpEmail = async to => { emailTo = to; };
    sms.sendOtpSms = async to => { smsTo = to; };
    await otp.createAndSendOtp({ adminId: 1, type: 'email_change', targetValue: 'new@example.com' });
    assert.equal(emailTo, 'new@example.com');
    emailTo = null; await otp.resendOtp({ adminId: 1, type: 'email_change' }); assert.equal(emailTo, 'new@example.com');
    await otp.createAndSendOtp({ adminId: 1, type: 'mobile_change', targetValue: '+919876543210' });
    assert.equal(smsTo, '+919876543210');
    smsTo = null; await otp.resendOtp({ adminId: 1, type: 'mobile_change' }); assert.equal(smsTo, '+919876543210');
  } finally {
    db.AdminOtp.create = saved.create; db.AdminOtp.update = saved.update; db.AdminOtp.findOne = saved.find; db.AdminOtp.count = saved.count;
    db.AdminUser.findByPk = saved.admin; email.sendOtpEmail = saved.email; sms.sendOtpSms = saved.sms;
  }
});

test('HTTP registration requires invitations, CSRF and current administrator authority', async () => {
  const invitationEmail = require('../services/invitationEmailService');
  const originalInvitationSend = invitationEmail.send;
  let mailSent = false;
  invitationEmail.send = async (to, url) => { assert.equal(to, 'approved@example.com'); assert.ok(url.includes('/register?token=')); mailSent = true; };
  const express = require('express'), session = require('express-session'), layouts = require('express-ejs-layouts');
  const repository = require('../repositories/settingsRepository');
  const saved = { inspect: service.inspect, invite: service.invite, start: service.start, state: service.state, account: repository.account };
  const token = 'd'.repeat(64);
  let inviteCalls = 0, starts = 0;
  service.inspect = async value => { assert.equal(value, token); return { email: 'invited@example.com' }; };
  service.invite = async (actor, address) => { inviteCalls++; assert.equal(actor, 1); assert.equal(address, 'approved@example.com'); return '/register?token=' + token; };
  service.start = async (value, secret) => { starts++; assert.equal(value, token); assert.match(secret, /^[a-f0-9]{64}$/); };
  service.state = async () => ({ email: 'invited@example.com', mobile: '+919876543210', emailVerified: false, mobileVerified: false });
  repository.account = async id => ({ admin_id: id, username: 'approver', role: id === 1 ? 'admin' : 'faculty', status: 'active' });
  const app = express(); app.set('view engine', 'ejs'); app.set('views', require('node:path').join(__dirname, '../views')); app.set('layout', 'layouts/main');
  app.use(layouts); app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-registration-secret', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { if (req.get('x-test-user')) req.session.adminId = Number(req.get('x-test-user')); res.locals.flash = []; res.locals.breadcrumbItems = []; next(); });
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.use(require('../routes/authRoutes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/invitations', { headers: { Accept: 'application/json' } })).status, 401);
    assert.equal((await fetch(base + '/invitations', { headers: { 'x-test-user': '2' } })).status, 403);
    const admin = await fetch(base + '/invitations', { headers: { 'x-test-user': '1' } });
    const adminHtml = await admin.text(), adminCookie = admin.headers.get('set-cookie').split(';')[0];
    const csrf = adminHtml.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    const post = (path, cookie, data) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
    assert.equal((await post('/invitations', adminCookie, { email: 'approved@example.com' })).status, 403); assert.equal(inviteCalls, 0);
    const created = await post('/invitations', adminCookie, { _csrf: csrf, email: 'approved@example.com' });
    assert.equal(created.status, 200); assert.match(await created.text(), /Invitation created/); assert.equal(inviteCalls, 1);
    assert.equal(mailSent, true);
    invitationEmail.send = async () => { throw Object.assign(new Error('SMTP unavailable'), { status: 503 }); };
    const failedEmail = await post('/invitations', adminCookie, { _csrf: csrf, email: 'approved@example.com' });
    const failedHtml = await failedEmail.text();
    assert.equal(failedEmail.status, 503); assert.match(failedHtml, /email could not be sent/);
    assert.match(failedHtml, /id="invitation-link"/); assert.doesNotMatch(failedHtml, /email was accepted/);
    const enter = await fetch(base + '/register?token=' + token, { redirect: 'manual' });
    assert.equal(enter.status, 303); assert.equal(enter.headers.get('location'), '/register'); assert.equal(enter.headers.get('referrer-policy'), 'no-referrer');
    const cookie = enter.headers.get('set-cookie').split(';')[0];
    const details = await fetch(base + '/register', { headers: { Cookie: cookie } }); const html = await details.text();
    const registrationCsrf = html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    assert.equal(details.headers.get('cache-control'), 'no-store'); assert.match(html, /invited@example.com/); assert.ok(!html.includes(token));
    assert.equal((await post('/register', cookie, {})).status, 403); assert.equal(starts, 0);
    assert.equal((await post('/register', cookie, { _csrf: registrationCsrf })).status, 303); assert.equal(starts, 1);
    const verifyPage = await fetch(base + '/register', { headers: { Cookie: cookie } });
    assert.match(await verifyPage.text(), /action="\/register\/verify"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    service.inspect = saved.inspect; service.invite = saved.invite; service.start = saved.start; service.state = saved.state; repository.account = saved.account;
    invitationEmail.send = originalInvitationSend;
  }
});

test('database: dual verification, expiry, limits, session binding, single use and rollback', { skip: process.env.REGISTRATION_DB_TEST !== '1' }, async () => {
  const emailValidation = require('../services/emailValidationService');
  const originalDomainCheck = emailValidation.validateDeliverable;
  emailValidation.validateDeliverable = async value => value;
  const originalTransaction = db.sequelize.transaction.bind(db.sequelize);
  const originalEmail = email.sendOtpEmail, originalSms = sms.sendOtpSms;
  const suffix = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const sentinel = new Error('ROLLBACK_TEST');
  let activeTransaction;
  const sent = {};
  let failSms = false;
  email.sendOtpEmail = async (to, subject, text) => { sent.email = text.match(/\b\d{6}\b/)[0]; return { accepted: [to] }; };
  sms.sendOtpSms = async (to, text) => { if (failSms) throw new Error('delivery failed'); sent.sms = text.match(/\b\d{6}\b/)[0]; return { messageId: 'test' }; };
  try {
    await assert.rejects(originalTransaction(async transaction => {
      activeTransaction = transaction;
      // All operations use one real MySQL transaction; every fixture is rolled back.
      db.sequelize.transaction = async callback => callback(transaction);
      const actor = await db.AdminUser.create({ admin_uuid: crypto.randomUUID(), username: 'test-actor-' + suffix,
        email: `actor-${suffix}@example.com`, password_hash: await bcrypt.hash('test-password-123', 4), role: 'admin', status: 'active' }, { transaction });
      async function registration(label) {
        const emailAddress = `${label}-${suffix}@example.com`;
        const path = await service.invite(actor.admin_id, emailAddress);
        const token = path.split('token=')[1];
        await service.start(token, secret, { username: `${label}-${suffix}`, countryCode: 'India (+91)', mobile: '9876543210', password: 'test-password-123', confirmPassword: 'test-password-123' });
        const row = await db.AccountInvitation.findOne({ where: { email: emailAddress }, transaction });
        return { token, row, emailAddress };
      }
      const first = await registration('dual');
      assert.notEqual(first.row.token_hash, first.token);
      assert.ok(await bcrypt.compare('test-password-123', first.row.registration.password_hash));
      await assert.rejects(service.state(first.token, 'c'.repeat(64)), { status: 410 });
      await service.send(first.token, secret, 'email');
      const oldEmailCode = sent.email;
      await first.row.reload({ transaction });
      assert.ok(await bcrypt.compare(oldEmailCode, first.row.registration.email.hash));
      assert.ok(!JSON.stringify(first.row.registration).includes(`"${oldEmailCode}"`));
      await assert.rejects(service.send(first.token, secret, 'email'), { status: 429 });
      assert.deepEqual(await service.verify(first.token, secret, 'email', oldEmailCode), { complete: false });
      assert.equal(await db.AdminUser.count({ where: { email: first.emailAddress }, transaction }), 0, 'email verification alone cannot create account');
      await assert.rejects(service.verify(first.token, secret, 'email', oldEmailCode), { status: 400 });
      await service.send(first.token, secret, 'sms');
      assert.deepEqual(await service.verify(first.token, secret, 'sms', sent.sms), { complete: true });
      const account = await db.AdminUser.findOne({ where: { email: first.emailAddress }, transaction });
      assert.equal(account.status, 'active'); assert.ok(account.email_verified_at); assert.ok(account.mobile_verified_at);
      assert.ok(await bcrypt.compare('test-password-123', account.password_hash));
      const settings = require('../services/settingsService');
      const changedEmail = `changed-${suffix}@example.com`;
      const methods = [];
      for (const [model, name, optionIndex] of [[db.AdminUser, 'findByPk', 1], [db.AdminUser, 'findOne', 0], [db.AdminUser, 'update', 1], [db.AdminOtp, 'update', 1], [db.AdminOtp, 'create', 1], [db.AdminOtp, 'findOne', 0]]) {
        const original = model[name]; methods.push([model, name, original]);
        model[name] = function (...args) { args[optionIndex] = { ...args[optionIndex], transaction }; return original.apply(this, args); };
      }
      try {
        await settings.requestChangeEmail({ new_email: changedEmail }, account.admin_id);
        await account.reload({ transaction }); assert.equal(account.email, first.emailAddress, 'email remains unchanged before verification');
        await settings.verifyChangeEmail({ otp: sent.email, kind: 'email' }, account.admin_id);
        await account.reload({ transaction }); assert.equal(account.email, changedEmail); assert.ok(account.email_verified_at);
        await settings.requestChangeMobile({ new_mobile: '+15555550123' }, account.admin_id);
        await account.reload({ transaction }); assert.equal(account.mobile, '+919876543210', 'mobile remains unchanged before verification');
        await settings.verifyChangeMobile({ otp: sent.sms, kind: 'mobile' }, account.admin_id);
        await account.reload({ transaction }); assert.equal(account.mobile, '+15555550123'); assert.ok(account.mobile_verified_at);
      } finally { for (const [model, name, original] of methods) model[name] = original; }
      await first.row.reload({ transaction }); assert.equal(first.row.registration, null); assert.ok(first.row.accepted_at);
      await assert.rejects(service.verify(first.token, secret, 'sms', sent.sms), { status: 410 });

      const limited = await registration('limited');
      await service.send(limited.token, secret, 'sms');
      await limited.row.reload({ transaction });
      let r = structuredClone(limited.row.registration); r.sms.expires_at = Date.now() - 1;
      await limited.row.update({ registration: r }, { transaction });
      await assert.rejects(service.verify(limited.token, secret, 'sms', sent.sms), { status: 400 });
      r = structuredClone(limited.row.registration); r.sms.expires_at = Date.now() + 60000;
      await limited.row.update({ registration: r }, { transaction });
      const wrongCode = sent.sms === '000000' ? '111111' : '000000';
      await assert.rejects(service.verify(limited.token, secret, 'sms', wrongCode), { status: 400 });
      await limited.row.reload({ transaction });
      assert.equal(limited.row.registration.sms.attempts, 1, 'failed guesses must commit');
      r = structuredClone(limited.row.registration); r.sms.sent_at = Date.now() - 61000;
      await limited.row.update({ registration: r }, { transaction });
      const previousCode = sent.sms;
      await service.send(limited.token, secret, 'sms');
      await limited.row.reload({ transaction }); assert.equal(limited.row.registration.sms.attempts, 1);
      // Test replacement using the stored hashes (random codes can very rarely coincide).
      assert.ok(await bcrypt.compare(sent.sms, limited.row.registration.sms.hash));
      if (previousCode !== sent.sms) await assert.rejects(service.verify(limited.token, secret, 'sms', previousCode), { status: 400 });
      await limited.row.reload({ transaction }); r = structuredClone(limited.row.registration); r.sms.attempts = 5; r.sms.sent_at = 0;
      await limited.row.update({ registration: r }, { transaction });
      await assert.rejects(service.verify(limited.token, secret, 'sms', sent.sms), { status: 429 });
      await assert.rejects(service.send(limited.token, secret, 'sms'), { status: 429 });

      const failed = await registration('failure'); failSms = true;
      await assert.rejects(service.send(failed.token, secret, 'sms'), { status: 503 }); failSms = false;
      await failed.row.reload({ transaction }); assert.equal(failed.row.registration.sms.hash, null); assert.equal(failed.row.registration.sms.sends, 1);
      r = structuredClone(failed.row.registration); r.sms.sends = 4; r.sms.sent_at = 0;
      await failed.row.update({ registration: r }, { transaction });
      await assert.rejects(service.send(failed.token, secret, 'sms'), { status: 429 });
      r = structuredClone(failed.row.registration); r.expires_at = Date.now() - 1;
      await failed.row.update({ registration: r }, { transaction });
      await assert.rejects(service.state(failed.token, secret), { status: 410 });

      const revoked = await registration('revoked');
      await service.invite(actor.admin_id, revoked.emailAddress);
      await assert.rejects(service.inspect(revoked.token), { status: 410 });
      const expired = await registration('expired');
      await expired.row.update({ expires_at: new Date(Date.now() - 1000) }, { transaction });
      await assert.rejects(service.inspect(expired.token), { status: 410 });
      await actor.update({ status: 'inactive' }, { transaction });
      await assert.rejects(service.invite(actor.admin_id, 'denied@example.com'), { status: 403 });
      throw sentinel;
    }), error => error === sentinel);
    assert.equal(activeTransaction.finished, 'rollback');
  } finally {
    db.sequelize.transaction = originalTransaction;
    emailValidation.validateDeliverable = originalDomainCheck;
    email.sendOtpEmail = originalEmail; sms.sendOtpSms = originalSms;
  }
});
