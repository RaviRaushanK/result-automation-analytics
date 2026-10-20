const bcrypt = require('bcryptjs');
const { AdminUser, AdminOtp } = require('../database/models');
const otpService = require('../services/otpService');

const LOGIN_PAGE_STYLES = ['/css/login.css'];
const authController = {
  showLoginPage: (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/dashboard');
    res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: null, expired: req.query.expired === '1', passwordChanged: req.query.passwordChanged === '1', pageStyles: LOGIN_PAGE_STYLES });
  },

  showForgotPassword: (req, res) => {
    res.render('auth/forgot-password', {
      layout: 'layouts/landing',
      title: 'Forgot Password - SRAAS',
      error: null,
      pageStyles: LOGIN_PAGE_STYLES
    });
  },

  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.trim()) {
        return res.render('auth/forgot-password', {
          layout: 'layouts/landing',
          title: 'Forgot Password - SRAAS',
          error: 'Please enter your email address.',
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      const trimmedEmail = email.trim().toLowerCase();
      const admin = await AdminUser.findOne({ where: { email: trimmedEmail, deleted_at: null } });

      const genericMessage = 'If an account is associated with this email address, a verification code will be sent.';

      if (!admin) {
        return res.render('auth/forgot-password', {
          layout: 'layouts/landing',
          title: 'Forgot Password - SRAAS',
          notice: genericMessage,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      if (admin.status !== 'active') {
        return res.render('auth/forgot-password', {
          layout: 'layouts/landing',
          title: 'Forgot Password - SRAAS',
          notice: genericMessage,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      const result = await otpService.createAndSendOtp({ adminId: admin.admin_id, type: 'password_reset' });

      return res.render('auth/verify-otp', {
        layout: 'layouts/landing',
        title: 'Verify Code - SRAAS',
        error: null,
        adminId: admin.admin_id,
        type: 'password_reset',
        maskedDestination: result.maskedDestination,
        ttlSeconds: result.ttlSeconds,
        resendInSeconds: result.resendInSeconds,
        pageStyles: LOGIN_PAGE_STYLES
      });
    } catch (err) {
      console.error('Forgot password error:', err);
      return res.render('auth/forgot-password', {
        layout: 'layouts/landing',
        title: 'Forgot Password - SRAAS',
        error: err.status >= 400 && err.status < 500 ? err.message : 'An unexpected error occurred. Please try again.',
        pageStyles: LOGIN_PAGE_STYLES
      });
    }
  },
  showVerifyOtp: (req, res) => {
    const { adminId, type } = req.query;
    if (!adminId || !type) return res.redirect('/login');
    res.render('auth/verify-otp', {
      layout: 'layouts/landing',
      title: 'Verify Code - SRAAS',
      error: null,
      adminId,
      type,
      maskedDestination: null,
      ttlSeconds: 600,
      resendInSeconds: 60,
      pageStyles: LOGIN_PAGE_STYLES
    });
  },

  verifyResetOtp: async (req, res) => {
    try {
      const { adminId, otp } = req.body;
      const type = 'password_reset';
      if (!adminId || !otp || !/^\d{6}$/.test(otp)) {
        return res.render('auth/verify-otp', {
          layout: 'layouts/landing',
          title: 'Verify Code - SRAAS',
          error: 'Please enter the 6-digit verification code.',
          adminId,
          type,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      const result = await otpService.verifyOtp({ adminId, type, code: otp });

      // Mark OTP verification as complete for password reset in the session
      req.session.pendingPasswordReset = result.admin.admin_id;

      return res.render('auth/reset-password', {
        layout: 'layouts/landing',
        title: 'Reset Password - SRAAS',
        error: null,
        adminId: result.admin.admin_id,
        pageStyles: LOGIN_PAGE_STYLES
      });
    } catch (err) {
      console.error('Verify OTP error:', err);
      const adminId = req.body.adminId;
      const type = 'password_reset';
      const status = err.status || 500;
      return res.render('auth/verify-otp', {
        layout: 'layouts/landing',
        title: 'Verify Code - SRAAS',
        error: status >= 400 && status < 500 ? err.message : 'An unexpected error occurred. Please try again.',
        adminId,
        type,
        pageStyles: LOGIN_PAGE_STYLES
      });
    }
  },

  showResetPassword: (req, res) => {
    const { adminId } = req.query;
    if (!adminId) return res.redirect('/login');
    res.render('auth/reset-password', {
      layout: 'layouts/landing',
      title: 'Reset Password - SRAAS',
      error: null,
      adminId,
      pageStyles: LOGIN_PAGE_STYLES
    });
  },

  resetPassword: async (req, res) => {
    try {
      const { adminId, newPassword, confirmPassword } = req.body;

      // Ensure OTP was verified before allowing password reset
      if (!req.session.pendingPasswordReset || String(req.session.pendingPasswordReset) !== String(adminId)) {
        return res.redirect('/login');
      }

      if (!adminId || !newPassword || !confirmPassword) {
        return res.render('auth/reset-password', {
          layout: 'layouts/landing',
          title: 'Reset Password - SRAAS',
          error: 'All fields are required.',
          adminId,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }
      if (newPassword !== confirmPassword) {
        return res.render('auth/reset-password', {
          layout: 'layouts/landing',
          title: 'Reset Password - SRAAS',
          error: 'New password and confirmation do not match.',
          adminId,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }
      if (newPassword.length < 6) {
        return res.render('auth/reset-password', {
          layout: 'layouts/landing',
          title: 'Reset Password - SRAAS',
          error: 'New password must be at least 6 characters.',
          adminId,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      const admin = await AdminUser.findByPk(adminId);
      if (!admin) {
        return res.render('auth/reset-password', {
          layout: 'layouts/landing',
          title: 'Reset Password - SRAAS',
          error: 'Account not found.',
          adminId,
          pageStyles: LOGIN_PAGE_STYLES
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await AdminUser.update({ password_hash: hashedPassword }, { where: { admin_id: adminId } });

      await AdminOtp.update({ is_used: 1 }, { where: { admin_id: adminId, type: 'password_reset', is_used: 0 } });

      // Clear the pending password reset session flag
      req.session.pendingPasswordReset = null;

      return res.render('auth/login', {
        layout: 'layouts/landing',
        title: 'Login - SRAAS',
        error: null,
        passwordChanged: true,
        expired: false,
        pageStyles: LOGIN_PAGE_STYLES
      });
    } catch (err) {
      console.error('Reset password error:', err);
      return res.render('auth/reset-password', {
        layout: 'layouts/landing',
        title: 'Reset Password - SRAAS',
        error: 'An unexpected error occurred. Please try again.',
        adminId: req.body.adminId,
        pageStyles: LOGIN_PAGE_STYLES
      });
    }
  },

  resendOtp: async (req, res) => {
    try {
      const { adminId, type } = req.body;
      if (!adminId || !type) {
        return res.status(400).json({ error: 'Missing required fields.' });
      }

      const result = await otpService.resendOtp({ adminId, type });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('Resend OTP error:', err);
      const status = err.status || 500;
      return res.status(status).json({ ok: false, error: err.message || 'An unexpected error occurred.' });
    }
  },

  login: async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: 'Please enter both username and password.', expired: false , pageStyles: LOGIN_PAGE_STYLES });
      const admin = await AdminUser.findOne({ where: { username } });
      if (!admin) return res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: 'Invalid username or password.', expired: false , pageStyles: LOGIN_PAGE_STYLES });
      const isMatch = await bcrypt.compare(password, admin.password_hash);
      if (!isMatch) return res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: 'Invalid username or password.', expired: false , pageStyles: LOGIN_PAGE_STYLES });
      if (admin.status !== 'active') return res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: 'Your account is inactive. Contact support.', expired: false , pageStyles: LOGIN_PAGE_STYLES });
      
      // Set session data
      req.session.adminId = admin.admin_id;
      req.session.username = admin.username;
      req.session.role = admin.role;
      
      // Store complete user object in session for easy access
      req.session.user = {
        adminId: admin.admin_id,
        username: admin.username,
        role: admin.role
      };

      await AdminUser.update({ last_login: new Date() }, { where: { admin_id: admin.admin_id } });
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    } catch (err) {
      console.error('Login error:', err);
      return res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: 'An unexpected error occurred. Please try again.', expired: false , pageStyles: LOGIN_PAGE_STYLES });
    }
  },
  logout: (req, res) => {
    req.session.destroy((err) => { if (err) console.error('Logout error:', err); res.clearCookie('connect.sid'); return res.redirect('/'); });
  },
  showAccountSecurity: (req, res) => {
    res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: null, breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }, { href: '#', label: 'Account Security' }] });
  },
  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      const bc = [{ href: '/dashboard', label: 'Dashboard' }, { href: '#', label: 'Account Security' }];
      if (!currentPassword || !newPassword || !confirmPassword) return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'All fields are required.', breadcrumbItems: bc });
      if (newPassword !== confirmPassword) return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'New password and confirmation do not match.', breadcrumbItems: bc });
      if (newPassword.length < 6) return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'New password must be at least 6 characters.', breadcrumbItems: bc });
      const admin = await AdminUser.findByPk(req.session.adminId);
      if (!admin) return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'Administrator account not found.', breadcrumbItems: bc });
      const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
      if (!isMatch) return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'Current password is incorrect.', breadcrumbItems: bc });
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await AdminUser.update({ password_hash: hashedPassword }, { where: { admin_id: req.session.adminId } });
      req.session.destroy((e) => { if (e) console.error('Session destroy error:', e); res.clearCookie('connect.sid'); return res.redirect('/login?passwordChanged=1'); });
    } catch (err) {
      console.error('Change password error:', err);
      const bc = [{ href: '/dashboard', label: 'Dashboard' }, { href: '#', label: 'Account Security' }];
      return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'An unexpected error occurred.', breadcrumbItems: bc });
    }
  }
};
module.exports = authController;
