const db = require('../config/db');

const Batch = {
  // Get all batches
  all: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM batches');
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Get a single batch by ID
  get: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM batches WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      res.json(rows[0]);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

 // Create a new batch
  create: async (req, res) => {
    try {
      const { name, year, department } = req.body;
      const [result] = await db.query(
        'INSERT INTO batches (name, year, department) VALUES (?, ?, ?)',
        [name, year, department]
      );
      res.status(201).json({ id: result.insertId, name, year, department });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Update a batch
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, year, department } = req.body;
      const [affected] = await db.query(
        'UPDATE batches SET name = ?, year = ?, department = ? WHERE id = ?',
        [name, year, department, id]
      );
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      res.json({ message: 'Batch updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Delete a batch
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const [affected] = await db.query('DELETE FROM batches WHERE id = ?', [id]);
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      res.json({ message: 'Batch deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

module.exports = Batch;