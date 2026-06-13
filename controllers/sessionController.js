const db = require('../config/db');

const Session = {
  all: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM sessions');
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  get: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(rows[0]);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  create: async (req, res) => {
    try {
      const { batch_id, name, start_date, end_date } = req.body;
      const [result] = await db.query(
        'INSERT INTO sessions (batch_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
        [batch_id, name, start_date, end_date]
      );
      res.status(201).json({ id: result.insertId, batch_id, name, start_date, end_date });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { batch_id, name, start_date, end_date } = req.body;
      const [affected] = await db.query(
        'UPDATE sessions SET batch_id = ?, name = ?, start_date = ?, end_date = ? WHERE id = ?',
        [batch_id, name, start_date, end_date, id]
      );
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ message: 'Session updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  delete: async (req, res) => {
    try {
      const [affected] = await db.query('DELETE FROM sessions WHERE id = ?', [req.params.id]);
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ message: 'Session deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

module.exports = Session;