// Import Batch model from centralized registry
const { Batch } = require('../models/models.js');


const batchController = {

  // ========================
  // GET ALL BATCHES
  // ========================
  all: async (req, res) => {
    try {
      const data = await Batch.findAll();

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