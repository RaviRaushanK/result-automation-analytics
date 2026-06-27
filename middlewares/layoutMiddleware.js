module.exports = function layoutMiddleware(req, res, next) {
  const path = req.path.toLowerCase();

  if (path.startsWith('/login')) {
    res.locals.layoutType = 'auth';
  } else if (path.startsWith('/reports') && (path.endsWith('/print') || path.endsWith('.pdf'))) {
    res.locals.layoutType = 'report';
  } else {
    res.locals.layoutType = 'main';
  }

  next();
};
