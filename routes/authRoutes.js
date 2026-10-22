const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const csrf = require('../middlewares/csrfMiddleware');
const registration = require('../controllers/registrationController');
const accounts = require('../controllers/settingsController');

router.use(['/register', '/invitations'], (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});
router.get('/register', csrf, registration.page);
router.post('/register', csrf, registration.start);
router.post('/register/send', csrf, registration.send);
router.post('/register/verify', csrf, registration.verify);
router.get('/invitations', authMiddleware, accounts.currentAccount, accounts.administrator, csrf, registration.invitations);
router.post('/invitations', authMiddleware, accounts.currentAccount, accounts.administrator, csrf, registration.invite);

// ========================
// Public Auth Routes
// ========================
router.get('/login', authController.showLoginPage);
router.post('/login', authController.login);

// ========================
// Forgot Password Routes
// ========================
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', (req, res) => req.body.recoveryAction === 'verify' ? authController.verifyResetOtp(req, res) : authController.forgotPassword(req, res));
router.get('/verify-otp', authController.showVerifyOtp);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.get('/reset-password', authController.showResetPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-otp', authController.resendOtp);

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
