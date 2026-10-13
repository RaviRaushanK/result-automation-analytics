'use strict';
const { randomBytes, timingSafeEqual } = require('node:crypto');
module.exports = function csrf(req, res, next) {
  if (!req.session) return res.status(403).send('A signed-in session is required.');
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.body?._csrf || req.get('X-CSRF-Token');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))) {
    return res.status(403).send('Your form session could not be verified. Reload the page and try again.');
  }
  next();
};
