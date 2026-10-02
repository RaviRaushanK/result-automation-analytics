'use strict';

const EXAM_TYPES = Object.freeze(['REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT']);
const RETAKE_TYPES = Object.freeze(EXAM_TYPES.slice(1));
const SCHEME = 'PG_2022_2024_V1';
const POINTS = Object.freeze({ O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, F: 0 });
const isRegularAttempt = type => type === 'REGULAR';
const isRetakeAttempt = type => RETAKE_TYPES.includes(type);
// MCA academic years contain two consecutive semesters; no duration is assumed.
function academicYearGroups(semesters) {
  const numbers = semesters.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 24);
  const count = Math.ceil(Math.max(0, ...numbers) / 2);
  const names = ['First', 'Second', 'Third', 'Fourth'];
  return Array.from({ length: count }, (_, i) => ({ year: i + 1,
    label: names[i] ? `${names[i]} Year` : `Year ${i + 1}`, semesters: [String(i * 2 + 1), String(i * 2 + 2)] }));
}
function gradeFromPercent(pct) {
  if (!Number.isFinite(Number(pct)) || pct === null) return { grade: 'F', point: 0, status: 'fail' };
  for (const [minimum, grade] of [[90, 'O'], [80, 'A+'], [70, 'A'], [60, 'B+'], [55, 'B'], [50, 'C']]) {
    if (pct >= minimum) return { grade, point: POINTS[grade], status: 'pass' };
  }
  return { grade: 'F', point: 0, status: 'fail' };
}
function period(result) {
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(String(result.exam_session).toLowerCase());
  const year = Number(result.exam_year);
  return month < 0 || !Number.isInteger(year) || year < 1900 || year > 2200 ? null : year * 12 + month;
}
function order(a, b) {
  return (period(a) ?? 0) - (period(b) ?? 0) || Number(a.attempt_no) - Number(b.attempt_no) || Number(a.result_id) - Number(b.result_id);
}
const LEGACY_POINTS = Object.freeze({ S: 10, A: 9, B: 8, C: 7, D: 6, E: 4, F: 0 });
function legacySeedGrade(total) {
  for (const [minimum, grade] of [[90,'S'],[80,'A'],[70,'B'],[60,'C'],[50,'D'],[45,'E']]) if (total >= minimum) return grade;
  return 'F';
}
module.exports = { EXAM_TYPES, RETAKE_TYPES, SCHEME, POINTS, LEGACY_POINTS, legacySeedGrade, isRegularAttempt, isRetakeAttempt, academicYearGroups, gradeFromPercent, period, order };
