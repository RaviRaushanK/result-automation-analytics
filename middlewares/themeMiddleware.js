/**
 * Theme middleware – reads theme preference from cookie or defaults to light.
 * Exposes `theme` and `themeClass` locals for use in EJS.
 */
module.exports = function themeMiddleware(req, res, next) {
  const theme = req.cookies?.theme || 'light';
  res.locals.theme = theme; // 'light' or 'dark'
  // Used to set data-theme attribute on <html>
  res.locals.themeClass = `theme-${theme}`;
  next();
};