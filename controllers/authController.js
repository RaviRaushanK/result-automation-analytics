const bcrypt = require('bcryptjs');
const { AdminUser } = require('../database/models');

const LOGIN_PAGE_STYLES = ['/css/login.css'];
const authController = {
  showLoginPage: (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/dashboard');
    res.render('auth/login', { layout: 'layouts/landing', title: 'Login - SRAAS', error: null, expired: req.query.expired === '1' , pageStyles: LOGIN_PAGE_STYLES });
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
      req.session.destroy((e) => { if (e) console.error('Session destroy error:', e); res.clearCookie('connect.sid'); return res.redirect('/login?expired=1'); });
    } catch (err) {
      console.error('Change password error:', err);
      const bc = [{ href: '/dashboard', label: 'Dashboard' }, { href: '#', label: 'Account Security' }];
      return res.render('auth/account-security', { layout: 'layouts/main', title: 'Account Security - SRAAS', success: null, error: 'An unexpected error occurred.', breadcrumbItems: bc });
    }
  }
};
module.exports = authController;