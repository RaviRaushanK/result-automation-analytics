const db = require('../config/db');

const Subject = {
  all: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM subjects');
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getById: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM subjects WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Subject not found' });
      }
      res.json(rows[0]);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getBySession: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM subjects WHERE session_id = ?', [req.params.session_id]);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  create: async (req, res) => {
    try {
      const { session_id, name, code, max_marks } = req.body;
      const [result] = await db.query(
        'INSERT INTO subjects (session_id, name, code, max_marks) VALUES (?, ?, ?, ?)',
        [session_id, name, code, max_marks]
      );
      res.status(201).json({ id: result.insertId, session_id, name, code, max_marks });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { session_id, name, code, max_marks } = req.body;
      const [affected] = await db.query(
        'UPDATE subjects SET session_id = ?, name = ?, code = ?, max_marks = ? WHERE id = ?',
        [session_id, name, code, max_marks, id]
      );
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Subject not found' });
      }
      res.json({ message: 'Subject updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  delete: async (req, res) => {
    try {
      const [affected] = await db.query('DELETE FROM subjects WHERE id = ?', [req.params.id]);
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Subject not found' });
      }
      res.json({ message: 'Subject deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

module.exports = Subject;