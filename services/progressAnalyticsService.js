'use strict';

const repository = require('../repositories/reportsRepository');
const outcomes = require('./academicOutcomeService');
const policy = require('./academicPolicy');
const { semesterCount } = require('../public/js/academic-form-options');

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

function normalize(query = {}) {
  const positive = value => typeof value !== 'object' && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
  const batch_id = positive(query.batch_id);
  if (!batch_id) throw Object.assign(new Error('Select a batch.'), { status: 400 });
  const semester = positive(query.semester), academic_year = positive(query.academic_year);
  if (query.semester != null && query.semester !== '' && !semester || query.academic_year != null && query.academic_year !== '' && !academic_year) {
    invalid('Select one valid analysis scope.');
  }
  if (semester && academic_year || semester > 24 || academic_year > 12) {
    invalid('Select one valid analysis scope.');
  }
  const legacy = semester ? `semester:${semester}` : academic_year ? `year:${academic_year}` : undefined;
  let analysis_scope = legacy;
  if (query.analysis_scope !== undefined) {
    if (typeof query.analysis_scope !== 'string' || !/^(semester|year):[1-9]\d*$/.test(query.analysis_scope)) invalid('Select a valid analysis scope, such as semester:2 or year:1.');
    const [type, number] = query.analysis_scope.split(':');
    if (!positive(number) || Number(number) > (type === 'semester' ? 24 : 12)) invalid('Select a valid analysis scope.');
    if (legacy && legacy !== query.analysis_scope) invalid('Conflicting analysis scopes. Submit one analysis_scope.');
    analysis_scope = query.analysis_scope;
  }
  if (query.scope_type !== undefined || query.scope_value !== undefined) invalid('Use one analysis_scope parameter, such as semester:2 or year:1.');
  if (query.mode != null && !['original', 'effective'].includes(query.mode)) invalid('Select Original or Effective result basis.');
  const [type, value] = (analysis_scope || '').split(':');
  return { batch_id, analysis_scope, semester: type === 'semester' ? Number(value) : undefined,
    academic_year: type === 'year' ? Number(value) : undefined, mode: query.mode === 'original' ? 'original' : 'effective' };
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

function scopeDetails(filters) {
  const year = filters.academic_year ? policy.academicYearGroups([String(filters.academic_year * 2)]).at(-1) : null;
  const terms = year ? year.semesters : filters.semester ? [String(filters.semester)] : [];
  const label = year ? year.label : filters.semester ? `Semester ${filters.semester}` : 'Analysis Scope';
  const description = terms.length > 1 ? `Showing verified completion and backlog status across ${terms.map(term => 'Semester ' + term).join(' and ')}.`
    : terms.length ? `Showing verified completion and backlog status for ${label}.` : 'No recorded semester participation is available for this batch.';
  return { terms, label, description };
}

// Only aggregate the canonical outcomes; all course/attempt decisions stay in the academic service.
function aggregate(data, students, filters) {
  const semesters = periods({ courses: [], results: data.results });
  const years = policy.academicYearGroups(semesters.map(String));
  const { terms: selectedTerms, label, description } = scopeDetails(filters);
  const summary = emptyCounts(), attention = [], courseMap = new Map();
  // Preserve historical progression through the scope's last semester. Each
  // bar still includes only its own recorded participants, never future zeros.
  const trends = semesters.filter(term => term <= Math.max(0, ...selectedTerms.map(Number)))
    .map(semester => ({ semester, label: `Semester ${semester}`, ...emptyCounts(), applicable: 0 }));
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
    const cache = new Map([...new Set([...semesters.map(String), ...selectedTerms])].map(term => [term, outcomes.semesterOutcome(history, student.student_id, term)]));
    const value = outcomes.academicYearOutcome(history, student.student_id, selectedTerms);
    const terms = selectedTerms.map(term => cache.get(term));
    // Page-specific study-year precedence: a proven unresolved required course
    // needs attention even if another semester is missing. Missing evidence can
    // never certify clearance. Shared Report/outcome policies are unchanged.
    const state = selectedTerms.length > 1 && terms.some(term => term.courses.some(course => course.cleared === false)) ? 'uncleared' : status(value);
    summary.total++; summary[state]++;
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
        unclearedCourses: selectedTerms.length > 1 ? terms.map(term => ({ term, codes: term.courses.filter(c => c.cleared === false).map(c => c.subjectCode) }))
          .filter(row => row.codes.length).map(row => `Semester ${row.term.semester}: ${row.codes.join(', ')}`).join('; ') : courses.map(c => c.subjectCode).join(', '),
        latestAttempt: latest ? `${require('./academicPolicy').formatExamPeriod(latest)} / ${latest.exam_type} / Attempt ${latest.attempt_no}` : '-' });
    }
    // Course evidence is independent of scope-level completion: a cleared Sem 1
    // backlog still belongs in this table when Sem 2 history is missing.
    for (const term of terms) {
      if (term.firstAttempt !== 'F') continue;
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
  return { label, description, scopeSemesters: selectedTerms, summary: finish(summary), semesters, years, trends: trends.filter(t => t.applicable), attention: attention.slice(0, 20),
    attentionTotal: attention.length, courses: [...courseMap.values()].map(c => ({ ...c, clearanceRate: Number((c.cleared / c.backlog * 100).toFixed(2)) })).sort((a, b) => b.backlog - a.backlog || String(a.code).localeCompare(String(b.code))) };
}

async function getProgress(query) {
  const filters = normalize(query);
  const batch = await repository.batch(filters.batch_id);
  if (!batch) throw Object.assign(new Error('Batch not found.'), { status: 404 });
  const recorded = await repository.progressSemesters(filters);
  const configuredCount = semesterCount(batch);
  // Reuse recorded-participation availability; a future course roster alone
  // must not create a selectable semester. Batch duration bounds supported terms.
  const semesters = periods({ courses: [], results: recorded }).filter(term => !configuredCount || term <= configuredCount);
  const years = policy.academicYearGroups(semesters.map(String));
  if (filters.semester && !semesters.includes(filters.semester) || filters.academic_year && !years.some(year => year.year === filters.academic_year))
    invalid('The selected analysis scope is not available for this batch. Select a recorded semester or an available study year.');
  if (!filters.analysis_scope && semesters.length) { filters.semester = semesters.at(-1); filters.analysis_scope = `semester:${filters.semester}`; }
  const total = Number((await repository.progressStudentCount(filters)).total_rows);
  const details = scopeDetails(filters);
  const combined = { label: details.label, description: details.description, scopeSemesters: details.terms,
    summary: emptyCounts(), semesters, years, trends: [], attention: [], attentionTotal: 0, courses: [] };
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
  combined.trends = [...trendMap.values()].sort((a, b) => a.semester - b.semester);
  combined.courses = [...courseMap.values()].map(c => ({ ...c, clearanceRate: Number((c.cleared / c.backlog * 100).toFixed(2)) })).sort((a, b) => b.backlog - a.backlog || String(a.code).localeCompare(String(b.code)));
  return { success: true, mode: filters.mode, filters, ...combined, summary: finish(combined.summary) };
}
module.exports = { getProgress, aggregate, normalize };
