// Import models from centralized registry
const { Batch, Department, Student, Result, ResultSession, AcademicCourse, sequelize } = require('../database/models');

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
        message: 'Unable to load batches. Please try again.'
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
        message: 'Unable to load this batch. Please try again.'
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
        if (!/^\d{4}$/.test(String(body.batch_year)) || !Number.isInteger(year) || year < 1900 || year > 2200) return res.status(400).json({ success: false, message: 'Batch year must be a valid year between 1900 and 2200.' });
        batch_name = course + ' ' + year;
      } else {
        // Keep existing API clients compatible with the stored batch_name field.
        batch_name = typeof body.batch_name === 'string' ? body.batch_name.trim() : '';
        if (!batch_name || batch_name.length > 100 || /[\x00-\x1f\x7f]/.test(batch_name)) return res.status(400).json({ success: false, message: 'Enter a valid batch name.' });
      }
      const start_year = typeof body.start_year === 'string' || typeof body.start_year === 'number' ? Number(body.start_year) : NaN;
      const end_year = typeof body.end_year === 'string' || typeof body.end_year === 'number' ? Number(body.end_year) : NaN;
      if (!/^\d{4}$/.test(String(body.start_year)) || !Number.isInteger(start_year) || start_year < 1900 || start_year > 2200) return res.status(400).json({ success: false, message: 'Start year must be between 1900 and 2200.' });
      if (!/^\d{4}$/.test(String(body.end_year)) || !Number.isInteger(end_year) || end_year < 1900 || end_year > 2200 || end_year <= start_year) return res.status(400).json({ success: false, message: 'End year must be valid and greater than start year.' });
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
      const data = await sequelize.transaction(async transaction => {
        const existing = await Batch.findByPk(req.params.id, { transaction, lock: true });
        const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
        if (!existing) fail('Batch not found.', 404);
        const body = req.body || {}, allowed = ['course_name','batch_year','batch_name','department_id','start_year','end_year','status'];
        if (Object.keys(body).some(key => !allowed.includes(key))) fail('Only batch name, department, years and status may be edited.');
        const payload = {};
        for (const field of ['batch_name','department_id','start_year','end_year','status']) payload[field] = body[field] ?? existing[field];
        if (body.course_name !== undefined || body.batch_year !== undefined) {
          if (!/^\d{4}$/.test(String(body.batch_year))) fail('Batch year must be a whole year between 1900 and 2200.');
          payload.batch_name = splitName(body);
          const currentName = require('../public/js/academic-form-options').splitBatchName(existing);
          if (String(currentName.course_name).trim().toUpperCase() === String(body.course_name).trim().toUpperCase()
            && Number(currentName.batch_year) === Number(body.batch_year)) payload.batch_name = existing.batch_name;
        }
        if (typeof payload.batch_name !== 'string' || !payload.batch_name.trim() || payload.batch_name.length > 100 || /[\x00-\x1f\x7f<>]/.test(payload.batch_name)) fail('Enter a valid batch name.');
        payload.batch_name = payload.batch_name.trim();
        for (const field of ['start_year','end_year']) {
          if (!['string','number'].includes(typeof payload[field]) || !/^\d{4}$/.test(String(payload[field])) || Number(payload[field]) < 1900 || Number(payload[field]) > 2200) fail('Start and end years must be whole years between 1900 and 2200.');
          payload[field] = Number(payload[field]);
        }
        if (payload.end_year <= payload.start_year) fail('End year must be greater than start year.');
        if (!['active','inactive'].includes(payload.status)) fail('Select a valid batch status.');
        if (!['string','number'].includes(typeof payload.department_id) || !/^[1-9]\d*$/.test(String(payload.department_id)) || !Number.isSafeInteger(Number(payload.department_id))) fail('Select a valid department.');
        if (String(payload.department_id) !== String(existing.department_id)) {
          const department = await Department.findOne({ where: { department_id: payload.department_id, status: 'active', deleted_at: null }, transaction });
          if (!department) fail('The selected department is unavailable or inactive.', 409);
        }
        const identityChanged = ['batch_name','department_id','start_year','end_year'].some(field => String(payload[field]) !== String(existing[field]));
        if (identityChanged && (await Student.count({ where: { batch_id: existing.batch_id }, paranoid: false, transaction, lock: true })
          || await Result.count({ include: [{ model: ResultSession, required: true, where: { batch_id: existing.batch_id } }], transaction, lock: true }))) fail('Batch identity, department and years cannot change after students or academic history depend on this batch. Configure a separate batch for the new cohort/syllabus.', 409);
        await existing.update(payload, { transaction });
        return existing;
      });
      res.status(200).json({ success: true, message: 'Batch updated successfully', data });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.status ? err.message : 'Unable to update the batch. Review its details and try again.'
      });
    }
  },

  // ========================
  // DELETE BATCH
  // ========================
  delete: async (req, res) => {
    try {
      const deleted = await sequelize.transaction(async transaction => {
        const batch = await Batch.findByPk(req.params.id, { transaction, lock: true });
        if (!batch) return 0;
        if (await Student.count({ where: { batch_id: batch.batch_id }, paranoid: false, transaction, lock: true })
          || await ResultSession.count({ where: { batch_id: batch.batch_id }, transaction, lock: true })
          || await AcademicCourse.count({ where: { batch_id: batch.batch_id }, transaction, lock: true })) throw Object.assign(new Error('This batch contains students or academic configuration/history and cannot be deleted. Keep it for historical reporting; use status only where appropriate.'), { status: 409 });
        return Batch.destroy({ where: { batch_id: batch.batch_id }, transaction });
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
      res.status(err.status || (err.name === 'SequelizeForeignKeyConstraintError' ? 409 : 500)).json({
        success: false,
        message: err.status ? err.message : 'This batch cannot be deleted while referenced by academic records.'
      });
    }
  }
};

module.exports = batchController;
