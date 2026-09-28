// Import models from centralized registry
const { Batch, Department } = require('../database/models');

// Page styles for the Batches Management dashboard (Academic Management → Batches)
const BATCH_PAGE_STYLES = ['/css/dashboard.css', '/css/batches.css'];


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
          attributes: ['department_id', 'department_code', 'department_name'],
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
      // Only allow safe fields (prevents injection of unwanted columns)
      const {
        batch_uuid,
        department_id,
        batch_name,
        start_year,
        end_year,
        status
      } = req.body;

      const data = await Batch.create({
        batch_uuid,
        department_id,
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
        message: err.message
      });
    }
  },

  // ========================
  // UPDATE BATCH
  // ========================
  update: async (req, res) => {
    try {
      const [updated] = await Batch.update(req.body, {
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
      res.status(500).json({
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