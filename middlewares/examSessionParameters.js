'use strict';
const { normalize } = require('../services/examSessionParameters');
module.exports = function examSessionParameters(req, res, next) {
  try {
    const query = normalize(req.query || {});
    const body = normalize(req.body || {});
    if (query.exam_session_id !== undefined && body.exam_session_id !== undefined
        && String(query.exam_session_id) !== String(body.exam_session_id)) {
      throw Object.assign(new Error('Conflicting exam session parameters in the URL and form.'), { status: 400 });
    }
    // Express 5 exposes req.query through a getter.
    Object.defineProperty(req, 'query', { value: query, configurable: true, writable: true });
    req.body = body;
    next();
  } catch (error) {
    if (req.file?.path) require('fs').unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, message: error.message });
  }
};
