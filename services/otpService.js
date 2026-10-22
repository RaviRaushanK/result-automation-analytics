'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { AdminOtp, AdminUser } = require('../database/models');
const emailService = require('./emailService');
const smsService = require('./smsService');

const OTP_LENGTH = 6;
const OTP_TTL_MS = 2 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESENDS = 3;

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local + '@' + domain;
  return local[0] + '*'.repeat(local.length - 1) + '@' + domain;
}

function maskMobile(mobile) {
  if (!mobile) return mobile;
  const len = mobile.length;
  if (len <= 4) return '*'.repeat(len);
  return '*'.repeat(len - 4) + mobile.slice(-4);
}

async function invalidatePreviousOtps(adminId, type) {
  await AdminOtp.update(
    { is_used: 1 },
    { where: { admin_id: adminId, type, is_used: 0 } }
  );
}

async function deliverOtp(admin, type, targetValue, code) {
  const text = `SRAAS: Your verification code is ${code}. It expires in 2 minutes. Do not share it.`;
  if (type === 'mobile_change') {
    if (!targetValue) throw Object.assign(new Error('A new mobile number is required.'), { status: 400 });
    return smsService.sendOtpSms(targetValue, text);
  } else if (type === 'email_change' || type === 'password_reset') {
    const to = type === 'email_change' ? targetValue : admin.email;
    if (!to) throw Object.assign(new Error('An email address is required.'), { status: 400 });
    await emailService.sendOtpEmail(to, 'SRAAS verification code', text, undefined);
  } else throw Object.assign(new Error('Unsupported verification type.'), { status: 400 });
}

async function createAndSendOtp({ adminId, type, targetValue }) {
  await invalidatePreviousOtps(adminId, type);

  const admin = await AdminUser.findByPk(adminId);
  if (!admin) throw Object.assign(new Error('Account not found.'), { status: 404 });

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const challenge = await AdminOtp.create({
    admin_id: adminId,
    otp_hash: otpHash,
    type,
    target_value: targetValue || null,
    expires_at: expiresAt,
    attempts: 0,
    max_attempts: 5,
    is_used: 0,
    resend_at: new Date()
  });

  try {
    const delivery = await deliverOtp(admin, type, targetValue, otp);
    if (delivery?.verificationSid) await AdminOtp.update({ otp_hash: 'twilio-verify:' + delivery.verificationSid }, { where: { id: challenge.id } });
  } catch (error) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: challenge.id } });
    throw error;
  }
  const destination = type === 'password_reset' ? admin.email : targetValue;
  const label = type === 'mobile_change' ? 'mobile' : 'email';

  return {
    ok: true,
    maskedDestination: label === 'email' ? maskEmail(destination) : maskMobile(destination),
    ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendInSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000)
  };
}

async function resendOtp({ adminId, type }) {
  const { Op } = require('sequelize');
  const otp = await AdminOtp.findOne({
    where: { admin_id: adminId, type, is_used: 0 },
    order: [['created_at', 'DESC']]
  });

  if (!otp) {
    throw Object.assign(new Error('No active verification session found. Please request a new code.'), { status: 404 });
  }

  if (otp.expires_at < new Date()) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });
    throw Object.assign(new Error('The verification code has expired. Please request a new one.'), { status: 410 });
  }

  const now = new Date();
  const lastSent = otp.resend_at ? new Date(otp.resend_at) : new Date(otp.created_at);
  if (now - lastSent < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now - lastSent)) / 1000);
    throw Object.assign(new Error(`Please wait ${waitSeconds} seconds before requesting another code.`), { status: 429 });
  }

  const resendCount = await AdminOtp.count({
    where: { admin_id: adminId, type, created_at: { [Op.gte]: new Date(otp.created_at) } }
  });
  if (resendCount >= MAX_RESENDS + 1) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });
    throw Object.assign(new Error('Maximum resend attempts reached. Please try again later.'), { status: 429 });
  }

  const admin = await AdminUser.findByPk(adminId);
  if (!admin) throw Object.assign(new Error('Account not found.'), { status: 404 });

  const newOtp = generateOtp();
  const otpHash = await bcrypt.hash(newOtp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });
  const challenge = await AdminOtp.create({
    admin_id: adminId,
    otp_hash: otpHash,
    type,
    target_value: otp.target_value,
    expires_at: expiresAt,
    attempts: 0,
    max_attempts: 5,
    is_used: 0,
    resend_at: new Date()
  });

  try {
    const delivery = await deliverOtp(admin, type, otp.target_value, newOtp);
    if (delivery?.verificationSid) await AdminOtp.update({ otp_hash: 'twilio-verify:' + delivery.verificationSid }, { where: { id: challenge.id } });
  } catch (error) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: challenge.id } });
    throw error;
  }
  const destination = type === 'password_reset' ? admin.email : otp.target_value;
  const label = type === 'mobile_change' ? 'mobile' : 'email';

  return {
    ok: true,
    maskedDestination: label === 'email' ? maskEmail(destination) : maskMobile(destination),
    ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendInSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000)
  };
}

async function verifyOtp({ adminId, type, code }) {
  const { Op } = require('sequelize');
  const otp = await AdminOtp.findOne({
    where: { admin_id: adminId, type, is_used: 0 },
    order: [['created_at', 'DESC']]
  });

  if (!otp) {
    throw Object.assign(new Error('Invalid or expired verification code.'), { status: 400 });
  }

  if (otp.expires_at < new Date()) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });
    throw Object.assign(new Error('The verification code has expired. Please request a new one.'), { status: 410 });
  }

  if (otp.attempts >= otp.max_attempts) {
    await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });
    throw Object.assign(new Error('Too many verification attempts. Please request a new code.'), { status: 429 });
  }

  const isMatch = type === 'mobile_change' && otp.otp_hash.startsWith('twilio-verify:')
    ? await require('./twilioVerifyService').check(otp.otp_hash.slice('twilio-verify:'.length), code)
    : await bcrypt.compare(code, otp.otp_hash);
  if (!isMatch) {
    await AdminOtp.increment('attempts', { where: { id: otp.id } });
    const remaining = otp.max_attempts - (otp.attempts + 1);
    throw Object.assign(new Error(`Incorrect verification code. ${remaining} attempt(s) remaining.`), { status: 400 });
  }

  await AdminOtp.update({ is_used: 1 }, { where: { id: otp.id } });

  const admin = await AdminUser.findByPk(adminId);
  if (!admin) throw Object.assign(new Error('Account not found.'), { status: 404 });

  return { ok: true, admin, targetValue: otp.target_value };
}

async function cleanupExpiredOtps() {
  const { Op } = require('sequelize');
  await AdminOtp.update({ is_used: 1 }, { where: { expires_at: { [Op.lt]: new Date() }, is_used: 0 } });
}

module.exports = {
  generateOtp,
  maskEmail,
  maskMobile,
  createAndSendOtp,
  resendOtp,
  verifyOtp,
  cleanupExpiredOtps,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_RESENDS
};
