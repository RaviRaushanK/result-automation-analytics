const express = require('express');
const multer = require('multer');
const router = express.Router();
const resultController = require('../controllers/resultController');

// Multer temp storage — files are moved to /uploads/results by the controller
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf'];
    const ext = require('path').extname(file.originalname).toLowerCase();
    const isPdfMime = file.mimetype === 'application/pdf';
    if (allowed.includes(ext) && isPdfMime) return cb(null, true);
    cb(new Error('Only PDF marks cards are accepted (image support coming later).'));
  }
});

/**
 * Result Routes
 * Base URL: /results
 *
 * Upload flow (separate pages):
 *   GET  /results/upload                        → Page 1: select session + choose card
 *   POST /results/upload                        → OCR extract → redirect to review
 *   GET  /results/upload/:importId/review       → Page 2: review & edit (two-column)
 *   POST /results/upload/:importId/validate     → validate edits → stay or preview
 *   GET  /results/upload/:importId/preview      → Page 3: validated preview
 *   POST /results/upload/:importId/import       → transactional save
 *   GET  /results/upload/:importId/success      → Page 4: import successful
 *
 * Utilities:
 *   GET  /results/session-details/:sessionId    → JSON (subjects of a session)
 *   GET  /results/logs                          → import logs listing
 */

// ---- Upload flow ----
router.get('/upload', resultController.showUploadPage);
router.post('/upload', upload.single('resultDocument'), resultController.processUpload);
router.get('/upload/:importId/review', resultController.showReviewPage);
router.post('/upload/:importId/validate', resultController.validateReview);
router.get('/upload/:importId/preview', resultController.showPreviewPage);
router.post('/upload/:importId/import', resultController.confirmImport);
router.get('/upload/:importId/success', resultController.showSuccessPage);

// ---- Utilities ----
router.get('/session-details/:sessionId', resultController.getSessionDetails);
router.get('/logs', resultController.getImportLogs);

// ---- Collection ----
router.route('/')
  .get(resultController.all)      // GET  /results
  .post(resultController.create); // POST /results

// ---- Single resource (legacy API) ----
router.route('/:id')
  .get(resultController.getById)
  .put(resultController.update)
  .delete(resultController.delete);

router.get('/student/:student_id', resultController.getByStudent);

module.exports = router;
