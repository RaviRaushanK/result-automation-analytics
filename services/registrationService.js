'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, AccountInvitation, AdminUser } = require('../database/models');
const emailService = require('./emailService');
const smsService = require('./smsService');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const emailAddress = value => {
  const result = require('../public/js/accountEmailValidation').validate(value);
  if (!result.valid) throw fail(result.message);
  return result.value;
};
function validInvitation(row) {
  if (!row || row.accepted_at || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) throw fail('This invitation is invalid, expired, or already used.', 410);
  emailAddress(row.email);
}
async function locked(token, action) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('An invitation is required.', 403);
  return sequelize.transaction(async transaction => {
    const row = await AccountInvitation.findOne({ where: { token_hash: hash(token) }, transaction, lock: transaction.LOCK.UPDATE });
    validInvitation(row);
    return action(row, transaction);
  });
}
async function invite(actorId, rawEmail) {
  const email = emailAddress(rawEmail);
  await require('./emailValidationService').validateDeliverable(email);
  const token = crypto.randomBytes(32).toString('hex');
  await sequelize.transaction(async transaction => {
    const actor = await AdminUser.findOne({ where: { admin_id: actorId, role: 'admin', status: 'active', deleted_at: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!actor) throw fail('Administrator access is required.', 403);
    if (await AdminUser.findOne({ where: { email }, transaction })) throw fail('An account already uses this email address.', 409);
    if (await AccountInvitation.count({ where: { invited_by: actorId, created_at: { [Op.gte]: new Date(Date.now() - 3600000) } }, transaction }) >= 20) throw fail('Invitation limit reached. Try again in one hour.', 429);
    await AccountInvitation.update({ revoked_at: new Date(), registration: null }, { where: { email, accepted_at: null, revoked_at: null }, transaction });
    await AccountInvitation.create({ id: crypto.randomUUID(), token_hash: hash(token), email, invited_by: actorId,
      expires_at: new Date(Date.now() + 7 * 86400000), created_at: new Date() }, { transaction });
  });
  return '/register?token=' + token;
}
async function inspect(token) { return locked(token, row => ({ email: row.email })); }
function pending(row, secret) {
  const r = row.registration;
  if (!r || typeof secret !== 'string' || r.browser_hash !== hash(secret) || r.expires_at <= Date.now()) throw fail('Your registration session has expired. Ask your administrator for a new invitation.', 410);
  // Sequelize must receive a new JSON value to detect and persist changes.
  return structuredClone(r);
}
async function start(token, secret, input) {
  const unsupported = Object.keys(input || {}).filter(key => !['_csrf', 'username', 'countryCode', 'mobile', 'password', 'confirmPassword'].includes(key));
  if (unsupported.length) {
    // Field names only: never log submitted passwords, tokens or contact values.
    console.warn('[registration] Unsupported form fields:', unsupported.map(key => key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)));
    throw fail('Unsupported registration field. Refresh the registration page and try again. The email address is taken from your invitation.');
  }
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  let mobile = typeof input.mobile === 'string' ? input.mobile.trim() : '';
  if (input.countryCode !== undefined) {
    const country = require('../public/js/countryCodes').find(item => item.label === input.countryCode);
    if (!country || !/^\d{4,14}$/.test(mobile)) throw fail('Select a country from the list and enter your mobile number without the country code.');
    mobile = country.dial + mobile;
  }
  const password = input.password;
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw fail('Use 3–50 letters, numbers, dots, underscores or hyphens for your username.');
  if (!/^\+[1-9]\d{7,14}$/.test(mobile)) throw fail('Enter your mobile number with its country code, for example +919876543210.');
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw fail('Use a password of at least 12 characters and at most 72 UTF-8 bytes.');
  if (password !== input.confirmPassword) throw fail('The passwords do not match.');
  if (typeof secret !== 'string' || secret.length !== 64) throw fail('A registration session is required.', 403);
  // Check invitation validity before performing expensive password hashing.
  await inspect(token);
  const passwordHash = await bcrypt.hash(password, 12);
  await locked(token, async (row, transaction) => {
    if (row.registration) throw fail('Registration has already started. Continue in the original browser or request a new invitation.', 409);
    if (await AdminUser.findOne({ where: { [Op.or]: [{ username }, { email: row.email }] }, transaction })) throw fail('The username or email is already registered.', 409);
    await row.update({ registration: { username, mobile, password_hash: passwordHash, browser_hash: hash(secret), expires_at: Date.now() + 30 * 60000,
      email: { attempts: 0, sends: 0 }, sms: { attempts: 0, sends: 0 } } }, { transaction });
  });
}
async function state(token, secret) {
  return locked(token, row => {
    const r = pending(row, secret);
    return { email: row.email, mobile: r.mobile, emailVerified: Boolean(r.email.verified_at), mobileVerified: Boolean(r.sms.verified_at) };
  });
}
async function send(token, secret, channel) {
  if (!['email', 'sms'].includes(channel)) throw fail('Unknown verification method.');
  return locked(token, async (row, transaction) => {
    const r = pending(row, secret), c = r[channel];
    if (c.verified_at) throw fail('This contact is already verified.');
    if (c.attempts >= 5 || c.sends >= 4) throw fail('Verification limit reached. Request a new invitation.', 429);
    if (c.sent_at && Date.now() - c.sent_at < 60000) throw fail('Wait 60 seconds before requesting another code.', 429);
    const code = crypto.randomInt(100000, 1000000).toString();
    c.hash = await bcrypt.hash(code, 10);
    c.expires_at = Date.now() + 5 * 60000;
    c.sent_at = Date.now(); c.sends++;
    try {
      if (channel === 'email') await emailService.sendOtpEmail(row.email, 'SRAAS registration verification', `Your email verification code is ${code}. It expires in 5 minutes. Do not share it.`, undefined);
      else {
        const delivery = await smsService.sendOtpSms(r.mobile, `SRAAS: Your mobile verification code is ${code}. It expires in 5 minutes. Do not share it.`);
        c.providerSid = delivery?.verificationSid || null;
        if (c.providerSid) c.hash = null;
      }
    } catch (error) {
      c.hash = null; c.providerSid = null; c.expires_at = null;
      await row.update({ registration: r }, { transaction });
      return { error: fail(error.status === 503 ? error.message : 'The verification code could not be sent. Please try again later.', 503) };
    }
    await row.update({ registration: r }, { transaction });
    return { ok: true };
  }).then(result => { if (result.error) throw result.error; return result; });
}
async function verify(token, secret, channel, code) {
  if (!['email', 'sms'].includes(channel) || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw fail('Enter a 6-digit verification code.');
  const result = await locked(token, async (row, transaction) => {
    const r = pending(row, secret), c = r[channel];
    if (c.verified_at) throw fail('This contact is already verified.');
    if (c.attempts >= 5) throw fail('Verification limit reached. Request a new invitation.', 429);
    if ((!c.hash && !c.providerSid) || c.expires_at <= Date.now()) throw fail('The code has expired or has not been sent. Request another code.');
    c.attempts++;
    const matches = channel === 'sms' && c.providerSid
      ? await require('./twilioVerifyService').check(c.providerSid, code)
      : await bcrypt.compare(code, c.hash);
    if (!matches) {
      await row.update({ registration: r }, { transaction });
      return { error: fail('Incorrect verification code.', c.attempts >= 5 ? 429 : 400) };
    }
    c.verified_at = new Date().toISOString(); c.hash = null;
    if (!r.email.verified_at || !r.sms.verified_at) {
      await row.update({ registration: r }, { transaction });
      return { complete: false };
    }
    await AdminUser.create({ admin_uuid: crypto.randomUUID(), username: r.username, email: emailAddress(row.email), mobile: r.mobile,
      password_hash: r.password_hash, role: 'admin', status: 'active', email_verified_at: new Date(r.email.verified_at), mobile_verified_at: new Date(r.sms.verified_at) }, { transaction });
    await row.update({ accepted_at: new Date(), registration: null }, { transaction });
    return { complete: true };
  });
  if (result.error) throw result.error;
  return result;
}
module.exports = { invite, inspect, start, state, send, verify };
