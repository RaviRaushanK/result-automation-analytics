const { Subject } = require('../database/models');

const subjectController = {

  // GET ALL SUBJECTS
  all: async (req, res) => {
    try {
      const data = await Subject.findAll();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // GET SUBJECT BY ID
  getById: async (req, res) => {
    try {
      const data = await Subject.findByPk(req.params.id);

      if (!data) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      res.json(data);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // GET SUBJECTS BY SESSION
  getBySession: async (req, res) => {
    try {
      const data = await Subject.findAll({
        where: { session_id: req.params.session_id }
      });

      res.json(data);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // CREATE SUBJECT
  create: async (req, res) => {
    try {
      const data = await Subject.create(req.body);
      res.status(201).json(data);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // UPDATE SUBJECT
  update: async (req, res) => {
    try {
      const updated = await Subject.update(req.body, {
        where: { subject_id: req.params.id }
      });

      if (!updated[0]) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      res.json({ message: 'Updated successfully' });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // DELETE SUBJECT
  delete: async (req, res) => {
    try {
      const deleted = await Subject.destroy({
        where: { subject_id: req.params.id }
      });

      if (!deleted) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      res.json({ message: 'Deleted successfully' });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
};

module.exports = subjectController;