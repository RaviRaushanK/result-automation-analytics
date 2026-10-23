'use strict';

// Rendering fixtures only: these screens never submit academic changes.
const student = { name: 'TEST STUDENT WITH A LONG COMPOUND FAMILY NAME', usn: '1MV25MC001' };
const sessionDisplay = 'MCA 2025 - June 2026 - Semester 1';
const subject = {
  subject_id: 1, subject_code: 'MMC101', subject_name: 'PROGRAMMING AND PROBLEM SOLVING WITH ADVANCED APPLICATIONS',
  credits: 4, max_internal: 50, max_external: 50, max_marks: 100,
  internalMarks: 40, externalMarks: 40, totalMarks: 80, percent: 80,
  grade: 'A+', grade_point: 9, result_status: 'pass', original_marks: 40,
  match_state: 'MATCHED', subjectCode: 'MMC101', subjectName: 'PROGRAMMING AND PROBLEM SOLVING',
  oldMarks: 40, rvMarks: 80, finalMarks: 80, oldResult: 'FAIL', finalResult: 'PASS'
};
const base = {
  title: 'Result Management responsive verification', resultManagementPage: true,
  pageStyles: ['/css/result-success.css', '/css/result-upload.css'],
  student, sessionDisplay, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
  importId: 9000, resultId: 9000, examSessionId: 9000, studentId: 9000,
  subjects: [subject], subjectCount: 1, error: null, notice: null, warnings: [],
  fileUrl: 'about:blank', fileType: 'pdf', file_name: 'marks-card-' + 'long-file-name-'.repeat(12) + '.pdf',
  meta: { importId: 9000, resultId: 9000, studentName: student.name, studentUsn: student.usn,
    sessionDisplay, attemptNo: 1, examType: 'REGULAR', examSessionId: 9000,
    docUrl: 'about:blank', docName: 'marks-card.pdf', warnings: [], unmatched: [], rawText: 'MARKS '.repeat(80) },
  errors: {}, enteredVals: {}, missingSubjects: [],
  rows: [{ srid: 1, code: subject.subject_code, name: subject.subject_name, original: { total: 40, status: 'fail', grade: 'F' },
    max_internal: 50, max_external: 50, max_marks: 100, evidence: { ...subject, revised_int: 40, revised_ext: 40 },
    credits: 4, maxInternal: 50, maxExternal: 50, maxMarks: 100, origMarks: 40, origStatus: 'fail', origGrade: 'F', changed: true,
    effective: { marks: 80, status: 'pass', grade: 'A+' } }]
};
const review = { proposal: [], aggregate_preview: { overall_result: 'pass', sgpa: 9, cgpa: 9 }, submitted_at: '2026-10-16', submitted_by: 'Test Admin' };
const pages = {
  upload: ['results/upload', { batches: [{ batch_id: 9000, batch_name: 'MCA 2025', start_year: 2025, end_year: 2027 }], selectedBatchId: 9000, sessions: [{ exam_session_id: 9000, batch_id: 9000, display_name: sessionDisplay }] }],
  review: ['results/review', { extractionWarning: null, formError: null, registrationBlocked: false, duplicateStudent: false, maxInternal: 50, maxExternal: 50 }],
  blocked: ['results/review', { formError: 'Student is not registered in the selected batch. Add or restore the student before continuing.', registrationBlocked: true }],
  preview: ['results/preview', { data: { student, subjects: [subject], overallResult: 'pass', sgpa: 9, cgpa: 9, failedSubjectCount: 0 } }],
  success: ['results/success', { savedConfirmed: true, studentName: student.name, usn: student.usn, attemptNo: 1, examType: 'REGULAR', subjectsCount: 1, overallResult: 'pass', sgpa: 9, cgpa: 9 }],
  logs: ['results/logs', { logs: [{ date: '16/10/2026 10:30 AM', session_display: sessionDisplay, file_name: base.file_name, imported_records: 1, total_records: 1, status: 'extracted', import_id: 9000 }] }],
  sessions: ['revaluation/exam-session-picker', { sessions: [{ examSessionId: 9000, display: sessionDisplay }] }],
  students: ['revaluation/exam-session-students', { session: { id: 9000, display: sessionDisplay }, query: '', students: [{ student_id: 9000, student_name: student.name, usn: student.usn }] }],
  attempts: ['revaluation/result-attempt-picker', { studentName: student.name, attempts: [{ result_id: 9000, attempt_no: 1, exam_type: 'REGULAR', result_status: 'fail', sgpa: 4, cgpa: 4, reval_state: 'AVAILABLE' }] }],
  'revaluation-upload': ['revaluation/upload', { isReplace: false }],
  pending: ['revaluation/pending', { status: 'extracted', import_type: 'REVALUATION', uploadedBy: 'Test Admin', createdAt: '2026-10-16', documents: [{ file_name: base.file_name, file_url: 'about:blank' }] }],
  extraction: ['revaluation/review', { mode: 'edit', review: null,
    meta: { ...base.meta, ocrStudent: { name: 'DIFFERENT STUDENT', usn: '1MV25MC099' } },
    identityCheck: { severity: 'mismatch', message: 'The uploaded card belongs to another student.' },
    identityConfirmed: false, identityBlocking: true }],
  'revaluation-review': ['revaluation/review', { mode: 'edit', review: null }],
  locked: ['revaluation/review', { mode: 'locked', review }],
  confirm: ['revaluation/review', { mode: 'confirm', review }],
  outcome: ['revaluation/outcome', { logStatus: 'success', reviewedAt: null, reviewPresent: true,
    aggregates: { overall_result: 'pass', sgpa: 9, cgpa: 9, failed_subject_count: 0 },
    origResult: { result_status: 'fail', sgpa: 4, cgpa: 4, failed_subject_count: 1 },
    events: [{ id: 1, srid: 1, no: 1, originalMarks: 40, revisedMarks: 80, originalStatus: 'fail', revisedStatus: 'pass', revisedGrade: 'A+', isEffective: true, remarks: '' }] }]
};
module.exports = { pages, base };
