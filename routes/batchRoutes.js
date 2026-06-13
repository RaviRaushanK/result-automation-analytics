const express = require('express');
const router = express.Router();

// Controller import
const batchController = require('../controllers/batchController');

/**
 * Batch Routes
 * Base URL: /batches
 */

// ========================
// Collection Routes
// ========================
router.route('/')
  .get(batchController.all)       // GET /batches → fetch all batches
  .post(batchController.create);  // POST /batches → create new batch

// ========================
// Single Resource Routes
// ========================
router.route('/:id')
  .get(batchController.get)        // GET /batches/:id → get single batch
  .put(batchController.update)     // PUT /batches/:id → update batch
  .delete(batchController.delete); // DELETE /batches/:id → delete batch

module.exports = router;