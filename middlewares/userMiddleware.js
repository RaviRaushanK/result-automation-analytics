/**
 * User Middleware
 * ----------------
 * Populates req.user and res.locals.user from the current session.
 * Does not perform authentication.
 */

module.exports = (req, res, next) => {
  if (req.session?.adminId) {
    req.user = {
      adminId: req.session.adminId,
      username: req.session.username,
      role: req.session.role
    };

    res.locals.user = {
      adminId: req.session.adminId,
      username: req.session.username,
      role: req.session.role
    };
  } else {
    req.user = null;
    res.locals.user = null;
  }

  next();
};