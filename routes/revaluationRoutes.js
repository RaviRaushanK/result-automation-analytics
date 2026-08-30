const express = require('express');
const router = express.Router();
const rc = require('../controllers/revaluationController');
const { revaluationUpload } = require('../middlewares/upload');

// Mounted at /revaluation in app.js (auth-gated).

// Sidebar entry — the '/revaluation/start' wizard is the SINGLE revaluation
// workflow. PROMPT 19 retired the legacy Result picker. `/upload` is kept as
// a redirect (preserving any ?error= query) so error-return paths, old
// bookmarks and breadcrumbs always land on the wizard instead of a competing
// picker page.
router.get('/upload', (req, res) => {
  const idx = (req.originalUrl || req.url).indexOf('?');
  const qs = idx >= 0 ? (req.originalUrl || req.url).slice(idx) : '';
  res.redirect('/revaluation/start' + qs);
});
router.get('/', (req, res) => res.redirect('/revaluation/start'));

// ---------------------------------------------------------------
// PHASE 13A — new primary entry flow: Result Session → Student → Attempt.
// CONTEXT SELECTION ONLY (no subject pre-selection).
// NOTE: these must be declared BEFORE the `/:resultId` catch-alls below.
// ---------------------------------------------------------------
router.get('/start', rc.showSessionPicker);
router.get('/start/students', rc.showSessionStudents);
router.get('/start/attempts', rc.resolveShowAttempts);
router.post('/start/attempt', rc.confirmAttemptSelection);
// ---------------------------------------------------------------

// Upload page (GET) + document submit (POST). The POST uses an explicit
// multer invocation so file/MIME/size rejections become friendly redirects.
// ?replace=1 is forwarded so the page can show a re-upload context
// (re-establishes the wizard draft without re-picking session/student/attempt).
router.get('/:resultId/upload', rc.showUploadPage);
router.post('/:resultId/upload', (req, res, next) => {
  revaluationUpload.single('revalidationDocument')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Document too large. Maximum size is 15 MB.'
        : (err.message || 'Invalid document.');
      return res.redirect(`/revaluation/${req.params.resultId}/upload?error=` + encodeURIComponent(msg));
    }
    // The session.revaluationDraft.replacing flag is already set by the GET
    // showUploadPage handler when ?replace=1 was used to enter the page.
    // processUpload reads it directly; no additional query-param forwarding needed.
    return rc.processUpload(req, res, next);
  });
});

// Placeholder for the next (OCR) stage.
router.get('/pending/:importId', rc.showPending);

// POST — admin explicitly confirms a name+USN identity mismatch on the
// current extraction. The flag is stored on the OcrExtraction row and is
// the ONLY place the backend can mark a both-mismatch as acknowledged.
router.post('/pending/:importId/confirm-identity', rc.confirmIdentity);

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
