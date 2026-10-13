/**
 * Theme middleware – reads theme preference from cookie or defaults to light.
 * Exposes `theme` and `themeClass` locals for use in EJS.
 */
module.exports = function themeMiddleware(req, res, next) {
  const theme = ['light', 'dark'].includes(req.cookies?.theme) ? req.cookies.theme : 'light';
  res.locals.themePreference = ['system', 'light', 'dark'].includes(req.cookies?.themePreference) ? req.cookies.themePreference : ['light', 'dark'].includes(req.cookies?.theme) ? req.cookies.theme : 'system';
  res.locals.theme = theme; // 'light' or 'dark'
  // Used to set data-theme attribute on <html>
  res.locals.themeClass = `theme-${theme}`;
  next();
};
