'use strict';
module.exports = (req, res) => res.redirect(307, '/exam-sessions' + (req.url === '/' ? '' : req.url));
