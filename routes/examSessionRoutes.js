const express = require('express');
const router = express.Router();
router.use(require('../middlewares/examSessionParameters'));

// Controller import
const examSessionController = require('../controllers/examSessionController');
const adminMiddleware = require('../middlewares/adminMiddleware');

/**
 * Session Routes
 * Base URL: /exam-sessions
 */

// ========================
// Collection Routes
// ========================
router.route('/')
  .get(examSessionController.all)          // GET /exam-sessions → fetch all sessions
  .post(examSessionController.create);    // POST /exam-sessions → create a new session

// ========================
// Single Resource Routes
// ========================
router.route('/:id')
  .get(examSessionController.get)          // GET /exam-sessions/:id → fetch session by ID
  .put(examSessionController.update)       // PUT /exam-sessions/:id → update session
  .delete(adminMiddleware, examSessionController.delete);  // DELETE /exam-sessions/:id → delete an unused session

module.exports = router;
