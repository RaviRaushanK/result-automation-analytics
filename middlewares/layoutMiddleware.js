/**
 * Layout middleware – sets the layout for all routes.
 * express-ejs-layouts will look for these files in views/layouts/ folder
 */
module.exports = function layoutMiddleware(req, res, next) {
  const path = req.path.toLowerCase();

  // Auth routes (no navbar/sidebar) - use auth layout
  if (path.startsWith('/auth') || path.startsWith('/login') || path.startsWith('/register')) {
    res.locals.layout = 'layouts/auth';  // Will look for views/layouts/auth.ejs
    return next();
  }

  // All other routes - don't set layout, use default from app.set('layout', 'layouts/main')
  next();
};