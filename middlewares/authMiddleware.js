/**
 * Authentication Middleware
 * Verifies session, redirects unauthenticated users to /login,
 * and attaches authenticated administrator to req.user and res.locals.user.
 */

module.exports = function authMiddleware(req, res, next) {
  // Check if administrator is authenticated via session
  if (req.session && req.session.adminId) {
    // Attach administrator info to req.user for controller access
    req.user = {
      adminId: req.session.adminId,
      username: req.session.username,
      role: req.session.role
    };
    // Make user available in all EJS views
    res.locals.user = {
      name: req.session.username,
      role: req.session.role
    };
    return next();
  }

  // Unauthenticated user requesting a page — redirect to login
  if (req.accepts('html')) {
    // Store the requested URL so we can redirect back after login
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }

  // Unauthenticated API request — return 401
  return res.status(401).json({ error: 'Authentication required' });
};
