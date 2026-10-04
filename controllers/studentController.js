// Student Management Dashboard controller.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Student, Batch } = require('../database/models');

const emailValidation = require('../public/js/student-email-validation');
const USN_REGEX = /^[A-Za-z0-9][A-Za-z0-9/-]{2,49}$/;
const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]{1,99}$/;
const BATCH_ORDER = [['start_year', 'DESC'], ['end_year', 'DESC'], ['batch_id', 'DESC']];

async function filteredBatchId(query) {
  if (query && query.batch_id) return query.batch_id;
  const latest = await Batch.findOne({ attributes: ['batch_id'], order: BATCH_ORDER });
  return latest ? latest.batch_id : null;
}

function studentSaveError(err) {
  const labels = { usn: 'USN', email: 'Email', batch_id: 'Batch', student_name: 'Student Name', category: 'Category', status: 'Status' };
  const items = Array.isArray(err.errors) ? err.errors : [];
  if (err.name === 'SequelizeUniqueConstraintError') {
    const fields = [...new Set(items.map((item) => item.path).filter(Boolean))];
    if (!fields.length && err.fields) fields.push(...Object.keys(err.fields));
    return { status: 400, message: fields.length
      ? fields.map((field) => (labels[field] || field) + ' is already registered. Use a different value or check existing/deleted student records.').join('; ')
      : 'A student with this USN or email is already registered. Check existing/deleted student records.' };
  }
  if (err.name === 'SequelizeValidationError') {
    const messages = items.map((item) => {
      const label = labels[item.path] || item.path || 'Student';
      if (item.type === 'notNull Violation') return label + ' is required.';
      return label + ': ' + (item.message || 'Please enter a valid value.');
    });
    return { status: 400, message: messages.length ? [...new Set(messages)].join('; ')
      : 'Student details could not be validated. Check all required fields and their formats.' };
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return { status: 400, message: 'The selected batch is no longer available. Select an existing batch and try again.' };
  }
  return { status: 500, message: 'Unable to save student data. Please try again or contact the administrator.' };
}

function normalizeCategory(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

async function resolveBatchId(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { batch_id: null, error: 'Batch is required' };
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const batch = await Batch.findByPk(raw);
    if (!batch) return { batch_id: null, error: 'Batch not found: ' + raw };
    return { batch_id: batch.batch_id, batch_name: batch.batch_name };
  }
  const batch = await Batch.findOne({ where: { batch_name: raw } });
  if (batch) return { batch_id: batch.batch_id, batch_name: batch.batch_name };
  const all = await Batch.findAll({ attributes: ['batch_id', 'batch_name'] });
  const match = all.find((b) => String(b.batch_name).toLowerCase() === raw.toLowerCase());
  if (match) return { batch_id: match.batch_id, batch_name: match.batch_name };
  return { batch_id: null, error: 'Batch not found: ' + raw };
}

async function validateStudentInput(input, opts) {
  opts = opts || {};
  const errors = [];
  const batchRef = (input.batch_id !== undefined && input.batch_id !== null && String(input.batch_id).trim() !== '')
    ? input.batch_id
    : (input.batch !== undefined ? input.batch : input.batch_name);
  const resolved = await resolveBatchId(batchRef);
  if (!resolved.batch_id) errors.push(resolved.error);
  const usn = String(input.usn || '').trim();
  if (!usn) errors.push('USN is required');
  else if (!USN_REGEX.test(usn)) errors.push('USN must be 3-50 characters, start with a letter or number, and contain only letters, numbers, / or -');
  const student_name = String(input.student_name || input.name || '').trim();
  if (!student_name) errors.push('Student Name is required');
  else if (!NAME_REGEX.test(student_name)) errors.push('Student Name must be 2-100 characters, start with a letter, and contain only letters, spaces, dots, apostrophes or hyphens');
  let email = String(input.email || '').trim();
  const emailError = emailValidation.getError(email);
  if (emailError) errors.push(emailError);
  if (!email) email = null;
  const category = normalizeCategory(input.category);
  if (!category) errors.push('Category is required');
  else if (category.length > 50) errors.push('Category must contain no more than 50 characters');
  let status = String(input.status || 'active').trim().toLowerCase();
  if (status !== 'active' && status !== 'inactive') errors.push("Status must be 'active' or 'inactive'");
  const value = { batch_id: resolved.batch_id, batch_name: resolved.batch_name || null,
    usn: usn, student_name: student_name, email: email, category: category, status: status };
  if (usn) {
    const where = { usn: usn };
    if (opts.ignoreStudentId) where.student_id = { [Op.ne]: opts.ignoreStudentId };
    const dup = await Student.findOne({ where: where, attributes: ['student_id'], paranoid: false });
    if (dup) errors.push('Duplicate USN: ' + usn + ' already exists');
  }
  if (email) {
    const where = { email: email };
    if (opts.ignoreStudentId) where.student_id = { [Op.ne]: opts.ignoreStudentId };
    const dupMail = await Student.findOne({ where: where, attributes: ['student_id'], paranoid: false });
    if (dupMail) errors.push('Duplicate Email: ' + email + ' already exists');
  }
  return { value: value, errors: errors };
}

// Preview rows kept in-memory per import session (no DB writes before confirm).
function pickField(row, names) {
  const keys = Object.keys(row || {});
  for (const n of names) {
    const hit = keys.find((k) => String(k).trim().toLowerCase() === n);
    if (hit !== undefined) return row[hit];
  }
  return '';
}

function hasAnyField(row, names) {
  const keys = Object.keys(row || {}).map((k) => String(k).trim().toLowerCase());
  return names.some((name) => keys.includes(name));
}

function missingImportColumns(rawRows) {
  const firstRow = rawRows[0] || {};
  const required = [
    { label: 'USN', names: ['usn'] },
    { label: 'Student Name', names: ['student name', 'student_name', 'name'] },
    { label: 'Email', names: ['email', 'e-mail', 'mail'] },
    { label: 'Category', names: ['category'] }
  ];
  return required.filter((col) => !hasAnyField(firstRow, col.names)).map((col) => col.label);
}

async function buildImportPreview(rawRows, opts) {
  opts = opts || {};
  const seenUsn = new Set();
  const seenEmail = new Set();
  const preview = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i] || {};
    const input = {
      batch_id: opts.batch_id,
      usn: pickField(row, ['usn']),
      student_name: pickField(row, ['student name', 'student_name', 'name']),
      email: pickField(row, ['email', 'e-mail', 'mail']),
      category: pickField(row, ['category']),
      status: opts.status
    };
    const checked = await validateStudentInput(input);
    const rowErrors = checked.errors.slice();
    const usnKey = String(checked.value.usn || '').toUpperCase();
    if (usnKey && seenUsn.has(usnKey)) rowErrors.push('Duplicate USN in file: ' + checked.value.usn);
    if (usnKey) seenUsn.add(usnKey);
    const emailKey = String(checked.value.email || '').toLowerCase();
    if (emailKey && seenEmail.has(emailKey)) rowErrors.push('Duplicate Email in file: ' + checked.value.email);
    if (emailKey) seenEmail.add(emailKey);
    preview.push({ row: i + 1,
      batch: checked.value.batch_name || '', batch_id: checked.value.batch_id,
      usn: checked.value.usn, student_name: checked.value.student_name,
      email: checked.value.email || '', category: checked.value.category,
      status: checked.value.status, valid: rowErrors.length === 0,
      message: rowErrors.length ? rowErrors.join('; ') : 'Valid' });
  }
  return preview;
}

const studentController = {
  index: async (req, res) => {
    const base = {
      layout: 'layouts/main',
      title: 'Students - SRAAS',
      pageStyles: ['/css/dashboard.css', '/css/students.css'],
      breadcrumbItems: [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/students', label: 'Students' }
      ]
    };
    try {
      const batches = await Batch.findAll({
        attributes: ['batch_id', 'batch_name'],
        order: BATCH_ORDER, raw: true
      });
      const cats = await Student.findAll({
        attributes: ['category'],
        where: { category: { [Op.ne]: null } },
        group: ['category'], order: [['category', 'ASC']], raw: true
      });
      res.render('students/index', { ...base, batches: batches,
        categories: cats.map((c) => c.category).filter(Boolean),
        initialSearch: req.query.search || '' });
    } catch (err) {
      console.error('Students render error:', err);
      res.render('students/index', { ...base, batches: [], categories: [], initialSearch: '' });
    }
  },

  // Student Search page — intentionally empty content (sidebar/layout unchanged).
  search: async (req, res) => {
    res.render('students/search', {
      layout: 'layouts/main',
      title: 'Student Search - SRAAS',
      pageStyles: ['/css/dashboard.css', '/css/students.css'],
      breadcrumbItems: [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/students/search', label: 'Student Search' }
      ]
    });
  },

  list: async (req, res) => {
    try {
      const q = req.query || {};
      const search = (q.search || '').trim();
      const batchId = await filteredBatchId(q);
      if (!batchId) return res.json({ success: true, data: [] });
      const where = { batch_id: batchId };
      if (q.category) where.category = q.category;
      if (q.status) where.status = String(q.status).toLowerCase();
      if (search) {
        const like = '%' + search + '%';
        where[Op.or] = [
          { usn: { [Op.like]: like } },
          { student_name: { [Op.like]: like } },
          { email: { [Op.like]: like } }
        ];
      }
      const students = await Student.findAll({
        where: where,
        include: [{ model: Batch, attributes: ['batch_id', 'batch_name'] }],
        order: [['usn', 'ASC'], ['student_id', 'ASC']], limit: 500
      });
      res.json({ success: true, data: students });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  stats: async (req, res) => {
    try {
      const batchId = await filteredBatchId(req.query);
      const students = batchId ? await Student.findAll({
        attributes: ['category', 'status'], where: { batch_id: batchId }, raw: true
      }) : [];
      const total = students.length;
      const active = students.filter((student) => student.status === 'active').length;
      const inactive = students.filter((student) => student.status === 'inactive').length;
      const categories = new Set(students.map((student) => student.category).filter(Boolean)).size;
      res.json({ success: true, data: { total, active, inactive, categories } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  categories: async (req, res) => {
    try {
      const rows = await Student.findAll({ attributes: ['category'],
        where: { category: { [Op.ne]: null } },
        group: ['category'], order: [['category', 'ASC']], raw: true });
      res.json({ success: true, data: rows.map((r) => r.category).filter(Boolean) });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  get: async (req, res) => {
    try {
      const data = await Student.findByPk(req.params.id, {
        include: [{ model: Batch, attributes: ['batch_id', 'batch_name'] }]
      });
      if (!data) return res.status(404).json({ success: false, message: 'Student not found' });
      res.json({ success: true, data: data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const checked = await validateStudentInput(req.body || {});
      if (checked.errors.length) return res.status(400).json({ success: false, message: checked.errors.join('; ') });
      const v = checked.value;
      const data = await Student.create({ student_uuid: crypto.randomUUID(),
        batch_id: v.batch_id, usn: v.usn, student_name: v.student_name,
        email: v.email, category: v.category, status: v.status });
      res.status(201).json({ success: true, message: 'Student created successfully', data: data });
    } catch (err) {
      const error = studentSaveError(err);
      res.status(error.status).json({ success: false, message: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const existing = await Student.findByPk(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Student not found' });
      const checked = await validateStudentInput(req.body || {}, { ignoreStudentId: existing.student_id });
      if (checked.errors.length) return res.status(400).json({ success: false, message: checked.errors.join('; ') });
      const v = checked.value;
      await existing.update({ batch_id: v.batch_id, usn: v.usn, student_name: v.student_name,
        email: v.email, category: v.category, status: v.status });
      res.json({ success: true, message: 'Student updated successfully', data: existing });
    } catch (err) {
      const error = studentSaveError(err);
      res.status(error.status).json({ success: false, message: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      const deleted = await Student.destroy({ where: { student_id: req.params.id } });
      if (!deleted) return res.status(404).json({ success: false, message: 'Student not found' });
      res.json({ success: true, message: 'Student deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  importPreview: async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'Please upload an .xlsx, .xls or .csv file' });
      const importBatchId = String((req.body && req.body.batch_id) || '').trim();
      const importStatus = String((req.body && req.body.status) || '').trim().toLowerCase();
      if (!importBatchId) return res.status(400).json({ success: false, message: 'Please select a batch before importing' });
      if (importStatus !== 'active' && importStatus !== 'inactive') {
        return res.status(400).json({ success: false, message: "Please select a valid status: active or inactive" });
      }
      const XLSX = require('xlsx');
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) return res.status(400).json({ success: false, message: 'No data found in the uploaded file' });
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      if (!rawRows.length) return res.status(400).json({ success: false, message: 'No data rows found in the uploaded file' });
      const missingColumns = missingImportColumns(rawRows);
      if (missingColumns.length) {
        return res.status(400).json({ success: false,
          message: 'Missing required column(s): ' + missingColumns.join(', ') + '. Please cross verify the file and try again.' });
      }
      const preview = await buildImportPreview(rawRows, { batch_id: importBatchId, status: importStatus });
      const valid = preview.filter((r) => r.valid).length;
      res.json({ success: true, data: { total: preview.length, valid: valid,
        invalid: preview.length - valid, rows: preview } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to parse file: ' + err.message });
    }
  },

  importConfirm: async (req, res) => {
    try {
      const importBatchId = String((req.body && req.body.batch_id) || '').trim();
      const importStatus = String((req.body && req.body.status) || '').trim().toLowerCase();
      if (!importBatchId) return res.status(400).json({ success: false, message: 'Please select a batch before importing' });
      if (importStatus !== 'active' && importStatus !== 'inactive') {
        return res.status(400).json({ success: false, message: "Please select a valid status: active or inactive" });
      }
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      const validRows = rows.filter((r) => r && r.valid);
      if (!validRows.length) return res.status(400).json({ success: false, message: 'No valid records to import' });
      let imported = 0;
      const skipped = [];
      const seenUsn = new Set();
      const seenEmail = new Set();
      for (const r of validRows) {
        try {
          const usnKey = String(r.usn || '').toUpperCase();
          if (usnKey && seenUsn.has(usnKey)) {
            skipped.push({ row: r.row, usn: r.usn, reason: 'Duplicate USN in file: ' + r.usn });
            continue;
          }
          if (usnKey) seenUsn.add(usnKey);
          const emailKey = String(r.email || '').toLowerCase();
          if (emailKey && seenEmail.has(emailKey)) {
            skipped.push({ row: r.row, usn: r.usn, reason: 'Duplicate Email in file: ' + r.email });
            continue;
          }
          if (emailKey) seenEmail.add(emailKey);
          const checked = await validateStudentInput({
            batch_id: importBatchId, usn: r.usn, student_name: r.student_name,
            email: r.email, category: r.category, status: importStatus });
          if (checked.errors.length) {
            skipped.push({ row: r.row, usn: r.usn, reason: checked.errors.join('; ') });
            continue;
          }
          const v = checked.value;
          await Student.create({ student_uuid: crypto.randomUUID(),
            batch_id: v.batch_id, usn: v.usn, student_name: v.student_name,
            email: v.email, category: v.category, status: v.status });
          imported++;
        } catch (e) {
          skipped.push({ row: r.row, usn: r.usn, reason: studentSaveError(e).message });
        }
      }
      res.json({ success: true,
        message: 'Import completed. Successfully imported: ' + imported + ', Skipped: ' + skipped.length,
        data: { imported: imported, skipped: skipped.length, skippedRows: skipped } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};

module.exports = studentController;
