const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// ========================
// Public Auth Routes
// ========================
router.get('/login', authController.showLoginPage);
router.post('/login', authController.login);

// ========================
// Protected Auth Routes
// ========================
router.get('/logout', authController.logout);
router.get('/account-security', authMiddleware, authController.showAccountSecurity);
router.post('/account-security', authMiddleware, authController.changePassword);

module.exports = router;
