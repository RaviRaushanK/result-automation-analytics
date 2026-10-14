(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AcademicFormOptions = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function sortBatches(batches) {
    return batches.slice().sort((a, b) => Number(b.start_year) - Number(a.start_year) || Number(b.end_year) - Number(a.end_year) || Number(b.batch_id) - Number(a.batch_id));
  }
  function semesterCount(batch) {
    const start = Number(batch?.start_year), end = Number(batch?.end_year);
    return Number.isInteger(start) && Number.isInteger(end) && start >= 1900 && end <= 2200 && end > start ? (end - start) * 2 : 0;
  }
  function sessionStatus(session, now = new Date()) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const month = String(session.exam_session || '').trim().toLowerCase();
    const index = months.findIndex(value => value === month || value.slice(0, 3) === month);
    const year = Number(session.exam_year);
    if (index < 0 || !Number.isInteger(year) || year < 1900 || year > 2200) return '';
    const period = year * 12 + index, current = now.getFullYear() * 12 + now.getMonth();
    return period < current ? 'completed' : period === current ? 'active' : 'upcoming';
  }
  function splitBatchName(batch) {
    const name = String(batch.batch_name || '').trim();
    const match = name.match(/^(.*?)\s*((?:19|20|21)\d{2}|2200)$/);
    return { course_name: match && match[1].trim() ? match[1].trim() : name, batch_year: match ? Number(match[2]) : batch.start_year || '' };
  }
  function currentSession(sessions, now = new Date()) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const period = s => Number(s.exam_year) * 12 + months.indexOf(String(s.exam_session).slice(0, 3).toLowerCase());
    const valid = sessions.filter(s => sessionStatus(s, now));
    const recent = valid.filter(s => sessionStatus(s, now) !== 'upcoming').sort((a, b) => period(b) - period(a) || Number(b.session_id) - Number(a.session_id));
    return recent[0] || valid.sort((a, b) => period(a) - period(b) || Number(b.session_id) - Number(a.session_id))[0] || null;
  }
  return { sortBatches, semesterCount, sessionStatus, splitBatchName, currentSession };
});
