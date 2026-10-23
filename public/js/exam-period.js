(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExamPeriod = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MONTHS = Object.freeze([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]);
  const NAMES = Object.freeze([
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]);

  function month(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) return value;
    if (typeof value !== 'string') return null;
    const text = value.trim().toLowerCase();
    if (/^(?:[1-9]|1[0-2])$/.test(text)) return Number(text);
    const index = NAMES.findIndex(name => text === name.toLowerCase() || text === name.slice(0, 3).toLowerCase());
    return index < 0 ? null : index + 1;
  }

  function year(value) {
    if (!['string', 'number'].includes(typeof value) || !/^\d{4}$/.test(String(value).trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200 ? parsed : null;
  }

  function normalize(input) {
    input = input || {};
    const startMonth = month(input.exam_start_month ?? input.start_month ?? input.exam_session);
    const startYear = year(input.exam_start_year ?? input.start_year ?? input.exam_year);
    const endMonth = month(input.exam_end_month ?? input.end_month ?? startMonth);
    const endYear = year(input.exam_end_year ?? input.end_year ?? startYear);
    if (!startMonth || !startYear || !endMonth || !endYear) return null;
    const start = startYear * 12 + startMonth - 1, end = endYear * 12 + endMonth - 1;
    if (end < start) return null;
    return { exam_start_month: startMonth, exam_start_year: startYear,
      exam_end_month: endMonth, exam_end_year: endYear };
  }

  function key(input) {
    const p = normalize(input);
    return p ? [p.exam_start_year, p.exam_start_month, p.exam_end_year, p.exam_end_month].join('-') : null;
  }

  function format(input) {
    const p = normalize(input);
    if (!p) return '';
    const start = MONTHS[p.exam_start_month - 1], end = MONTHS[p.exam_end_month - 1];
    if (p.exam_start_month === p.exam_end_month && p.exam_start_year === p.exam_end_year) return `${start} ${p.exam_start_year}`;
    if (p.exam_start_year === p.exam_end_year) return `${start} / ${end} ${p.exam_end_year}`;
    return `${start} ${p.exam_start_year} / ${end} ${p.exam_end_year}`;
  }

  function startIndex(input) { const p = normalize(input); return p ? p.exam_start_year * 12 + p.exam_start_month - 1 : null; }
  function endIndex(input) { const p = normalize(input); return p ? p.exam_end_year * 12 + p.exam_end_month - 1 : null; }

  function parseText(text) {
    const source = String(text || '').replace(/\u00a0/g, ' ');
    // Restrict matching to text followed by EXAM/EXAMINATION so announcement dates cannot become periods.
    const monthName = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
    const two = new RegExp('\\b' + monthName + '(?:\\s*[- ]\\s*(\\d{4}))?\\s*\\/\\s*' + monthName + '\\s*[- ]\\s*(\\d{4})(?:\\s+(?:EXAM|EXAMINATION)\\b)?', 'i').exec(source);
    if (two) {
      const endYear = year(two[4]), startYear = year(two[2]) || endYear;
      return normalize({ exam_start_month: month(two[1]), exam_start_year: startYear,
        exam_end_month: month(two[3]), exam_end_year: endYear });
    }
    const one = new RegExp('\\b' + monthName + '\\s*[- ]\\s*(\\d{4})\\s+(?:EXAM|EXAMINATION)\\b', 'i').exec(source);
    const labeled = new RegExp('\\bEXAM(?:INATION)?(?:\\s+(?:SESSION|PERIOD))?\\s*[:=-]\\s*' + monthName + '[\\s,/-]+(\\d{4})\\b', 'i').exec(source);
    const single = one || labeled;
    return single ? normalize({ exam_start_month: month(single[1]), exam_start_year: year(single[2]) }) : null;
  }

  return { MONTHS, NAMES, month, year, normalize, key, format, startIndex, endIndex, parseText };
});
