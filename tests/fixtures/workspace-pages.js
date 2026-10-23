'use strict';

const batch = { batch_id: 9001, batch_name: 'MCA 2025', start_year: 2025, end_year: 2027,
  department_id: 1, status: 'active', Department: { department_name: 'Master of Computer Applications', department_code: 'MCA' } };
const departments = [{ department_id: 1, department_name: 'Master of Computer Applications', department_code: 'MCA' }];
const sessions = [{ exam_session_id: 9100, batch_id: 9001, semester: '1', exam_session: 'Jun', exam_year: 2026, Batch: batch }];
const subjects = [{ subject_id: 9200, exam_session_id: 9100, course_id: 9300, subject_code: 'MMC101',
  subject_name: 'PROGRAMMING AND PROBLEM SOLVING WITH ADVANCED APPLICATIONS', credits: 4,
  subject_type: 'theory', max_internal: 50, max_external: 50, max_marks: 100, Faculties: [{ faculty_id: 1, faculty_name: 'TEST FACULTY WITH A LONG NAME', status: 'active' }] }];
const student = { student_id: 9400, batch_id: 9001, usn: '1MV25MC001', student_name: 'TEST STUDENT WITH A LONG COMPOUND FAMILY NAME',
  email: 'long.student.email.address@example.com', category: 'GENERAL MERIT', status: 'active', Batch: batch };
const pagination = { page: 1, pageSize: 25, totalRows: 1, totalPages: 1 };
const listing = { rows: [student], pagination, filters: { search: '', batch_id: '9001', category: '', status: '' } };
const base = { title: 'Responsive workspace verification', pageStyles: ['/css/dashboard.css', '/css/batches.css'],
  batches: [batch], departments, batch, sessions, canManageRoster: true, listing, categories: ['GENERAL MERIT'], initialError: null };
const course = { course_id: 9300, subject_code: 'MMC101', subject_name: subjects[0].subject_name, credits: 4, max_marks: 100, is_required: true };
const roster = { selected: { batch_id: 9001, semester: '1' }, semesterLimit: 4, saved: false };
const pages = {
  dashboard: ['dashboard/index', { batches: [batch, { ...batch, batch_id: 9002, batch_name: 'MCA 2024' }], semesters: ['1', '2', '3', '4'], batchSemesters: [...['1', '2', '3', '4'].map(semester => ({ batch_id: 9001, semester })), { batch_id: 9002, semester: '2' }], pageStyles: ['/css/dashboard.css'] }],
  batches: ['batches/index', {}],
  sessions: ['exam-sessions/index', { pageStyles: [...base.pageStyles, '/css/exam-sessions.css'] }],
  subjects: ['subjects/index', { pageStyles: [...base.pageStyles, '/css/subjects.css'] }],
  roster: ['subjects/courses', { ...roster, editingRoster: true, courses: [{ ...course, roster_verified: false }] }],
  'roster-verified': ['subjects/courses', { ...roster, editingRoster: false, courses: [{ ...course, roster_verified: true }] }],
  'roster-edit': ['subjects/courses', { ...roster, editingRoster: true, courses: [{ ...course, roster_verified: true }] }],
  faculty: ['faculty/index', { pageStyles: [...base.pageStyles, '/css/faculty.css'] }],
  students: ['students/index', { pageStyles: ['/css/dashboard.css', '/css/students.css'] }]
};
for (const name of ['roster', 'roster-verified', 'roster-edit']) pages[name][1].pageStyles = [...base.pageStyles, '/css/subjects.css'];

function api(req, res, next) {
  if (!(req.get('referer') || '').includes('/verification/workspace/')) return next();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Rendering verification does not permit writes.' });
  if (req.path === '/dashboard/analytics' && req.query.semester === '4') return res.status(503).json({ success: false });
  let data;
  if (req.path === '/batches') data = [batch];
  else if (req.path === '/batches/9001') data = batch;
  else if (req.path === '/exam-sessions') data = sessions;
  else if (req.path === '/subjects/session/9100') return res.json(subjects);
  else if (req.path === '/faculty/api') data = subjects[0].Faculties;
  else if (req.path === '/faculty/api/departments') data = departments;
  else if (req.path === '/students/api/stats') data = { total: 1, active: 1, inactive: 0, categories: 1 };
  else if (req.path === '/students/api/categories') data = ['GENERAL MERIT'];
  else if (req.path === '/students/api/9400') data = student;
  else if (req.path === '/students/api/list') return res.json({ success: true, data: [student], pagination });
  else if (req.path === '/dashboard/analytics') data = {
    statistics: { totalStudents: 120, totalPass: 100, totalFail: 20, passPercentage: 83.33, failPercentage: 16.67, totalSubjects: 12, highestScore: 99, averageCGPA: 8.25 },
    subjectAverages: Array.from({ length: 12 }, (_, i) => ({ subject_id: 9200 + i, subject_code: 'MMC' + (101 + i), subject_name: subjects[0].subject_name, average_marks: 60 + i, max_marks: 100, attempted: 120, passed: 100 + i, failed: 20 - i, pass_percentage: Number(((100 + i) / 120 * 100).toFixed(2)) })),
    gradeDistribution: ['O', 'A+', 'A', 'B+', 'B', 'C', 'F'].map((grade, i) => ({ grade, count: [10, 20, 30, 15, 10, 15, 20][i], percentage: [10, 20, 30, 15, 10, 15, 20][i] / 120 * 100 })),
    gradeSummary: { graded: 120, missing: 0, total: 120 }
  };
  else if (req.path === '/dashboard/pass-fail') data = { pass: 100, fail: 20 };
  else if (req.path === '/dashboard/top-scorers') data = [{ ...student, exam_session_id: 9100, attempt_no: 1, sgpa: 9, cgpa: 9, rank: 1, result_status: 'pass' }];
  else return next();
  if (req.path.startsWith('/dashboard/')) {
    if (req.query.semester === '3') {
      if (req.path.endsWith('/analytics')) data = { statistics: { totalStudents: 0, totalPass: 0, totalFail: 0, passPercentage: 0, failPercentage: 0, totalSubjects: 0, highestScore: null, averageCGPA: null }, subjectAverages: [], gradeDistribution: [], gradeSummary: { graded: 0, missing: 0, total: 0 } };
      if (req.path.endsWith('/top-scorers')) data = [];
    } else if (req.path.endsWith('/analytics')) data.statistics.totalStudents = 120 + Number(req.query.semester || 0);
    if (req.query.semester === '1') return setTimeout(() => res.json({ success: true, data }), 250);
  }
  return res.json({ success: true, data });
}
module.exports = { pages, base, api };
