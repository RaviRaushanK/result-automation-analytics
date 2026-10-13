const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const csrf = require('../middlewares/csrfMiddleware');

// ========================
// Public Auth Routes
// ========================
router.get('/login', authController.showLoginPage);
router.post('/login', authController.login);

// ========================
// Protected Auth Routes
// ========================
router.get('/logout', authController.logout);
router.get('/profile', authMiddleware, (req, res) => res.redirect('/settings?section=account'));
router.get('/account-security', authMiddleware, csrf, authController.showAccountSecurity);
router.post('/account-security', authMiddleware, csrf, (req, res, next) => {
  if (Object.keys(req.body || {}).some(key => !['_csrf', 'currentPassword', 'newPassword', 'confirmPassword'].includes(key))) {
    return res.status(400).send('Unsupported account-security field.');
  }
  next();
}, authController.changePassword);

module.exports = router;
