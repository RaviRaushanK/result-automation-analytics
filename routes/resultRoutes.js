const express = require('express');
const router = express.Router();

// Controller import
const resultController = require('../controllers/resultController');

/**
 * Result Routes
 * Base URL: /results
 */

// ========================
// Collection Routes
// ========================
router.route('/')
  .get(resultController.all)          // GET /results → fetch all results
  .post(resultController.create);    // POST /results → create a new result

// ========================
// Single Resource Routes
// ========================
router.route('/:id')
  .get(resultController.getById)      // GET /results/:id → fetch result by ID
  .put(resultController.update)       // PUT /results/:id → update result
  .delete(resultController.delete);  // DELETE /results/:id → delete result

// ========================
// Additional Routes
// ========================
router.get('/student/:student_id', resultController.getByStudent); // GET /results/student/:student_id → results for a student

module.exports = router;