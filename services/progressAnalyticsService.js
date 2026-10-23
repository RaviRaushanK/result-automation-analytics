'use strict';

const repository = require('../repositories/reportsRepository');
const outcomes = require('./academicOutcomeService');
const policy = require('./academicPolicy');

function normalize(query = {}) {
  const positive = value => typeof value !== 'object' && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
  const batch_id = positive(query.batch_id);
  if (!batch_id) throw Object.assign(new Error('Select a batch.'), { status: 400 });
  const semester = positive(query.semester), academic_year = positive(query.academic_year);
  if (query.semester != null && query.semester !== '' && !semester || query.academic_year != null && query.academic_year !== '' && !academic_year) {
    throw Object.assign(new Error('Select one valid academic period.'), { status: 400 });
  }
  if (semester && academic_year || semester > 24 || academic_year > 12) {
    throw Object.assign(new Error('Select one valid academic period.'), { status: 400 });
  }
  return { batch_id, semester, academic_year, mode: query.mode === 'original' ? 'original' : 'effective' };
}

function periods(data) {
  return [...new Set([...data.courses.filter(c => c.status === 'active').map(c => Number(c.semester)),
    ...data.results.map(r => Number(r.semester))])].filter(n => Number.isInteger(n) && n > 0 && n <= 24).sort((a, b) => a - b);
}
function emptyCounts() { return { total: 0, withoutBacklog: 0, withBacklog: 0, uncleared: 0, unknown: 0, backlogStudents: 0, backlogCleared: 0, clearanceRate: null }; }
function status(value) {
  if (value.withoutBacklog === 'Y') return 'withoutBacklog';
  if (value.withBacklog === 'Y') return 'withBacklog';
  if (value.cleared === false && value.withBacklog === 'N') return 'uncleared';
  return 'unknown';
}
function finish(counts) {
  counts.clearanceRate = counts.backlogStudents ? Number((counts.backlogCleared / counts.backlogStudents * 100).toFixed(2)) : null;
  return counts;
}

// Only aggregate the canonical outcomes; all course/attempt decisions stay in the academic service.
function aggregate(data, students, filters) {
  const semesters = periods(data);
  const years = policy.academicYearGroups(semesters.map(String));
  const selected = filters.academic_year ? years.find(y => y.year === filters.academic_year) : null;
  const selectedTerms = selected ? selected.semesters : filters.academic_year ? [] : [String(filters.semester)];
  const label = selected ? selected.label : filters.academic_year ? `Year ${filters.academic_year}` : `Semester ${filters.semester || '-'}`;
  const summary = emptyCounts(), attention = [], courseMap = new Map();
  const trends = semesters.map(semester => ({ semester, label: `Semester ${semester}`, ...emptyCounts(), applicable: 0 }));
  const resultsByStudent = new Map(), subjectsByStudent = new Map();
  for (const [rows, map] of [[data.results, resultsByStudent], [data.subjects, subjectsByStudent]]) {
    for (const row of rows) {
      const id = String(row.student_id);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
    }
  }
  for (const student of students) {
    const history = { courses: data.courses, results: resultsByStudent.get(String(student.student_id)) || [], subjects: subjectsByStudent.get(String(student.student_id)) || [] };
    const cache = new Map(semesters.map(term => [String(term), outcomes.semesterOutcome(history, student.student_id, String(term))]));
    const value = outcomes.academicYearOutcome(history, student.student_id, selectedTerms);
    const state = status(value);
    summary.total++; summary[state]++;
    const terms = selectedTerms.map(term => cache.get(term)).filter(Boolean);
    // A verified first-sitting failure establishes backlog; unknown classifications are excluded.
    const hadBacklog = state !== 'unknown' && terms.some(term => term.firstAttempt === 'F');
    if (hadBacklog) { summary.backlogStudents++; if (state === 'withBacklog') summary.backlogCleared++; }
    for (const trend of trends) {
      if (!history.results.some(r => String(r.semester) === String(trend.semester))) continue;
      trend.applicable++; trend.total++;
      trend[status(outcomes.academicYearOutcome(history, student.student_id, [String(trend.semester)]))]++;
    }
    if (state === 'uncleared') {
      const courses = terms.flatMap(term => term.courses.filter(c => c.cleared === false));
      const latest = courses.map(c => c.latestAttempt).filter(Boolean).sort(policy.order).at(-1);
      attention.push({ studentId: student.student_id, usn: student.usn, name: student.student_name, period: label,
        unclearedCourses: courses.map(c => c.subjectCode).join(', '),
        latestAttempt: latest ? `${require('./academicPolicy').formatExamPeriod(latest)} / ${latest.exam_type} / Attempt ${latest.attempt_no}` : '-' });
    }
    if (!hadBacklog) continue;
    for (const term of terms) {
      const firstRows = history.subjects.filter(s => String(s.result_id) === String(term.firstRegularResult?.result_id));
      for (const course of term.courses) {
        if (!firstRows.some(s => String(s.course_id_snapshot ?? s.course_id) === String(course.courseId) && s.outcome_status === 'fail')) continue;
        if (course.cleared === null || course.cleared === true && !course.clearedViaRetake) continue;
        const key = String(course.courseId);
        if (!courseMap.has(key)) courseMap.set(key, { courseId: course.courseId, code: course.subjectCode, name: course.definition.subject_name, semester: term.semester, backlog: 0, cleared: 0, uncleared: 0 });
        const row = courseMap.get(key); row.backlog++; row[course.cleared ? 'cleared' : 'uncleared']++;
      }
    }
  }
  return { label, summary: finish(summary), semesters, years, trends: trends.filter(t => t.applicable), attention: attention.slice(0, 20),
    attentionTotal: attention.length, courses: [...courseMap.values()].map(c => ({ ...c, clearanceRate: Number((c.cleared / c.backlog * 100).toFixed(2)) })).sort((a, b) => b.backlog - a.backlog || String(a.code).localeCompare(String(b.code))) };
}

async function getProgress(query) {
  const filters = normalize(query);
  if (!await repository.batch(filters.batch_id)) throw Object.assign(new Error('Batch not found.'), { status: 404 });
  const roster = await outcomes.load(filters.batch_id, [], filters.mode);
  const recorded = await repository.progressSemesters(filters);
  if (!filters.semester && !filters.academic_year) filters.semester = Number(recorded.at(-1)?.semester) || periods(roster).at(0);
  const total = Number((await repository.progressStudentCount(filters)).total_rows);
  const combined = { label: '', summary: emptyCounts(), semesters: periods({ ...roster, results: recorded }), years: [], trends: [], attention: [], attentionTotal: 0, courses: [] };
  const trendMap = new Map(), courseMap = new Map();
  // Fixed-size population chunks load three history queries each, never one query per student.
  for (let offset = 0; offset < total; offset += 500) {
    const students = await repository.progressStudents(filters, 500, offset);
    const data = await outcomes.load(filters.batch_id, students.map(s => s.student_id), filters.mode);
    const part = aggregate(data, students, filters);
    combined.label = part.label;
    for (const key of Object.keys(combined.summary)) if (key !== 'clearanceRate') combined.summary[key] += part.summary[key];
    combined.attentionTotal += part.attentionTotal;
    combined.attention.push(...part.attention.slice(0, Math.max(0, 20 - combined.attention.length)));
    for (const row of part.trends) {
      if (!trendMap.has(row.semester)) trendMap.set(row.semester, { ...row, ...emptyCounts(), applicable: 0 });
      const target = trendMap.get(row.semester);
      for (const key of ['total', 'withoutBacklog', 'withBacklog', 'uncleared', 'unknown', 'applicable']) target[key] += row[key];
    }
    for (const row of part.courses) {
      if (!courseMap.has(row.courseId)) courseMap.set(row.courseId, { ...row, backlog: 0, cleared: 0, uncleared: 0 });
      const target = courseMap.get(row.courseId);
      for (const key of ['backlog', 'cleared', 'uncleared']) target[key] += row[key];
    }
  }
  combined.years = policy.academicYearGroups(combined.semesters.map(String));
  if (!combined.label) combined.label = filters.academic_year ? combined.years.find(y => y.year === filters.academic_year)?.label || `Year ${filters.academic_year}` : `Semester ${filters.semester || '-'}`;
  combined.trends = [...trendMap.values()].sort((a, b) => a.semester - b.semester);
  combined.courses = [...courseMap.values()].map(c => ({ ...c, clearanceRate: Number((c.cleared / c.backlog * 100).toFixed(2)) })).sort((a, b) => b.backlog - a.backlog || String(a.code).localeCompare(String(b.code)));
  return { success: true, mode: filters.mode, filters, ...combined, summary: finish(combined.summary) };
}
module.exports = { getProgress, aggregate, normalize };
