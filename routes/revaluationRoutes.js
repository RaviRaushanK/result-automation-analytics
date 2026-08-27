const express = require('express');
const router = express.Router();
const rc = require('../controllers/revaluationController');
const { revaluationUpload } = require('../middlewares/upload');

// Mounted at /revaluation in app.js (auth-gated).

// Sidebar entry point — "Upload Revaluation" → find an existing Result.
router.get('/upload', rc.showResultPicker);
router.get('/', (req, res) => res.redirect('/revaluation/upload'));

// Result detail (attempt info + subjects w/ current marks).
router.get('/:resultId', rc.showResultDetail);

// "Start Revaluation" — validate + stash the server-verified selection.
router.post('/:resultId/start', rc.startRevaluation);

// Upload page (GET) + document submit (POST). The POST uses an explicit
// multer invocation so file/MIME/size rejections become friendly redirects.
router.get('/:resultId/upload', rc.showUploadPage);
router.post('/:resultId/upload', (req, res, next) => {
  revaluationUpload.single('revalidationDocument')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Document too large. Maximum size is 15 MB.'
        : (err.message || 'Invalid document.');
      return res.redirect(`/revaluation/${req.params.resultId}/upload?error=` + encodeURIComponent(msg));
    }
    return rc.processUpload(req, res, next);
  });
});

// Placeholder for the next (OCR) stage.
router.get('/pending/:importId', rc.showPending);

// PROMPT 4 — OCR extraction stage (candidates only; no academic writes).
router.post('/pending/:importId/extract', rc.runExtraction);
router.get('/extraction/:importId', rc.showExtraction);

// PROMPT 5 — Review/Edit → Validation → Approval → Outcome.
// All handlers are server-authoritative; the browser submits proposals only.
router.get('/review/:importId', rc.showReview);
router.post('/review/:importId', rc.submitReview);
router.get('/approve/:importId', rc.showApproveConfirm);
router.post('/approve/:importId', rc.approveReview);
router.get('/outcome/:importId', rc.showOutcome);

module.exports = router;
