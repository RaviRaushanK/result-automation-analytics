/* Display-only GPA formatting shared by Node/EJS and browser views. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GpaFormat = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function format(value, unavailable) {
    const fallback = unavailable === undefined ? '\u2014' : unavailable;
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Math.abs(numeric) >= 1e21) return fallback;
    return numeric.toFixed(2);
  }
  function isKey(key) { return /(?:sgpa|cgpa)$/i.test(String(key)); }
  return { format: format, isKey: isKey };
});
