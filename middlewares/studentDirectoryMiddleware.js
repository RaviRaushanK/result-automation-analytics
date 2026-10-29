'use strict';
module.exports = function studentDirectory(req, res, next) {
  const role = req.user?.role ?? req.session?.role;
  if (role === 'admin') return next();
  const message = 'You are not authorized to access the student directory.';
  if (req.path.startsWith('/api')) return res.status(403).json({ success: false, message });
  return res.status(403).send(message);
};
