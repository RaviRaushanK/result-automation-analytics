const express = require('express');
const router = express.Router();

// Controller import
const subjectController = require('../controllers/subjectController');

/**
 * Subject Routes
 * Base URL: /subjects
 */

// ========================
// Collection Routes
// ========================
router.route('/')
  .get(subjectController.all)          // GET /subjects → fetch all subjects
  .post(subjectController.create);    // POST /subjects → create a new subject

// ========================
// Single Resource Routes
// ========================
router.route('/:id')
  .get(subjectController.getById)      // GET /subjects/:id → fetch subject by ID
  .put(subjectController.update)       // PUT /subjects/:id → update subject
  .delete(subjectController.delete);  // DELETE /subjects/:id → delete subject

// ========================
// Additional Routes
// ========================
router.get('/session/:session_id', subjectController.getBySession); // GET /subjects/session/:session_id → subjects for a session

module.exports = router;