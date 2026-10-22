'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../database/models');
const email = require('../services/emailService');
const otp = require('../services/otpService');
const controller = require('../controllers/authController');
after(() => db.sequelize.close());

test('SMTP authentication failures are actionable and never exposed as raw provider errors', async () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalCreate = nodemailer.createTransport, originalLog = console.error;
  const logs = []; let sendError = Object.assign(new Error('raw provider details'), { code: 'EAUTH', responseCode: 535 });
  try {
    for (const key of keys) delete process.env[key];
    console.error = (...args) => logs.push(JSON.stringify(args));
    await assert.rejects(email.sendOtpEmail('test@example.com', 'test', 'secret OTP 123456'), { status: 503, code: 'EMAIL_DELIVERY_FAILED' });
    Object.assign(process.env, { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'sender@example.com', SMTP_PASS: 'abcd efgh ijkl mnop', SMTP_FROM: 'sender@example.com' });
    nodemailer.createTransport = options => {
      assert.equal(options.auth.pass, 'abcdefghijklmnop'); assert.equal(options.secure, false); assert.equal(options.requireTLS, true);
      return { sendMail: async () => { if (sendError) throw sendError; return { accepted: ['test@example.com'] }; } };
    };
    await assert.rejects(email.sendOtpEmail('test@example.com', 'test', 'secret OTP 123456'), error => error.status === 503 && error.code === 'EMAIL_AUTH_FAILED' && !error.message.includes('raw provider'));
    assert.match(logs.join('\n'), /App Password/); assert.doesNotMatch(logs.join('\n'), /123456|abcdefghijklmnop|raw provider details/);
    sendError = null;
    assert.deepEqual(await email.sendOtpEmail('test@example.com', 'test', 'code'), { accepted: ['test@example.com'] });
  } finally {
    nodemailer.createTransport = originalCreate; console.error = originalLog;
    for (const key of keys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  }
});

test('failed initial and resent emails invalidate their newly generated codes', async () => {
  const saved = { admin: db.AdminUser.findByPk, create: db.AdminOtp.create, update: db.AdminOtp.update, find: db.AdminOtp.findOne, count: db.AdminOtp.count, send: email.sendOtpEmail };
  const writes = []; let nextId = 1;
  const authError = email.deliveryError({ code: 'EAUTH' });
  try {
    db.AdminUser.findByPk = async () => ({ email: 'account@example.com' });
    db.AdminOtp.create = async () => ({ id: nextId++ });
    db.AdminOtp.update = async (values, options) => { writes.push({ values, where: options.where }); return [1]; };
    db.AdminOtp.findOne = async () => ({ id: 99, expires_at: new Date(Date.now() + 60000), created_at: new Date(Date.now() - 61000), resend_at: new Date(Date.now() - 61000) });
    db.AdminOtp.count = async () => 1;
    email.sendOtpEmail = async () => { throw authError; };
    await assert.rejects(otp.createAndSendOtp({ adminId: 1, type: 'password_reset' }), { code: 'EMAIL_AUTH_FAILED' });
    assert.deepEqual(writes.at(-1), { values: { is_used: 1 }, where: { id: 1 } });
    await assert.rejects(otp.resendOtp({ adminId: 1, type: 'password_reset' }), { code: 'EMAIL_AUTH_FAILED' });
    assert.deepEqual(writes.at(-1), { values: { is_used: 1 }, where: { id: 2 } });
  } finally {
    db.AdminUser.findByPk = saved.admin; db.AdminOtp.create = saved.create; db.AdminOtp.update = saved.update; db.AdminOtp.findOne = saved.find; db.AdminOtp.count = saved.count; email.sendOtpEmail = saved.send;
  }
});

test('forgot password shows delivery failure and the normal verification/reset flow succeeds', async () => {
  const saved = { find: db.AdminUser.findOne, pk: db.AdminUser.findByPk, update: db.AdminUser.update, otpUpdate: db.AdminOtp.update, send: otp.createAndSendOtp, verify: otp.verifyOtp, log: console.error };
  const admin = { admin_id: 42, email: 'account@example.com', status: 'active' };
  let view, data, status, passwordHash;
  const res = { status(value) { status = value; return this; }, render(name, values) { view = name; data = values; return this; } };
  const req = { body: { email: '  ACCOUNT@example.com ' }, session: {} };
  try {
    console.error = () => {};
    db.AdminUser.findOne = async options => { assert.equal(options.where.email, 'account@example.com'); return admin; };
    otp.createAndSendOtp = async () => { throw email.deliveryError({ code: 'EAUTH' }); };
    await controller.forgotPassword(req, res);
    assert.equal(status, 503); assert.equal(view, 'auth/forgot-password'); assert.match(data.error, /not authenticated/);
    otp.createAndSendOtp = async () => ({ maskedDestination: 'a******@example.com', ttlSeconds: 120, resendInSeconds: 60 });
    await controller.forgotPassword(req, res); assert.equal(view, 'auth/verify-otp'); assert.equal(data.adminId, 42);
    otp.verifyOtp = async args => { assert.equal(args.code, '123456'); return { admin }; };
    req.body = { adminId: '42', otp: '123456' };
    await controller.verifyResetOtp(req, res); assert.equal(view, 'auth/reset-password'); assert.equal(req.session.pendingPasswordReset, 42);
    db.AdminUser.findByPk = async () => admin;
    db.AdminUser.update = async values => { passwordHash = values.password_hash; return [1]; };
    db.AdminOtp.update = async () => [1];
    req.body = { adminId: '42', newPassword: 'new-long-password', confirmPassword: 'new-long-password' };
    await controller.resetPassword(req, res);
    assert.ok(await bcrypt.compare('new-long-password', passwordHash)); assert.equal(view, 'auth/login'); assert.equal(data.passwordChanged, true); assert.equal(req.session.pendingPasswordReset, null);
  } finally {
    db.AdminUser.findOne = saved.find; db.AdminUser.findByPk = saved.pk; db.AdminUser.update = saved.update; db.AdminOtp.update = saved.otpUpdate; otp.createAndSendOtp = saved.send; otp.verifyOtp = saved.verify; console.error = saved.log;
  }
});
