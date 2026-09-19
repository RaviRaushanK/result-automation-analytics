/**
 * Analytics Routes — Phase 3.
 *
 * The entire router is protected at router level: authentication via the
 * project's existing authMiddleware (session-based, HTML/JSON aware), then
 * explicit role authorization (admin, faculty) — sidebar visibility alone is
 * NOT endpoint authorization.
 *
 * Page routes render EJS shells (views arrive in Phase 4); API routes return
 * JSON prepared by analyticsService.
 */

const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');
const analyticsController = require('../controllers/analyticsController');

// Analytics authorization lives in the controller module (kept with the
// controller's role policy) and is applied router-wide below.
const { analyticsAuthorization } = analyticsController;

router.use(authMiddleware);
router.use(analyticsAuthorization);

// -----------------------------
// Page routes (EJS shells)
// -----------------------------
router.get('/overview', analyticsController.overviewPage);
router.get('/toppers', analyticsController.toppersPage);
router.get('/failed', analyticsController.failedPage);
router.get('/subjects', analyticsController.subjectsPage);
router.get('/semesters', analyticsController.semestersPage);
router.get('/students', analyticsController.studentsPage);
router.get('/revaluation', analyticsController.revaluationPage);

// -----------------------------
// API routes (JSON)
// -----------------------------
router.get('/api/overview', analyticsController.overview);
router.get('/api/toppers', analyticsController.toppers);
router.get('/api/failed', analyticsController.failed);
router.get('/api/subjects', analyticsController.subjects);
router.get('/api/semesters', analyticsController.semesters);
router.get('/api/students', analyticsController.students);
router.get('/api/grade-distribution', analyticsController.gradeDistribution);
router.get('/api/revaluation', analyticsController.revaluation);
router.get('/api/revaluation/by-subject', analyticsController.revaluationBySubject);
router.get('/api/revaluation/detail', analyticsController.revaluationDetail);
router.get('/api/filter-options/:scope', analyticsController.filterOptions);

module.exports = router;
