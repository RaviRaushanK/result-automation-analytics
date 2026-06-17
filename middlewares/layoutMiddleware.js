/**
 * Layout middleware – determines which EJS layout to use based on the request path.
 * Sets res.locals.layout to one of: 'auth', 'main', 'report'.
 */
module.exports = function layoutMiddleware(req, res, next) {
  const path = req.path.toLowerCase();

  // Auth routes (no navbar/sidebar)
  if (path.startsWith('/auth') || path.startsWith('/login') || path.startsWith('/register')) {
    res.locals.layout = 'auth';
    return next();
  }

  // Report/print routes – usually end with /print or are under /reports
  if (path.startsWith('/reports') && (path.endsWith('/print') || path.endsWith('.pdf'))) {
    res.locals.layout = 'report';
    return next();
  }

  // Default to main layout for all internal pages
  res.locals.layout = 'main';
  next();
};