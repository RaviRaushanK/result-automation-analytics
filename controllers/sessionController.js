// Session management dashboard.
// Reuses the existing ResultSession model and /sessions API.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ResultSession, Batch, Department, Subject } = require('../database/models');

const SESSION_PAGE_STYLES = ['/css/dashboard.css', '/css/batches.css', '/css/sessions.css'];

// Deterministic ordering for session lists (exam period then semester sequence)
const SESSION_ORDER = [['exam_year', 'ASC'], ['exam_session', 'ASC'], ['semester', 'ASC']];

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
  const rawMonth = String(body.exam_session == null ? '' : body.exam_session).trim();
  const month = normalizeMonth(rawMonth);
  const year = Number(body.exam_year);

  if (!sem) {
    errors.push('Semester is required.');
  } else if (!/^\d{1,2}$/.test(sem) || Number(sem) < 1 || Number(sem) > 24) {
    errors.push('Semester must be a number between 1 and 24.');
  }

  if (!rawMonth) {
    errors.push('Starting month is required.');
  } else if (!month) {
    errors.push('Starting month is invalid.');
  }

  if (body.exam_year === undefined || body.exam_year === null || body.exam_year === '') {
    errors.push('Exam year is required.');
  } else if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    errors.push('Exam year must be a valid year.');
  }

  return { errors, semester: /^\d+$/.test(sem) ? String(Number(sem)) : sem, exam_session: month, exam_year: year };
}

const sessionController = {

  // =========================
  // GET ALL SESSIONS
  // GET /sessions
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
        const data = await ResultSession.findAll({
          where,
          include: [includeBatch],
          order: SESSION_ORDER
        });
        return res.status(200).json({ success: true, data });
      }

      const [sessions, batches] = await Promise.all([
        ResultSession.findAll({ include: [includeBatch], order: SESSION_ORDER }),
        Batch.findAll({
          include: [{ model: Department, attributes: ['department_id', 'department_code', 'department_name'] }],
          order: [['batch_name', 'ASC']]
        })
      ]);

      return res.render('sessions/index', {
        layout: 'layouts/main',
        title: 'Session Management - SRAAS',
        pageStyles: SESSION_PAGE_STYLES,
        breadcrumbItems: [
          { href: '#', label: 'Academic Management' },
          { label: 'Sessions' }
        ],
        sessions,
        batches
      });
    } catch (error) {
      console.error('Sessions dashboard error:', error);
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
      const data = await ResultSession.findByPk(req.params.id, {
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
          message: 'Session not found'
        });
      }

      res.status(200).json({
        success: true,
        data
      });

    } catch (error) {
      console.error('Session get error:', error);
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

      // Academic semester is independent of the examination sitting.
      const duplicateSemester = await ResultSession.findOne({
        where: { batch_id: batch.batch_id, semester: String(Number(check.semester)), exam_session: check.exam_session, exam_year: check.exam_year }
      });
      if (duplicateSemester) {
        return res.status(409).json({
          success: false,
          message: 'This examination session already exists for the batch and semester.'
        });
      }

      const data = await ResultSession.create({
        session_uuid: session_uuid || generateUuid(),
        batch_id: batch.batch_id,
        semester: check.semester,
        exam_session: check.exam_session,
        exam_year: check.exam_year
      });

      res.status(201).json({
        success: true,
        message: 'Session created successfully',
        data
      });

    } catch (error) {
      console.error('Session create error:', error);
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
      const session = await ResultSession.findByPk(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      const check = validateSessionFields(req.body);
      if (check.errors.length) {
        return res.status(400).json({ success: false, message: check.errors[0] });
      }

      // Duplicate semester within the same batch (excluding this session)
      const duplicateSemester = await ResultSession.findOne({
        where: {
          batch_id: session.batch_id,
          semester: check.semester,
          exam_session: check.exam_session,
          exam_year: check.exam_year,
          session_id: { [Op.ne]: session.session_id }
        }
      });
      if (duplicateSemester) {
        return res.status(409).json({
          success: false,
          message: 'This examination session already exists for the batch and semester.'
        });
      }

      if (String(Number(session.semester)) !== check.semester && await Subject.count({ where: { session_id: session.session_id } })) {
        return res.status(409).json({ success: false, message: 'A session with configured courses cannot change academic semester. Create the correct examination session instead.' });
      }
      // Note: the batch association is intentionally not editable here.
      await ResultSession.update({
        semester: check.semester,
        exam_session: check.exam_session,
        exam_year: check.exam_year
      }, { where: { session_id: session.session_id } });

      const data = await ResultSession.findByPk(session.session_id);

      res.status(200).json({
        success: true,
        message: 'Session updated successfully',
        data
      });

    } catch (error) {
      console.error('Session update error:', error);
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
      const deleted = await ResultSession.destroy({
        where: { session_id: req.params.id }
      });

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Session not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Session deleted successfully'
      });

    } catch (error) {
      console.error('Session delete error:', error);
      res.status(500).json({
        success: false,
        message: 'Something went wrong on the server. Please try again.'
      });
    }
  }
};

module.exports = sessionController;
