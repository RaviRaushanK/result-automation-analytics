const express = require('express');
const router = express.Router();

// Controller import
const sessionController = require('../controllers/sessionController');

/**
 * Session Routes
 * Base URL: /sessions
 */

// ========================
// Collection Routes
// ========================
router.route('/')
  .get(sessionController.all)          // GET /sessions → fetch all sessions
  .post(sessionController.create);    // POST /sessions → create a new session

// ========================
// Single Resource Routes
// ========================
router.route('/:id')
  .get(sessionController.get)          // GET /sessions/:id → fetch session by ID
  .put(sessionController.update)       // PUT /sessions/:id → update session
  .delete(sessionController.delete);  // DELETE /sessions/:id → delete session

module.exports = router;