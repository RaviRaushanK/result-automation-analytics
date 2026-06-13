const db = require('../config/db');

const Result = {
  all: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM results');
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getById: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM results WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Result not found' });
      }
      res.json(rows[0]);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getByStudent: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM results WHERE student_id = ?', [req.params.student_id]);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getBySubject: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM results WHERE subject_id = ?', [req.params.subject_id]);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  create: async (req, res) => {
    try {
      const { student_id, subject_id, marks_obtained, grade, exam_date } = req.body;
      const [result] = await db.query(
        'INSERT INTO results (student_id, subject_id, marks_obtained, grade, exam_date) VALUES (?,?,?,?,?)',
        [student_id, subject_id, marks_obtained, grade, exam_date]
      );
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { marks_obtained, grade, exam_date } = req.body;
      const [affected] = await db.query(
        'UPDATE results SET marks_obtained = ?, grade = ?, exam_date = ? WHERE id = ?',
        [marks_obtained, grade, exam_date, id]
      );
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Result not found' });
      }
      res.json({ message: 'Result updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  delete: async (req, res) => {
    try {
      const [affected] = await db.query('DELETE FROM results WHERE id = ?', [req.params.id]);
      if (affected.affectedRows === 0) {
        return res.status(404).json({ error: 'Result not found' });
      }
      res.json({ message: 'Result deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

module.exports = Result;