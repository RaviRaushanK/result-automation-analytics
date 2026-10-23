// Exam Session management dashboard.
// Reuses the existing ExamSession model and /exam-sessions API.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ExamSession, Batch, Department, Subject, Result, ImportLog, sequelize } = require('../database/models');
const { semesterCount } = require('../public/js/academic-form-options');
const examPeriod = require('../public/js/exam-period');

const SESSION_PAGE_STYLES = ['/css/dashboard.css', '/css/batches.css', '/css/exam-sessions.css'];

// Deterministic ordering for session lists (exam period then semester sequence)
const SESSION_ORDER = [['exam_start_year', 'ASC'], ['exam_start_month', 'ASC'], ['exam_end_year', 'ASC'], ['exam_end_month', 'ASC'], ['semester', 'ASC']];

async function attachDeletionEligibility(sessions) {
  await Promise.all(sessions.map(async session => {
    const where = { exam_session_id: session.exam_session_id };
    const [subjects, results, imports] = await Promise.all([
      Subject.count({ where }), Result.count({ where }), ImportLog.count({ where })
    ]);
    const deletion = { allowed: subjects === 0 && results === 0 && imports === 0, subjects, results, imports };
    if (typeof session.setDataValue === 'function') session.setDataValue('deletion', deletion);
    else session.deletion = deletion;
  }));
  return sessions;
}

// exam_session stores a 3-letter month abbreviation, matching the existing seed/data convention
const MONTHS = [
  { value: 'Jan', label: 'January' },
  { value: 'Feb', label: 'February' },
  { value: 'Mar', label: 'March' },
  { value: 'Apr', label: 'April' },
  { value: 'May', label: 'May' },
  { value: 'Jun', label: 'June' },
  { value: 'Jul', label: 'July' },
  { value: 'Aug', label: 'August' },
  { value: 'Sep', label: 'September' },
  { value: 'Oct', label: 'October' },
  { value: 'Nov', label: 'November' },
  { value: 'Dec', label: 'December' }
];

function generateUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

// Accepts 'Jul' or 'July' (any case) → canonical 'Jul'; null when invalid
function normalizeMonth(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return null;
  const match = MONTHS.filter(m => m.value.toLowerCase() === v || m.label.toLowerCase() === v)[0];
  return match ? match.value : null;
}

// Validate and normalise semester / exam_session / exam_year.
// Returns { errors[], semester, exam_session, exam_year }.
function validateSessionFields(body) {
  const errors = [];
  const sem = String(body.semester == null ? '' : body.semester).trim();

  if (!sem) {
    errors.push('Semester is required.');
  } else if (!/^\d{1,3}$/.test(sem) || Number(sem) < 1 || Number(sem) > 600) {
    errors.push('Select a valid semester.');
  }

  const startMonth = examPeriod.month(body.exam_start_month), startYear = examPeriod.year(body.exam_start_year);
  const multi = body.spans_multiple_months === true || body.spans_multiple_months === '1' || body.spans_multiple_months === 'true';
  const endMonth = multi ? examPeriod.month(body.exam_end_month) : startMonth;
  const endYear = multi ? examPeriod.year(body.exam_end_year) : startYear;
  if (!startMonth) errors.push('Select a valid examination start month.');
  if (!startYear) errors.push('Examination start year must be a four-digit year between 1900 and 2200.');
  if (multi && !endMonth) errors.push('Select a valid examination end month.');
  if (multi && !endYear) errors.push('Examination end year must be a four-digit year between 1900 and 2200.');
  const normalized = examPeriod.normalize({ exam_start_month: startMonth, exam_start_year: startYear,
    exam_end_month: endMonth, exam_end_year: endYear });
  if (startMonth && startYear && endMonth && endYear && !normalized) errors.push('Examination end period cannot be before its start period.');
  const period = normalized || { exam_start_month: startMonth, exam_start_year: startYear,
    exam_end_month: endMonth, exam_end_year: endYear };
  return { errors, semester: /^\d+$/.test(sem) ? String(Number(sem)) : sem, ...period,
    // Compatibility columns are derived from the authoritative start period.
    exam_session: startMonth ? examPeriod.MONTHS[startMonth - 1] : null, exam_year: startYear };
}

const examSessionController = {

  // =========================
  // GET ALL SESSIONS
  // GET /exam-sessions
  // =========================
  all: async (req, res) => {
    try {
      const accept = String(req.get('Accept') || '').toLowerCase();
      const browserDocument = accept.includes('text/html') || req.get('Sec-Fetch-Dest') === 'document';
      const jsonRequest = req.query.format === 'json' || (!browserDocument && !accept.includes('text/html'));
      const includeBatch = {
        model: Batch,
        attributes: ['batch_id', 'batch_name', 'start_year', 'end_year', 'status'],
        include: [{
          model: Department,
          attributes: ['department_id', 'department_code', 'department_name']
        }]
      };

      if (jsonRequest) {
        const where = {};
        if (req.query.batch_id !== undefined && req.query.batch_id !== '') {
          where.batch_id = req.query.batch_id;
        }
        const data = await ExamSession.findAll({
          where,
          include: [includeBatch],
          order: SESSION_ORDER
        });
        await attachDeletionEligibility(data);
        return res.status(200).json({ success: true, data });
      }

      const [sessions, batches] = await Promise.all([
        ExamSession.findAll({ include: [includeBatch], order: SESSION_ORDER }),
        Batch.findAll({
          include: [{ model: Department, attributes: ['department_id', 'department_code', 'department_name'] }],
          order: [['start_year', 'DESC'], ['end_year', 'DESC'], ['batch_id', 'DESC']]
        })
      ]);
      await attachDeletionEligibility(sessions);

      return res.render('exam-sessions/index', {
        layout: 'layouts/main',
        title: 'Exam Session Management - SRAAS',
        pageStyles: SESSION_PAGE_STYLES,
        breadcrumbItems: [
          { href: '#', label: 'Academic Management' },
          { label: 'Exam Sessions' }
        ],
        sessions,
        batches
      });
    } catch (error) {
      console.error('Exam Sessions dashboard error:', error);
      if (req.query.format === 'json') {
        return res.status(500).json({ success: false, message: 'Something went wrong on the server. Please try again.' });
      }
      return res.status(500).render('errors/500', {
        layout: 'layouts/landing',
        title: 'Server Error'
      });
    }
  },

  // =========================
  // GET SESSION BY ID
  // =========================
  get: async (req, res) => {
    try {
      const data = await ExamSession.findByPk(req.params.id, {
        include: [{
          model: Batch,
          attributes: ['batch_id', 'batch_name', 'start_year', 'end_year', 'status'],
          include: [{
            model: Department,
            attributes: ['department_id', 'department_code', 'department_name']
          }]
        }]
      });

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Exam Session not found'
        });
      }

      res.status(200).json({
        success: true,
        data
      });

    } catch (error) {
      console.error('Exam Session get error:', error);
      res.status(500).json({
        success: false,
        message: 'Something went wrong on the server. Please try again.'
      });
    }
  },

  // =========================
  // CREATE SESSION
  // =========================
  create: async (req, res) => {
    try {
      const { session_uuid, batch_id } = req.body;
      const check = validateSessionFields(req.body);

      if (!batch_id) {
        return res.status(400).json({ success: false, message: 'Batch is required.' });
      }
      if (check.errors.length) {
        return res.status(400).json({ success: false, message: check.errors[0] });
      }

      const batch = await Batch.findByPk(batch_id);
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Batch not found.' });
      }
      const semesters = semesterCount(batch);
      if (!semesters || Number(check.semester) > semesters) return res.status(400).json({ success: false, message: semesters ? `Semester must be between 1 and ${semesters} for the selected batch.` : 'The batch must have valid start and end years.' });

      // Academic semester is independent of the examination sitting.
      const duplicateSemester = await ExamSession.findOne({
        where: { batch_id: batch.batch_id, semester: String(Number(check.semester)),
          exam_start_month: check.exam_start_month, exam_start_year: check.exam_start_year,
          exam_end_month: check.exam_end_month, exam_end_year: check.exam_end_year }
      });
      if (duplicateSemester) {
        return res.status(409).json({
          success: false,
          message: 'This examination session already exists for the batch and semester.'
        });
      }

      const data = await ExamSession.create({
        session_uuid: session_uuid || generateUuid(),
        batch_id: batch.batch_id,
        semester: check.semester,
        exam_session: check.exam_session,
        exam_year: check.exam_year,
        exam_start_month: check.exam_start_month,
        exam_start_year: check.exam_start_year,
        exam_end_month: check.exam_end_month,
        exam_end_year: check.exam_end_year
      });

      res.status(201).json({
        success: true,
        message: 'Exam Session created successfully',
        data
      });

    } catch (error) {
      console.error('Exam Session create error:', error);
      if (error && error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          success: false,
          message: 'This session already exists for the batch.'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Something went wrong on the server. Please try again.'
      });
    }
  },

  // =========================
  // UPDATE SESSION
  // =========================
  update: async (req, res) => {
    try {
      const outcome = await sequelize.transaction(async transaction => {
        const reject = (status, message) => ({ status, body: { success: false, message } });
        const session = await ExamSession.findByPk(req.params.id, { transaction, lock: true });
        if (!session) {
          return reject(404, 'Exam Session not found');
        }

        const check = validateSessionFields(req.body);
        if (check.errors.length) {
          return reject(400, check.errors[0]);
        }

        if (req.body.batch_id !== undefined && String(req.body.batch_id) !== String(session.batch_id)) {
          return reject(409, 'A session cannot change batch. Create a new examination session instead.');
        }
        const identityChanged = String(Number(session.semester)) !== check.semester || examPeriod.key(session) !== examPeriod.key(check);
        if (identityChanged && await Result.count({ where: { exam_session_id: session.exam_session_id }, transaction })) {
          return reject(409, 'This examination period cannot be changed because saved results already use it. For a different examination sitting, create a new examination session. If the saved historical period is incorrect, use the controlled historical-correction process so the attached results remain auditable.');
        }

        // Duplicate semester within the same batch (excluding this session)
        const duplicateSemester = await ExamSession.findOne({
          where: {
            batch_id: session.batch_id,
            semester: check.semester,
            exam_start_month: check.exam_start_month,
            exam_start_year: check.exam_start_year,
            exam_end_month: check.exam_end_month,
            exam_end_year: check.exam_end_year,
            exam_session_id: { [Op.ne]: session.exam_session_id }
          }, transaction
        });
        if (duplicateSemester) {
          return reject(409, 'This examination session already exists for the batch and semester.');
        }

        if (String(Number(session.semester)) !== check.semester && await Subject.count({ where: { exam_session_id: session.exam_session_id }, transaction })) {
          return reject(409, 'A session with configured courses cannot change academic semester. Create the correct examination session instead.');
        }
        if (String(Number(session.semester)) !== check.semester) {
          const batch = await Batch.findByPk(session.batch_id, { transaction });
          const semesters = semesterCount(batch);
          if (!semesters || Number(check.semester) > semesters) return reject(400, 'Semester is outside the selected batch duration.');
        }
        // Note: the batch association is intentionally not editable here.
        await ExamSession.update({
          semester: check.semester,
          exam_session: check.exam_session,
          exam_year: check.exam_year,
          exam_start_month: check.exam_start_month,
          exam_start_year: check.exam_start_year,
          exam_end_month: check.exam_end_month,
          exam_end_year: check.exam_end_year
        }, { where: { exam_session_id: session.exam_session_id }, transaction });

        const data = await ExamSession.findByPk(session.exam_session_id, { transaction });

        return { status: 200, body: {
          success: true,
          message: 'Exam Session updated successfully',
          data
        } };
      });
      return res.status(outcome.status).json(outcome.body);

    } catch (error) {
      console.error('Exam Session update error:', error);
      if (error && error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          success: false,
          message: 'This session already exists for the batch.'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Something went wrong on the server. Please try again.'
      });
    }
  },

  // =========================
  // DELETE SESSION
  // =========================
  delete: async (req, res) => {
    try {
      const outcome = await sequelize.transaction(async transaction => {
        const session = await ExamSession.findByPk(req.params.id, { transaction, lock: true });
        if (!session) return { status: 404, body: { success: false, message: 'Exam Session not found.' } };
        const where = { exam_session_id: session.exam_session_id };
        const [subjects, results, imports] = await Promise.all([
          Subject.count({ where, transaction }),
          Result.count({ where, transaction }),
          ImportLog.count({ where, transaction })
        ]);
        if (subjects || results || imports) {
          const dependencies = [
            subjects ? `${subjects} configured subject${subjects === 1 ? '' : 's'}` : '',
            results ? `${results} saved result${results === 1 ? '' : 's'}` : '',
            imports ? `${imports} upload/import record${imports === 1 ? '' : 's'}` : ''
          ].filter(Boolean).join(', ');
          return { status: 409, body: { success: false,
            message: `This examination session cannot be deleted because it has ${dependencies}. Preserve it for academic history. Only a completely unused session can be deleted.` } };
        }
        await ExamSession.destroy({ where, transaction });
        return { status: 200, body: { success: true, message: 'Unused examination session deleted successfully.' } };
      });
      return res.status(outcome.status).json(outcome.body);

    } catch (error) {
      console.error('Exam Session delete error:', error);
      if (error && (error.name === 'SequelizeForeignKeyConstraintError' || error.parent?.code === 'ER_ROW_IS_REFERENCED_2')) {
        return res.status(409).json({ success: false, message: 'This examination session gained dependent academic records and cannot be deleted. Refresh the page and review the session.' });
      }
      res.status(500).json({
        success: false,
        message: 'Something went wrong on the server. Please try again.'
      });
    }
  }
};

module.exports = examSessionController;
module.exports._test = { validateSessionFields, normalizeMonth };
