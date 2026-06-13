// Import Session model from centralized Sequelize registry
const { Session } = require('../database/models');

const sessionController = {

  // =========================
  // GET ALL SESSIONS
  // =========================
  all: async (req, res) => {
    try {
      // Fetch all session records
      const data = await Session.findAll();

      res.json(data);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  },

  // =========================
  // GET SESSION BY ID
  // =========================
  get: async (req, res) => {
    try {
      // Find session using primary key (id)
      const data = await Session.findByPk(req.params.id);

      // If session not found
      if (!data) {
        return res.status(404).json({
          error: 'Session not found'
        });
      }

      res.json(data);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  },

  // =========================
  // CREATE SESSION
  // =========================
  create: async (req, res) => {
    try {
      const {
        batch_id,
        name,
        start_date,
        end_date
      } = req.body;

      // Create new session record
      const data = await Session.create({
        batch_id,
        name,
        start_date,
        end_date
      });

      res.status(201).json({
        message: 'Session created successfully',
        data
      });

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  },

  // =========================
  // UPDATE SESSION
  // =========================
  update: async (req, res) => {
    try {
      // Update session by ID
      const updated = await Session.update(req.body, {
        where: { session_id: req.params.id } // IMPORTANT: use correct column name
      });

      // If no rows updated
      if (!updated[0]) {
        return res.status(404).json({
          error: 'Session not found'
        });
      }

      res.json({
        message: 'Session updated successfully'
      });

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  },

  // =========================
  // DELETE SESSION
  // =========================
  delete: async (req, res) => {
    try {
      // Delete session by ID
      const deleted = await Session.destroy({
        where: { session_id: req.params.id }
      });

      // If nothing deleted
      if (!deleted) {
        return res.status(404).json({
          error: 'Session not found'
        });
      }

      res.json({
        message: 'Session deleted successfully'
      });

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
};

module.exports = sessionController;