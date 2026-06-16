const { Result } = require('../database/models');

const resultController = {

  // GET ALL RESULTS
  all: async (req, res) => {
    try {
      const data = await Result.findAll();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // GET RESULT BY ID
  getById: async (req, res) => {
    try {
      const data = await Result.findByPk(req.params.id);
      if (!data) return res.status(404).json({ error: 'Result not found' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // GET RESULTS BY STUDENT
  getByStudent: async (req, res) => {
    try {
      const data = await Result.findAll({ where: { student_id: req.params.student_id } });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // CREATE RESULT
  create: async (req, res) => {
    try {
      const data = await Result.create(req.body);
      res.status(201).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // UPDATE RESULT
  update: async (req, res) => {
    try {
      const [updated] = await Result.update(req.body, { where: { result_id: req.params.id } });
      if (!updated) return res.status(404).json({ error: 'Result not found' });
      res.json({ message: 'Updated successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // DELETE RESULT
  delete: async (req, res) => {
    try {
      const deleted = await Result.destroy({ where: { result_id: req.params.id } });
      if (!deleted) return res.status(404).json({ error: 'Result not found' });
      res.json({ message: 'Deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
};

module.exports = resultController;