'use strict';
const { Op } = require('sequelize');
const { AdminUser, AdminOtp } = require('../database/models');
const repository = require('../repositories/settingsRepository');
const policy = require('./academicPolicy');
const otpService = require('./otpService');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const sharp = require('sharp');
const limits = require('../config/uploadLimits');
const metadata = require('../package.json');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = Object.freeze([
  { key: 'institution_name', label: 'Institution Name', required: true, limit: 120 },
  { key: 'institution_short_name', label: 'Short Name', required: true, limit: 40 },
  { key: 'institution_address', label: 'Address', limit: 255, multiline: true },
  { key: 'institution_phone', label: 'Phone', limit: 50 },
  { key: 'institution_email', label: 'Contact Email', limit: 100, email: true },
  { key: 'report_footer', label: 'Report Footer', limit: 255, multiline: true }
]);
const DEFAULTS = Object.freeze({ institution_name: 'SRAAS', institution_short_name: 'SRAAS', institution_address: '', institution_phone: '', institution_email: '', report_footer: '', institution_logo: '' });
const KEYS = Object.freeze(Object.keys(DEFAULTS));
const safeLogo = value => typeof value === 'string' && /^\/uploads\/branding\/[a-f0-9-]{36}\.png$/.test(value);
const validation = errors => Object.assign(new Error('Please correct the highlighted fields.'), { status: 422, errors });
function allowFields(body, allowed) {
  if (Object.keys(body || {}).some(key => !allowed.includes(key))) throw Object.assign(new Error('Unsupported settings field.'), { status: 400 });
}
function validateInstitution(body) {
  allowFields(body, [...FIELDS.map(field => field.key), '_csrf']);
  const values = {}, errors = {};
  for (const field of FIELDS) {
    const raw = body[field.key];
    if (typeof raw !== 'string') { errors[field.key] = 'Enter a text value.'; continue; }
    const value = raw.trim(); values[field.key] = value;
    if (field.required && !value) errors[field.key] = `${field.label} is required.`;
    else if (value.length > field.limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) errors[field.key] = `Use at most ${field.limit} characters without control characters.`;
    else if (field.email && value && !emailPattern.test(value)) errors[field.key] = 'Enter a valid email address.';
  }
  if (Object.keys(errors).length) throw validation(errors);
  return values;
}
async function getBranding() {
  const values = { ...DEFAULTS };
  for (const row of await repository.values(KEYS)) {
    const value = String(row.setting_value ?? '').trim();
    const field = FIELDS.find(field => field.key === row.setting_key);
    if (row.setting_key === 'institution_logo') { if (safeLogo(value)) values.institution_logo = value; }
    else if (field && value.length <= field.limit && (!field.required || value) && (!field.email || !value || emailPattern.test(value))) values[row.setting_key] = value;
  }
  return values;
}
async function saveInstitution(body, actor) { return repository.save(validateInstitution(body), actor); }
async function updateEmail(body, actor) {
  allowFields(body, ['email', '_csrf']);
  throw Object.assign(new Error('Email changes require a verification code. Use the email verification form.'), { status: 400 });
}
const mobilePattern = /^\+[1-9][0-9]{7,14}$/;

async function mobileTaken(mobile, id) {
  return Boolean(await AdminUser.findOne({ where: { mobile, admin_id: { [Op.ne]: id } }, attributes: ['admin_id'], paranoid: false }));
}

async function requestChangeEmail(body, adminId) {
  allowFields(body, ['new_email', '_csrf']);
  const checked = require('../public/js/accountEmailValidation').validate(body.new_email);
  if (!checked.valid) {
    throw validation({ new_email: checked.message });
  }
  const newEmail = checked.value;
  const admin = await AdminUser.findByPk(adminId);
  if (!admin) throw Object.assign(new Error('Account not found.'), { status: 404 });
  if (admin.email === newEmail) throw validation({ new_email: 'This is already your registered email address.' });
  if (await repository.emailTaken(newEmail, adminId)) {
    throw validation({ new_email: 'This email address is already used by another account.' });
  }
  try { await require('./emailValidationService').validateDeliverable(newEmail); }
  catch (error) {
    if (error.status === 422) throw validation({ new_email: error.message });
    error.errors = { new_email: error.message };
    throw error;
  }
  const result = await otpService.createAndSendOtp({ adminId, type: 'email_change', targetValue: newEmail });
  return { notice: 'A verification code has been sent to your new email address.', ...result };
}

async function verifyChangeEmail(body, adminId) {
  allowFields(body, ['otp', '_csrf', 'kind']);
  const code = typeof body.otp === 'string' ? body.otp.trim() : '';
  if (!code || !/^\d{6}$/.test(code)) throw validation({ otp: 'Enter the 6-digit verification code.' });

  const otp = await AdminOtp.findOne({
    where: { admin_id: adminId, type: 'email_change', is_used: 0 },
    order: [['created_at', 'DESC']]
  });
  if (!otp) throw Object.assign(new Error('Invalid or expired verification code.'), { status: 400 });
  const result = await otpService.verifyOtp({ adminId, type: 'email_change', code });
  const checked = require('../public/js/accountEmailValidation').validate(result.targetValue);
  if (!checked.valid) throw validation({ new_email: checked.message });
  const targetEmail = checked.value;

  const [updated] = await AdminUser.update({ email: targetEmail, email_verified_at: new Date(), updated_at: new Date() }, { where: { admin_id: adminId, deleted_at: null, status: 'active' } });
  if (!updated) throw Object.assign(new Error('Failed to update email address.'), { status: 500 });
  return { notice: 'Your email address has been updated successfully.' };
}

async function requestChangeMobile(body, adminId) {
  allowFields(body, ['new_mobile', 'countryCode', '_csrf']);
  let newMobile = typeof body.new_mobile === 'string' ? body.new_mobile.trim() : '';
  if (body.countryCode !== undefined) {
    const country = require('../public/js/countryCodes').find(item => item.label === body.countryCode);
    if (!country || !/^\d{4,14}$/.test(newMobile)) throw validation({ new_mobile: 'Select a country and enter your mobile number using digits only, without the country code.' });
    newMobile = country.dial + newMobile;
  }
  if (!mobilePattern.test(newMobile)) {
    throw validation({ new_mobile: 'Enter a mobile number with its country code, for example +919876543210.' });
  }
  const admin = await AdminUser.findByPk(adminId);
  if (!admin) throw Object.assign(new Error('Account not found.'), { status: 404 });
  if (admin.mobile === newMobile) throw validation({ new_mobile: 'This is already your registered mobile number.' });
  if (await mobileTaken(newMobile, adminId)) {
    throw validation({ new_mobile: 'This mobile number is already used by another account.' });
  }
  const result = await otpService.createAndSendOtp({ adminId, type: 'mobile_change', targetValue: newMobile });
  return { notice: 'A verification code has been sent to your new mobile number.', ...result };
}

async function verifyChangeMobile(body, adminId) {
  allowFields(body, ['otp', '_csrf', 'kind']);
  const code = typeof body.otp === 'string' ? body.otp.trim() : '';
  if (!code || !/^\d{6}$/.test(code)) throw validation({ otp: 'Enter the 6-digit verification code.' });

  const otp = await AdminOtp.findOne({
    where: { admin_id: adminId, type: 'mobile_change', is_used: 0 },
    order: [['created_at', 'DESC']]
  });
  if (!otp) throw Object.assign(new Error('Invalid or expired verification code.'), { status: 400 });
  const result = await otpService.verifyOtp({ adminId, type: 'mobile_change', code });
  const targetMobile = result.targetValue;

  const [updated] = await AdminUser.update({ mobile: targetMobile, mobile_verified_at: new Date(), updated_at: new Date() }, { where: { admin_id: adminId, deleted_at: null, status: 'active' } });
  if (!updated) throw Object.assign(new Error('Failed to update mobile number.'), { status: 500 });
  return { notice: 'Your mobile number has been updated successfully.' };
}

async function logoImage(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  if (!file || file.buffer.length > limits.institutionLogo || types[ext] !== file.mimetype) throw validation({ logo: 'Choose a PNG, JPEG or WebP image up to 2 MB.' });
  try {
    const image = sharp(file.buffer, { limitInputPixels: 4000000, animated: false });
    const info = await image.metadata();
    if (info.format !== { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[file.mimetype] || info.pages > 1 || !info.width || !info.height) throw new Error('Invalid image');
    return await image.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw validation({ logo: 'The uploaded file is not a supported, readable image.' }); }
}
async function saveLogo(body, file, actor) {
  allowFields(body, ['_csrf', 'remove_logo']);
  if (body.remove_logo === '1' && !file) return repository.save({ institution_logo: '' }, actor);
  if (body.remove_logo !== undefined) throw Object.assign(new Error('Invalid logo request.'), { status: 400 });
  const image = await logoImage(file);
  const filename = crypto.randomUUID() + '.png';
  const directory = path.resolve(__dirname, '../uploads/branding');
  const destination = path.join(directory, filename);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(destination, image, { flag: 'wx' });
  try { return await repository.save({ institution_logo: '/uploads/branding/' + filename }, actor); }
  catch (err) { await fs.unlink(destination).catch(() => {}); throw err; }
}
async function academicPolicy() {
  const grades = Object.entries(policy.POINTS).map(([grade, points]) => {
    const percentages = Array.from({ length: 101 }, (_, n) => n).filter(n => policy.gradeFromPercent(n).grade === grade);
    const lower = Math.min(...percentages), upper = Math.max(...percentages) + 1;
    return { grade, points, band: percentages.length ? upper > 100 ? `${lower}% and above` : `${lower}% to below ${upper}%` : '-' };
  });
  const reference = (await fs.readFile(path.join(__dirname, '../docs/academic-result-semantics.md'), 'utf8')).split('## File Manifest')[0];
  // Normalize each maximum to 100 to describe percentages using the same
  // thresholds helper used by result validation, without evaluating any marks.
  const passingRequirements = [
    { label: 'Theory and laboratory', subjectType: 'theory' },
    ...['project', 'internship', 'seminar', 'dissertation', 'viva'].map(subjectType => ({ label: subjectType[0].toUpperCase() + subjectType.slice(1), subjectType }))
  ].map(({ label, subjectType }) => {
    const limits = policy.passRules.thresholds({ subject_type: subjectType, max_internal: 100, max_external: 100, max_marks: 100 });
    return { label, internal: limits.internal, external: limits.external, combined: limits.total };
  });
  return { scheme: policy.SCHEME, examTypes: policy.NEW_EXAM_TYPES, grades, reference, passingRequirements };
}
async function systemInformation() {
  return { application: metadata.description, version: metadata.version, node: process.version,
    environment: ['development', 'test', 'production'].includes(process.env.NODE_ENV) ? process.env.NODE_ENV : 'Not specified', database: await repository.health(),
    resultLimit: limits.resultPdf / 1024 / 1024, revaluationLimit: limits.revaluationPdf / 1024 / 1024, studentLimit: limits.studentImport / 1024 / 1024 };
}
function brandingMetadata(branding) {
  return [['Institution', 'institution_name'], ['Institution Short Name', 'institution_short_name'], ['Institution Address', 'institution_address'], ['Institution Phone', 'institution_phone'], ['Institution Email', 'institution_email'], ['Report Footer', 'report_footer']]
    .filter(([, key]) => branding[key] && branding[key] !== DEFAULTS[key]).map(([label, key]) => [label, branding[key]]);
}
module.exports = { FIELDS, DEFAULTS, KEYS, safeLogo, allowFields, validateInstitution, getBranding, saveInstitution, updateEmail, requestChangeEmail, verifyChangeEmail, requestChangeMobile, verifyChangeMobile, logoImage, saveLogo, academicPolicy, systemInformation, brandingMetadata };
