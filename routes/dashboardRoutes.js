const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

router.use(authMiddleware);

// Dashboard page
router.get('/', dashboardController.index);

// Dashboard API endpoints
router.get('/analytics', dashboardController.analytics);
router.get('/pass-fail', dashboardController.passFail);
router.get('/top-scorers', dashboardController.topScorers);

module.exports = router;