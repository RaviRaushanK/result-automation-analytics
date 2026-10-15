'use strict';
const repository = require('../repositories/settingsRepository');
const policy = require('./academicPolicy');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const sharp = require('sharp');
const limits = require('../config/uploadLimits');
const metadata = require('../package.json');

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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailPattern.test(email) || email.length > 100) throw validation({ email: 'Enter a valid email address of at most 100 characters.' });
  if (await repository.emailTaken(email, actor)) throw validation({ email: 'This email address is already used by another account.' });
  try {
    const [updated] = await repository.updateEmail(actor, email);
    if (!updated) throw Object.assign(new Error('Your active account was not found.'), { status: 403 });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw validation({ email: 'This email address is already used by another account.' });
    throw err;
  }
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
  return { scheme: policy.SCHEME, examTypes: policy.EXAM_TYPES, grades, reference };
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
module.exports = { FIELDS, DEFAULTS, KEYS, safeLogo, allowFields, validateInstitution, getBranding, saveInstitution, updateEmail, logoImage, saveLogo, academicPolicy, systemInformation, brandingMetadata };
