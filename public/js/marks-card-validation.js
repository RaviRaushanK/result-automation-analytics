(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarksCardValidation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var formats = Object.freeze({
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
  });
  var extensions = Object.freeze(Object.keys(formats));
  function error(file, options) {
    options = options || {};
    if (!file) return 'Choose a PDF, PNG, JPG or JPEG marks card.';
    var name = String(file.name || file.originalname || '');
    var match = name.toLowerCase().match(/\.[^.]+$/);
    var ext = match ? match[0] : '';
    var mime = String(file.type || file.mimetype || '').toLowerCase();
    if (!Object.hasOwn(formats, ext) || ((mime || options.requireMime) && formats[ext] !== mime)) {
      return 'Only PDF, PNG, JPG and JPEG marks cards are accepted. The file type must match its extension.';
    }
    var maxBytes = options.maxBytes || 15 * 1024 * 1024;
    if (file.size === 0) return 'The marks card file is empty.';
    if (file.size > maxBytes) return 'The marks card must be 15 MB or smaller.';
    return '';
  }
  return Object.freeze({ formats: formats, extensions: extensions, error: error });
});

