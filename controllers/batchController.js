// Import models from centralized registry
const { Batch, Department } = require('../database/models');

// Page styles for the Batches Management dashboard (Academic Management → Batches)
const BATCH_PAGE_STYLES = ['/css/dashboard.css', '/css/batches.css'];

function splitName(body) {
  const course = typeof body.course_name === 'string' ? body.course_name.trim().replace(/\s+/g, ' ') : '';
  const year = typeof body.batch_year === 'string' || typeof body.batch_year === 'number' ? Number(body.batch_year) : NaN;
  if (!course || course.length > 90 || /[\x00-\x1f\x7f<>]/.test(course)) throw Object.assign(new Error('Enter a valid course name (up to 90 characters).'), { status: 400 });
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw Object.assign(new Error('Batch year must be between 1900 and 2200.'), { status: 400 });
  return course + ' ' + year;
}

const batchController = {

  // ========================
  // GET ALL BATCHES
  // ========================
  all: async (req, res) => {
    try {
      // Reuse the existing Department ↔ Batch relationship to resolve department names
      const data = await Batch.findAll({
        include: [{
          model: Department,
          attributes: ['department_id', 'department_code', 'department_name']
        }],
        order: [['created_at', 'DESC'], ['batch_id', 'DESC']]
      });

      // Content negotiation:
      // - Browser navigation (Accept: text/html) renders the Batches Management dashboard
      // - API clients (Accept: application/json or ?format=json) keep the existing JSON response
      // - Requests without an explicit type (Accept: */* from curl/tools) keep the JSON response
      const acceptHeader = String(req.get('Accept') || '');
      const wantsJson = req.query.format === 'json' ||
        acceptHeader.indexOf('application/json') !== -1 ||
        acceptHeader.indexOf('text/html') === -1;

      if (!wantsJson) {
        const departments = await Department.findAll({
          attributes: ['department_id', 'department_code', 'department_name', 'status'],
          where: { deleted_at: null },
          order: [['department_name', 'ASC']],
          raw: true
        });

        return res.render('batches/index', {
          layout: 'layouts/main',
          title: 'Batches Management - SRAAS',
          pageStyles: BATCH_PAGE_STYLES,
          breadcrumbItems: [
            { href: '#', label: 'Academic Management' },
            { label: 'Batches' }
          ],
          batches: data,
          departments
        });
      }

      res.status(200).json({
        success: true,
        data
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ========================
  // GET SINGLE BATCH
  // ========================
  get: async (req, res) => {
    try {
      const data = await Batch.findByPk(req.params.id);

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found'
        });
      }

      res.status(200).json({
        success: true,
        data
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ========================
  // CREATE BATCH
  // ========================
  create: async (req, res) => {
    try {
      const body = req.body || {};
      let batch_name;
      if (body.course_name !== undefined || body.batch_year !== undefined) {
        if (typeof body.course_name !== 'string') return res.status(400).json({ success: false, message: 'Course name is required.' });
        const course = body.course_name.trim().replace(/\s+/g, ' ');
        if (!course || course.length > 90 || /[\x00-\x1f\x7f<>]/.test(course)) return res.status(400).json({ success: false, message: 'Enter a valid course name (up to 90 characters).' });
        const year = typeof body.batch_year === 'string' || typeof body.batch_year === 'number' ? Number(body.batch_year) : NaN;
        if (!Number.isInteger(year) || year < 1900 || year > 2200) return res.status(400).json({ success: false, message: 'Batch year must be a valid year between 1900 and 2200.' });
        batch_name = course + ' ' + year;
      } else {
        // Keep existing API clients compatible with the stored batch_name field.
        batch_name = typeof body.batch_name === 'string' ? body.batch_name.trim() : '';
        if (!batch_name || batch_name.length > 100 || /[\x00-\x1f\x7f]/.test(batch_name)) return res.status(400).json({ success: false, message: 'Enter a valid batch name.' });
      }
      const start_year = typeof body.start_year === 'string' || typeof body.start_year === 'number' ? Number(body.start_year) : NaN;
      const end_year = typeof body.end_year === 'string' || typeof body.end_year === 'number' ? Number(body.end_year) : NaN;
      if (!Number.isInteger(start_year) || start_year < 1900 || start_year > 2200) return res.status(400).json({ success: false, message: 'Start year must be between 1900 and 2200.' });
      if (!Number.isInteger(end_year) || end_year < 1900 || end_year > 2200 || end_year <= start_year) return res.status(400).json({ success: false, message: 'End year must be valid and greater than start year.' });
      const status = body.status ?? 'active';
      if (!['active', 'inactive'].includes(status)) return res.status(400).json({ success: false, message: 'Select a valid status.' });
      const selectedDepartment = body.department_id;
      if (selectedDepartment !== undefined && selectedDepartment !== '' && ((typeof selectedDepartment !== 'string' && typeof selectedDepartment !== 'number') || !/^[1-9]\d*$/.test(String(selectedDepartment)) || !Number.isSafeInteger(Number(selectedDepartment)))) return res.status(400).json({ success: false, message: 'Select a valid department.' });
      const department = await Department.findOne({ where: { ...(selectedDepartment === undefined || selectedDepartment === '' ? { department_code: 'MCA' } : { department_id: Number(selectedDepartment) }), status: 'active', deleted_at: null }, attributes: ['department_id'] });
      if (!department) return res.status(409).json({ success: false, message: 'The selected department is unavailable or inactive.' });

      const data = await Batch.create({
        batch_uuid: body.batch_uuid,
        department_id: department.department_id,
        batch_name,
        start_year,
        end_year,
        status
      });

      res.status(201).json({
        success: true,
        message: 'Batch created successfully',
        data
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Unable to create the batch. Please check its details and try again.'
      });
    }
  },

  // ========================
  // UPDATE BATCH
  // ========================
  update: async (req, res) => {
    try {
      const payload = { ...req.body };
      if (payload.course_name !== undefined || payload.batch_year !== undefined) payload.batch_name = splitName(payload);
      delete payload.course_name;
      delete payload.batch_year;
      const [updated] = await Batch.update(payload, {
        where: { batch_id: req.params.id }
      });

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found'
        });
      }

      const updatedData = await Batch.findByPk(req.params.id);

      res.status(200).json({
        success: true,
        message: 'Batch updated successfully',
        data: updatedData
      });

    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ========================
  // DELETE BATCH
  // ========================
  delete: async (req, res) => {
    try {
      const deleted = await Batch.destroy({
        where: { batch_id: req.params.id }
      });

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Batch deleted successfully'
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
};

module.exports = batchController;
