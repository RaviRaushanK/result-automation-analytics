(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ExamSessionParameters = api;
    // Preserve bookmarked academic filters before page-specific scripts read
    // location.search. Authentication URLs and HTTP session state are untouched.
    if (/^\/(analytics|reports|results|revaluation|subjects|faculty|exam-sessions|dashboard)(\/|$)/.test(root.location.pathname)) {
      var url = new URL(root.location.href);
      var input = {};
      url.searchParams.forEach(function (value, key) { input[key] = value; });
      var normalized = api.normalize(input);
      var changed = false;
      api.aliases.forEach(function (key) { if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; } });
      if (changed) {
        url.searchParams.set('exam_session_id', normalized.exam_session_id);
        root.history.replaceState(root.history.state, '', url.pathname + url.search + url.hash);
      }
    }
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var aliases = ['session_id', 'sessionId', 'examSessionId', 'session'];
  function normalize(input) {
    input = input || {};
    var output = Object.assign({}, input);
    var keys = ['exam_session_id'].concat(aliases).filter(function (key) { return input[key] !== undefined; });
    if (keys.length) {
      var values = keys.map(function (key) { return input[key]; });
      if (values.some(function (value) { return value !== null && !['string', 'number'].includes(typeof value); })
          || values.some(function (value) { return String(value) !== String(values[0]); })) {
        var error = new Error('Conflicting or invalid exam session parameters. Submit one exam_session_id.');
        error.status = 400;
        throw error;
      }
      output.exam_session_id = values[0];
    }
    aliases.forEach(function (key) { delete output[key]; });
    return output;
  }
  return { normalize: normalize, aliases: aliases };
});
