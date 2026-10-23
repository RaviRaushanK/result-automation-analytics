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
    const api = typeof ExamPeriod !== 'undefined' ? ExamPeriod : require('./exam-period');
    const start = api.startIndex(session), end = api.endIndex(session);
    if (start === null || end === null) return '';
    const current = now.getFullYear() * 12 + now.getMonth();
    return end < current ? 'completed' : start <= current ? 'active' : 'upcoming';
  }
  function splitBatchName(batch) {
    const name = String(batch.batch_name || '').trim();
    const match = name.match(/^(.*?)\s*((?:19|20|21)\d{2}|2200)$/);
    return { course_name: match && match[1].trim() ? match[1].trim() : name, batch_year: match ? Number(match[2]) : batch.start_year || '' };
  }
  function currentSession(sessions, now = new Date()) {
    const api = typeof ExamPeriod !== 'undefined' ? ExamPeriod : require('./exam-period');
    const period = s => api.startIndex(s);
    const valid = sessions.filter(s => sessionStatus(s, now));
    const recent = valid.filter(s => sessionStatus(s, now) !== 'upcoming').sort((a, b) => period(b) - period(a) || Number(b.exam_session_id) - Number(a.exam_session_id));
    return recent[0] || valid.sort((a, b) => period(a) - period(b) || Number(b.exam_session_id) - Number(a.exam_session_id))[0] || null;
  }
  return { sortBatches, semesterCount, sessionStatus, splitBatchName, currentSession };
});
