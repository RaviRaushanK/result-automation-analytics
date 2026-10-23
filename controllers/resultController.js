const crypto = require('crypto');
const { Result, SubjectResult, ImportLog, OcrExtraction, Student, Subject, Batch, ResultSession, sequelize } = require('../database/models');
const path = require('path');
const fs = require('fs');

// Document extraction service
const documentExtractor = require('../services/documentExtractor');
const academicPolicy = require('../services/academicPolicy');
const integrity = require('../services/academicIntegrity');
const configuration = require('../services/academicConfiguration');
const academicOutcomes = require('../services/academicOutcomeService');
const resultHistory = require('../services/resultHistoryService');
const { sortBatches } = require('../public/js/academic-form-options');
const { AcademicCourse } = require('../database/models');

// ============================================
// Academic rules — P.G. 2022/2024 scheme
// ============================================
const MAX_INTERNAL = 50;   // fallback when a subject row lacks limits
const MAX_EXTERNAL = 100;  // fallback when a subject row lacks limits
const PASS_PERCENT = 50;   // C grade (50-54%) is the minimum pass band

// ============================================
// Helpers
// ============================================
const generateSecureFilename = (originalName) => {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalName).toLowerCase();
  const nameWithoutExt = path.basename(originalName, ext);
  const safeName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
  return `result_${timestamp}_${safeName}_${randomStr}${ext}`;
};

const ensureUploadDirectory = () => {
  const uploadDir = path.join(__dirname, '..', 'uploads', 'results');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
};

// P.G. 2022/2024 Grade Points Scale — Score Range (%)
// O 90-100:10 · A+ 80-89:9 · A 70-79:8 · B+ 60-69:7 · B 55-59:6 · C 50-54:5 · F 0-49:0
const gradeFromPercent = academicPolicy.gradeFromPercent;

// ============================================
// Attempt parsing & validation (foundation for multi-attempt results)
// ============================================
const ALLOWED_EXAM_TYPES = academicPolicy.NEW_EXAM_TYPES;

// Sanitize attempt_no / exam_type coming from the browser/form state.
// - attempt_no: absent (undefined/null omitted) -> default 1. Present but
//   invalid ('' , '0', negative, non-integer, "abc") -> error. No upper cap.
// - exam_type : absent            -> default 'REGULAR'.
//               invalid value     -> error.
function sanitizeAttempt(rawNo, rawType, defaults = { attempt_no: 1, exam_type: 'REGULAR' }) {
  let attemptNo, examType;

  // attempt_no: undefined (field absent) -> default. null/'0'/negative/non-int
  //   -> rejected. Empty string -> rejected. No upper cap.
  if (rawNo === undefined) {
    attemptNo = defaults.attempt_no;
  } else if (rawNo === null) {
    return { ok: false, errors: ['attempt_no must not be null.'] };
  } else if (String(rawNo).trim() === '') {
    return { ok: false, errors: ['attempt_no must not be empty.'] };
  } else {
    const parsed = Number(String(rawNo).replace(/,/g, '').trim());
    if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
      return { ok: false, errors: ['attempt_no must be a whole number.'] };
    }
    if (parsed <= 0) {
      return { ok: false, errors: ['attempt_no must be greater than 0.'] };
    }
    attemptNo = parsed;
  }

  // exam_type
  if (rawType === undefined) {
    examType = defaults.exam_type;
  } else if (rawType === null || String(rawType).trim() === '') {
    return { ok: false, errors: ['Exam Type is required.'] };
  } else {
    const t = String(rawType).trim().toUpperCase();
    if (!ALLOWED_EXAM_TYPES.includes(t)) {
      return {
        ok: false,
        errors: [`exam_type must be one of: ${ALLOWED_EXAM_TYPES.join(', ')}.`]
      };
    }
    examType = t;
  }

  if (examType === 'REGULAR' && attemptNo !== 1) {
    return { ok: false, errors: ['REGULAR must use attempt 1. Use BACKLOG for a later attempt.'] };
  }
  if (examType === 'BACKLOG' && attemptNo < 2) {
    return { ok: false, errors: ['BACKLOG starts at attempt 2, after REGULAR attempt 1.'] };
  }

  return { ok: true, attempt_no: attemptNo, exam_type: examType };
};

// Load ImportLog + its session + saved OCR payload
async function loadImportContext(importId) {
  const log = await ImportLog.findByPk(importId, {
    include: [{
      model: ResultSession,
      include: [{ model: Batch, attributes: ['batch_name'] }]
    }]
  });
  if (!log) return null;
  if (log.import_type && log.import_type !== 'ORIGINAL') return null;

  const ocr = await OcrExtraction.findOne({
    where: { import_id: log.import_id },
    order: [['extraction_id', 'DESC']]
  });

  let saved = { student: { usn: '', name: '' }, subjects: [], warnings: [] };
  if (ocr && ocr.extracted_json) {
    const parsed = typeof ocr.extracted_json === 'string'
      ? safeParseJson(ocr.extracted_json)
      : ocr.extracted_json;
    if (parsed) saved = parsed;
  }

  return {
    log,
    ocr,
    session: log.ResultSession,
    saved,
    fileUrl: '/uploads/results/' + log.file_name,
    sessionDisplay: `${log.ResultSession.Batch.batch_name} | Sem ${log.ResultSession.semester} | ${academicPolicy.formatExamPeriod(log.ResultSession)}`
  };
}

function safeParseJson(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

function studentRegistrationError(student, session, usn) {
  if (student && String(student.batch_id) === String(session.batch_id)) return null;
  const batch = session.Batch?.batch_name || 'batch ' + session.batch_id;
  return `Student ${usn} is not registered in ${batch}. Add or restore the student in this batch, or correct the USN and selected result session before continuing.`;
}

function studentNameError(student, name, usn) {
  const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!normalize(name)) return null; // Required-field validation handles an empty entry.
  if (!normalize(student.student_name)) {
    return 'The registered name for USN ' + usn + ' is unavailable. Correct the student record before continuing.';
  }
  if (normalize(name) === normalize(student.student_name)) return null;
  return 'Student name does not match USN ' + usn + '. Registered name: ' + student.student_name +
    '. Correct the Student Name or USN, then click Validate again.';
}

async function duplicateResultError(student, session, attempt, transaction) {
  const existing = await Result.findOne({ where: {
    student_id: student.student_id, session_id: session.session_id, attempt_no: attempt.attempt_no
  }, transaction });
  return existing ? 'A result for USN ' + student.usn + ' already exists in this examination session for attempt ' +
    attempt.attempt_no + ' (' + attempt.exam_type + '). Correct the USN or choose the appropriate session and attempt before continuing.' : null;
}

// Core validation + computation used by review-validate, preview and import.
// markInputs: object keyed by `internal_<subject_id>` / `external_<subject_id>`
async function buildValidatedPayload(sessionId, studentInput, markInputs, options = {}) {
  const errors = {};
  const usn = integrity.usn(studentInput?.usn);
  const name = typeof studentInput?.name === 'string' ? studentInput.name.trim() : '';

  if (!usn) errors['student.usn'] = 'USN is required.';
  if (!name) errors['student.name'] = 'Student name is required.';

  const subjects = await Subject.findAll({
    where: { session_id: sessionId },
    order: [['subject_code', 'ASC']],
    raw: true,
    transaction: options.transaction
  });
  if (subjects.length === 0) errors.form = 'This result session has no subjects configured.';
  const retake = academicPolicy.isRetakeAttempt(options.exam_type);
  const session = options.session || await ResultSession.findByPk(sessionId, { transaction: options.transaction });
  const courses = session ? await AcademicCourse.findAll({ where: { batch_id: session.batch_id, semester: String(Number(session.semester)), status: 'active' }, raw: true, transaction: options.transaction }) : [];
  const byCourse = new Map(courses.map(course => [String(course.course_id), course]));
  const required = courses.filter(course => Number(course.is_required));
  const fullRoster = required.length > 0 && courses.every(course => Number(course.roster_verified))
    && subjects.length === required.length && required.every(course => subjects.some(subject => String(subject.course_id) === String(course.course_id)));
  if (!retake && !fullRoster) errors.form = 'Confirm the required semester courses and configure the complete regular subject roster before importing.';
  const suppliedIds = Object.keys(markInputs).map(key => key.match(/^(?:internal|external)_(\d+)$/)?.[1]).filter(Boolean);
  if (suppliedIds.some(id => !subjects.some(subject => String(subject.subject_id) === id))) errors.form = 'An attempted subject does not belong to this examination session.';

  const list = [];
  let allPoints = 0, allCredits = 0;      // SGPA: every registered course
  let failedCount = 0;

  for (const s of subjects) {
    // Per-subject limits from the database (fallbacks only for legacy rows)
    const maxInt = (s.max_internal !== null && s.max_internal !== undefined) ? s.max_internal : MAX_INTERNAL;
    const maxExt = (s.max_external !== null && s.max_external !== undefined) ? s.max_external : MAX_EXTERNAL;
    const maxTotal = (s.max_marks !== null && s.max_marks !== undefined) ? s.max_marks : (maxInt + maxExt);
    const credits = (s.credits !== null && s.credits !== undefined) ? s.credits : 0;

    const iRaw = markInputs[`internal_${s.subject_id}`];
    const eRaw = markInputs[`external_${s.subject_id}`];
    if (retake && [iRaw, eRaw].every(value => value === undefined || value === null || value === '')) continue;
    const course = byCourse.get(String(s.course_id));
    if (!s.course_id || !course || course.subject_code !== String(s.subject_code).trim().toUpperCase()
      || ['subject_name','subject_type','credits','max_internal','max_external','max_marks'].some(field => String(course[field]) !== String(s[field]))) {
      errors.form = 'An attempted subject has no matching academic course. Review its course definition before importing.';
    }
    // Keep genuine zero marks while rejecting malformed or fractional inputs.
    const iMissing = (iRaw === null || iRaw === undefined || iRaw === '');
    const eMissing = (eRaw === null || eRaw === undefined || eRaw === '');
    const parsedInternal = integrity.mark(iRaw), parsedExternal = integrity.mark(eRaw);
    const internal = parsedInternal.invalid || !parsedInternal.present ? NaN : parsedInternal.value;
    const external = parsedExternal.invalid || !parsedExternal.present ? NaN : parsedExternal.value;

    const fieldErrors = {};
    if (iMissing) {
      fieldErrors.internalMarks = 'Internal marks are required.';
    } else if (isNaN(internal) || internal < 0 || internal > maxInt) {
      fieldErrors.internalMarks = `Internal must be between 0 and ${maxInt}.`;
    }
    if (eMissing) {
      fieldErrors.externalMarks = 'External marks are required.';
    } else if (isNaN(external) || external < 0 || external > maxExt) {
      fieldErrors.externalMarks = `External must be between 0 and ${maxExt}.`;
    }

    const total = (isNaN(internal) ? 0 : internal) + (isNaN(external) ? 0 : external);
    if (Object.keys(fieldErrors).length === 0 && total > maxTotal) {
      fieldErrors.totalMarks = `Total ${total} exceeds maximum ${maxTotal} marks.`;
    }

    // Grade bands are on Score Range (%) per P.G. 2022/2024
    const pct = maxTotal > 0 ? Math.floor((total / maxTotal) * 100) : 0;
    const gradeInfo = gradeFromPercent(pct);

    allPoints += gradeInfo.point * credits;
    allCredits += credits;
    if (gradeInfo.status === 'fail') {
      failedCount++;
    }

    if (Object.keys(fieldErrors).length > 0) {
      errors[`subjects[${s.subject_id}]`] = fieldErrors;
    }

    list.push({
      subject_id: s.subject_id,
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      credits,
      max_internal: maxInt,
      max_external: maxExt,
      max_marks: maxTotal,
      internalMarks: isNaN(internal) ? null : internal,
      externalMarks: isNaN(external) ? null : external,
      totalMarks: total,
      percent: pct,
      grade: gradeInfo.grade,
      result_status: gradeInfo.status,
      grade_point: gradeInfo.point, course_id: s.course_id, grading_scheme_version: academicPolicy.SCHEME
    });
  }

  if (retake && !list.length) errors.form = 'Enter marks for at least one attempted subject.';
  const hasErrors = Object.keys(errors).length > 0;

  return {
    errors,
    hasErrors,
    payload: {
      configuration_snapshot: session ? configuration.snapshot(session, subjects, courses) : null,
      student: { usn, name },
      subjects: list,
      overallResult: (!hasErrors && failedCount === 0) ? 'pass' : 'fail',
      // SGPA = Σ(credits × grade points) / Σ(credits) over ALL registered courses
      sgpa: !retake && fullRoster && allCredits > 0 ? Number((allPoints / allCredits).toFixed(2)) : null,
      // Preview adds verified history separately; confirmation recalculates after persistence.
      cgpa: null,
      failedSubjectCount: failedCount
    }
  };
}

// Extract `internal_<id>` / `external_<id>` pairs out of a form body
function extractMarkInputs(body) {
  const inputs = {};
  Object.keys(body || {}).forEach(key => {
    if (/^(internal|external)_\d+$/.test(key)) inputs[key] = body[key];
  });
  return inputs;
}

async function documentContextErrors(saved, session, payload, attempt, verified, mixedRequested, transaction) {
  let mixedVerified = false;
  if (mixedRequested && saved.excluded_subjects?.length) {
    const courses = await AcademicCourse.findAll({ where: { batch_id: session.batch_id, status: 'active' }, raw: true, transaction });
    const inSemester = course => Number(course.semester) === Number(session.semester);
    const sameCode = (course, code) => String(course.subject_code).trim().toUpperCase() === String(code).trim().toUpperCase();
    mixedVerified = saved.excluded_subjects.every(row => courses.some(course => !inSemester(course) && sameCode(course, row.subject_code)))
      && payload.subjects.every(row => courses.some(course => inSemester(course) && String(course.course_id) === String(row.course_id))
        && !courses.some(course => !inSemester(course) && sameCode(course, row.subject_code)));
  }
  return integrity.originalDocumentErrors(saved, session, payload.student, attempt, verified, mixedVerified);
}

const resultController = {

  // ============================================================
  // PAGE 1 — Upload Results (session select + marks card upload)
  // GET /results/upload
  // ============================================================
  showUploadPage: async (req, res) => {
    try {
      const batches = sortBatches(await Batch.findAll({ attributes: ['batch_id', 'batch_name', 'start_year', 'end_year'], raw: true }));
      const sessions = await ResultSession.findAll({
        include: [{ model: Batch, attributes: ['batch_name'] }],
        order: [['exam_start_year', 'DESC'], ['exam_start_month', 'DESC'], ['semester', 'ASC']]
      });

      res.render('results/upload', {
        title: 'Upload Results - SRAAS',
        pageStyles: ['/css/result-upload.css'],
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Upload Results', active: true }
        ],
        sessions: sessions.map(s => ({
          session_id: s.session_id,
          batch_id: s.batch_id,
          display_name: `${s.Batch.batch_name} | Sem ${s.semester} | ${academicPolicy.formatExamPeriod(s)}`,
          semester: s.semester,
          exam_session: s.exam_session,
          exam_year: s.exam_year,
          exam_start_month: s.exam_start_month,
          exam_start_year: s.exam_start_year,
          exam_end_month: s.exam_end_month,
          exam_end_year: s.exam_end_year,
          batch_name: s.Batch.batch_name
        })),
        batches,
        selectedBatchId: batches[0]?.batch_id || '',
        error: req.query.error || null,
        importId: req.query.importId || null
      });
    } catch (err) {
      console.error('showUploadPage error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ============================================================
  // API — Session details + expected subjects (for dropdown)
  // GET /results/session-details/:sessionId
  // ============================================================
  getSessionDetails: async (req, res) => {
    try {
      const session = await ResultSession.findByPk(req.params.sessionId, {
        include: [
          { model: Batch, attributes: ['batch_name', 'start_year', 'end_year'] },
          { model: Subject, attributes: ['subject_id', 'subject_code', 'subject_name', 'credits'], order: [['subject_code', 'ASC']] }
        ]
      });

      if (!session) {
        return res.status(404).json({ success: false, message: 'Result Session not found' });
      }

      res.json({
        success: true,
        session: {
          session_id: session.session_id,
          semester: session.semester,
          exam_session: session.exam_session,
          exam_year: session.exam_year,
          exam_start_month: session.exam_start_month,
          exam_start_year: session.exam_start_year,
          exam_end_month: session.exam_end_month,
          exam_end_year: session.exam_end_year,
          batch_name: session.Batch.batch_name,
          academic_year: `${session.Batch.start_year}-${session.Batch.end_year}`,
          subjects_count: session.Subjects.length,
          subjects: session.Subjects.map(sub => ({
            subject_id: sub.subject_id,
            subject_code: sub.subject_code,
            subject_name: sub.subject_name,
            credits: sub.credits
          }))
        }
      });
    } catch (err) {
      console.error('getSessionDetails error:', err);
      res.status(500).json({ success: false, message: 'Unable to load the examination subjects. Reload and try again.' });
    }
  },

  // ============================================================
  // PAGE 1 -> PAGE 2 action — OCR extract then redirect to review
  // POST /results/upload   (multipart field: resultDocument)
  // ============================================================
  processUpload: async (req, res) => {
    let log = null;
    try {
      const sessionId = req.body.sessionId;
      const resultType = req.body.resultType || 'original';

      // Attempt authority for this import (validated server-side, never
      // trusted blindly at import time; persisted into the OCR payload).
      const attempt = req.body.exam_type === undefined
        ? { ok: false, errors: ['Exam Type is required.'] }
        : sanitizeAttempt(req.body.attempt_no, req.body.exam_type);
      if (!attempt.ok) {
        return res.redirect('/results/upload?error=' + encodeURIComponent(attempt.errors.join(' ')));
      }

      if (!req.file) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Please choose a marks card file.'));
      }
      if (!sessionId) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Please select a result session.'));
      }
      if (req.body.batch_id !== undefined) {
        const selectedSession = await ResultSession.findByPk(sessionId, { attributes: ['session_id', 'batch_id'] });
        if (!selectedSession || String(selectedSession.batch_id) !== String(req.body.batch_id)) {
          fs.unlinkSync(req.file.path);
          return res.redirect('/results/upload?error=' + encodeURIComponent('Select a result session belonging to the selected batch.'));
        }
      }

      // Move multer temp file into permanent results folder
      const uploadDir = ensureUploadDirectory();
      const secureFilename = generateSecureFilename(req.file.originalname);
      const storedFilePath = path.join(uploadDir, secureFilename);
      fs.renameSync(req.file.path, storedFilePath);

      const ext = path.extname(secureFilename).replace('.', '').toLowerCase();
      log = await ImportLog.create({
        session_id: sessionId,
        uploaded_by: req.session.adminId || 1,
        file_name: secureFilename,
        file_path: storedFilePath,
        file_type: ext,
        status: 'pending',
        total_records: 0,
        imported_records: 0,
        skipped_records: 0
      });

      const sessionSubjects = await Subject.findAll({
        where: { session_id: sessionId },
        order: [['subject_code', 'ASC']],
        raw: true
      });

      // A regular card must cover the configured subjects before native text can bypass OCR.
      const expectedSubjectCodes = academicPolicy.isRetakeAttempt(attempt.exam_type)
        ? [] : sessionSubjects.map(subject => subject.subject_code);
      const extraction = await documentExtractor.extract(storedFilePath, resultType, {
        expectedSubjectCodes, candidateSubjectCodes: sessionSubjects.map(subject => subject.subject_code)
      });
      const ex = extraction.extraction;
      const conflicts = [...integrity.duplicateRows(ex.subjects), ...(ex.integrity_conflicts || [])];
      const excludedSubjects = (ex.subjects || []).filter(row => row.subjectCode &&
        !sessionSubjects.some(subject => subject.subject_code.toUpperCase() === String(row.subjectCode).trim().toUpperCase()))
        .map(row => ({ subject_code: String(row.subjectCode).trim().toUpperCase(), subject_name: row.subjectName || '' }));

      // Subject identities always come from the database; extraction only proposes marks.
      const mappedSubjects = sessionSubjects.map(dbSub => {
        const matches = (ex.subjects || []).filter(o =>
          o.subjectCode && String(o.subjectCode).trim().toUpperCase() === dbSub.subject_code.toUpperCase()
        );
        const ocrSub = matches.length === 1 ? matches[0] : null;
        const hasMarks = ocrSub &&
          ocrSub.internalMarks !== null && ocrSub.internalMarks !== undefined &&
          ocrSub.externalMarks !== null && ocrSub.externalMarks !== undefined;

        return {
          subject_id: dbSub.subject_id,
          subject_code: dbSub.subject_code,
          subject_name: dbSub.subject_name,
          credits: dbSub.credits,
          max_internal: dbSub.max_internal,
          max_external: dbSub.max_external,
          max_marks: dbSub.max_marks,
          internalMarks: hasMarks ? ocrSub.internalMarks : '',
          externalMarks: hasMarks ? ocrSub.externalMarks : '',
          found_on_card: !!ocrSub,
          confidence: ocrSub ? ocrSub.marksConfidence : 'none'
        };
      });

      await OcrExtraction.create({
        import_id: log.import_id,
        raw_text: String(ex.rawText || '').substring(0, 60000),
        extracted_json: {
          document_evidence: { ...integrity.claims(ex), raw_text: ex.rawText || '', semester: ex.semester },
          integrity_conflicts: conflicts,
          student: {
            usn: (ex.student && ex.student.usn) || '',
            name: (ex.student && ex.student.name) || ''
          },
          attempt: {
            attempt_no: attempt.attempt_no,
            exam_type: attempt.exam_type
          },
          subjects: mappedSubjects,
          excluded_subjects: excludedSubjects,
          warnings: [...(ex.warnings || []), ...conflicts]
        },
        validation_status: 'pending'
      });

      await log.update({ status: 'extracted' });

      return res.redirect(`/results/upload/${log.import_id}/review`);
    } catch (err) {
      console.error('processUpload error:', err);
      if (log) {
        try { await log.update({ status: 'failed' }); } catch (e) { /* ignore */ }
      }
      return res.redirect('/results/upload?error=' + encodeURIComponent('The document could not be extracted. Upload a clear supported marks card and try again.'));
    }
  },

  // ============================================================
  // PAGE 2 — Review & Edit extracted data (two-column layout)
  // GET /results/upload/:importId/review
  // ============================================================
  showReviewPage: async (req, res) => {
    try {
      const ctx = await loadImportContext(req.params.importId);
      if (!ctx || !ctx.ocr) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Import record not found. Please upload the marks card again.'));
      }

      // Merge fresh DB subjects with saved OCR marks so codes/names always come from DB
      const dbSubjects = await Subject.findAll({
        where: { session_id: ctx.session.session_id },
        order: [['subject_code', 'ASC']],
        raw: true
      });

      const savedMap = new Map(ctx.saved.subjects.map(s => [String(s.subject_id), s]));
      const subjects = dbSubjects.map(dbSub => {
        const savedSub = savedMap.get(String(dbSub.subject_id));
        return {
          subject_id: dbSub.subject_id,
          subject_code: dbSub.subject_code,
          subject_name: dbSub.subject_name,
          credits: dbSub.credits,
          max_internal: dbSub.max_internal,
          max_external: dbSub.max_external,
          max_marks: dbSub.max_marks,
          internalMarks: savedSub ? savedSub.internalMarks : '',
          externalMarks: savedSub ? savedSub.externalMarks : ''
        };
      });

      let warnings = [];
      if (Array.isArray(ctx.saved.warnings)) {
        warnings = ctx.saved.warnings;
      }

      if (academicPolicy.isRetakeAttempt(ctx.saved.attempt?.exam_type) && ctx.saved.student?.usn) {
        const attempted = dbSubjects.filter(s => {
          const value = ctx.saved.subjects?.find(row => String(row.subject_id) === String(s.subject_id));
          return value && [value.internalMarks, value.externalMarks].some(mark => mark !== '' && mark !== null && mark !== undefined);
        });
        warnings = [...new Set(warnings.concat(await academicOutcomes.retakeWarnings(ctx.session, ctx.saved.student.usn.trim().toUpperCase(), attempted, undefined, ctx.saved.attempt?.attempt_no)))];
      }

      // ---- Compute extraction warning for the frontend ----
      // Shown when OCR left required fields empty so the admin knows
      // to manually fill them before submitting.
      const extractionWarningParts = [];
      if (!ctx.saved.student || !ctx.saved.student.usn) {
        extractionWarningParts.push('Student USN is missing from the extracted data.');
      }
      if (!ctx.saved.student || !ctx.saved.student.name) {
        extractionWarningParts.push('Student name is missing from the extracted data.');
      }
      const missingSubjectCount = subjects.filter(s =>
        (s.internalMarks === '' || s.externalMarks === '') &&
        (!academicPolicy.isRetakeAttempt(ctx.saved.attempt?.exam_type) || s.internalMarks !== '' || s.externalMarks !== '' || savedMap.get(String(s.subject_id))?.found_on_card)
      ).length;
      if (missingSubjectCount > 0) {
        const noun = missingSubjectCount === 1 ? 'subject has' : 'subjects have';
        extractionWarningParts.push(
          `${missingSubjectCount} ${noun} one or more missing marks values.`
        );
      }
      const extractionWarning = extractionWarningParts.length > 0
        ? extractionWarningParts.join(' ')
        : null;

      // Initial extraction remains editable; duplicate checks run on Validate.
      const usn = (ctx.saved.student && ctx.saved.student.usn) || '';
      const savedAttempt = sanitizeAttempt(
        (ctx.saved.attempt && ctx.saved.attempt.attempt_no),
        (ctx.saved.attempt && ctx.saved.attempt.exam_type)
      );
      const attemptInfo = savedAttempt.ok
        ? { attempt_no: savedAttempt.attempt_no, exam_type: savedAttempt.exam_type }
        : { attempt_no: ctx.saved.attempt?.attempt_no || 1, exam_type: ctx.saved.attempt?.exam_type || 'REGULAR' };
      let duplicateStudent = false;
      let registrationError = null;
      let nameError = null;
      const reviewError = typeof req.query?.error === 'string' ? req.query.error : null;
      if (usn) {
        const existingStudent = await Student.findOne({ where: { usn: usn.trim().toUpperCase() } });
        // Initial extraction remains editable; only failed workflow redirects block Review.
        if (reviewError) {
          registrationError = studentRegistrationError(existingStudent, ctx.session, usn.trim().toUpperCase());
          if (!registrationError) nameError = studentNameError(existingStudent, ctx.saved.student?.name, usn.trim().toUpperCase());
        }
      }

      res.render('results/review', {
        title: 'Review & Edit - SRAAS',
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Upload Results', route: '/results/upload' },
          { label: 'Review & Edit', active: true }
        ],
        importId: ctx.log.import_id,
        sessionDisplay: ctx.sessionDisplay,
        student: ctx.saved.student || { usn: '', name: '' },
        attempt: attemptInfo,
        excludedSubjects: ctx.saved.excluded_subjects || [],
        subjects,
        warnings,
        extractionWarning,
        formError: nameError || reviewError || (!savedAttempt.ok ? savedAttempt.errors.join(' ') : null),
        registrationBlocked: !!registrationError,
        errors: nameError ? { 'student.name': nameError } : {},
        duplicateStudent,
        fileUrl: ctx.fileUrl,
        fileType: (ctx.log.file_type || '').toLowerCase(),
        maxInternal: MAX_INTERNAL,
        maxExternal: MAX_EXTERNAL
      });
    } catch (err) {
      console.error('showReviewPage error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ============================================================
  // PAGE 2 action — validate edited marks; stay or go to preview
  // POST /results/upload/:importId/validate
  // ============================================================
  validateReview: async (req, res) => {
    try {
      const ctx = await loadImportContext(req.params.importId);
      if (!ctx || !ctx.ocr) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Import record not found.'));
      }
      if (ctx.log.status === 'success') return res.redirect('/results/upload/' + ctx.log.import_id + '/success');

      const markInputs = extractMarkInputs(req.body);
      const { errors, payload } = await buildValidatedPayload(
        ctx.session.session_id,
        { usn: req.body.usn, name: req.body.name },
        markInputs,
        { session: ctx.session, exam_type: sanitizeAttempt(req.body.attempt_no ?? ctx.saved.attempt?.attempt_no, req.body.exam_type ?? ctx.saved.attempt?.exam_type).exam_type }
      );
      if (ctx.saved.integrity_conflicts?.length) errors.form = ctx.saved.integrity_conflicts.join(' ');
      let registrationError = null;
      let nameError = null;
      let registeredStudent = null;
      if (payload.student.usn) {
        const student = await Student.findOne({ where: { usn: payload.student.usn } });
        registeredStudent = student;
        registrationError = studentRegistrationError(student, ctx.session, payload.student.usn);
        if (registrationError) errors.form = [errors.form, registrationError].filter(Boolean).join(' ');
        else {
          nameError = studentNameError(student, payload.student.name, payload.student.usn);
          if (nameError) {
            errors['student.name'] = nameError;
            errors.form = [errors.form, nameError].filter(Boolean).join(' ');
          }
        }
      }

      // Persist the admin's edited values into the stored extraction payload
      const mergedSubjects = payload.subjects.map(s => ({
        subject_id: s.subject_id,
        subject_code: s.subject_code,
        subject_name: s.subject_name,
        credits: s.credits,
        max_internal: s.max_internal,
        max_external: s.max_external,
        max_marks: s.max_marks,
        internalMarks: s.internalMarks === null ? '' : s.internalMarks,
        externalMarks: s.externalMarks === null ? '' : s.externalMarks,
        found_on_card: true,
        confidence: 'edited'
      }));

      // Review can correct the semester attempt number. Validate all submitted
      // attempt fields; otherwise preserve the attempt recorded at upload time.
      // Legacy OCR payloads with no attempt info at all still fall back to
      // 1 / REGULAR (sanitizeAttempt's historical defaults) for compatibility.
      let attemptNo, examType;

      const attemptSubmitted =
        req.body.attempt_no !== undefined || req.body.exam_type !== undefined;

      if (attemptSubmitted) {
        // Explicit submission — validated with the existing sanitizeAttempt
        // (arbitrary client values are never trusted blindly). On failure,
        // fall back to the persisted values exactly as before.
        const attempt = sanitizeAttempt(req.body.attempt_no, req.body.exam_type ?? '');
        if (!attempt.ok) {
          if (!errors.form) errors.form = [];
          errors.form = errors.form.concat(attempt.errors);
          attemptNo = (ctx.saved.attempt && ctx.saved.attempt.attempt_no) || 1;
          examType = (ctx.saved.attempt && ctx.saved.attempt.exam_type) || 'REGULAR';
        } else {
          attemptNo = attempt.attempt_no;
          examType = attempt.exam_type;
        }
      } else {
        // Fields absent from the review form: preserve the persisted attempt.
        // Re-sanitized purely as an integrity check on the stored payload.
        const persisted = sanitizeAttempt(
          ctx.saved.attempt && ctx.saved.attempt.attempt_no,
          ctx.saved.attempt && ctx.saved.attempt.exam_type
        );
        if (persisted.ok) {
          attemptNo = persisted.attempt_no;
          examType = persisted.exam_type;
        } else {
          if (!errors.form) errors.form = [];
          errors.form = [].concat(errors.form, persisted.errors);
          attemptNo = ctx.saved.attempt?.attempt_no || 1;
          examType = ctx.saved.attempt?.exam_type || 'REGULAR';
        }
      }

      if (!registrationError && !nameError && registeredStudent) {
        const duplicateError = await duplicateResultError(registeredStudent, ctx.session, { attempt_no: attemptNo, exam_type: examType });
        if (duplicateError) errors.form = [errors.form, duplicateError].filter(Boolean).join(' ');
        const historyError = await resultHistory.validationError(ctx.session, registeredStudent, { attempt_no: attemptNo, exam_type: examType }, undefined, payload.subjects);
        if (historyError) errors.form = [errors.form, historyError].filter(Boolean).join(' ');
      }
      const historyWarnings = academicPolicy.isRetakeAttempt(examType)
        ? await academicOutcomes.retakeWarnings(ctx.session, payload.student.usn, payload.subjects, undefined, attemptNo) : [];
      const documentErrors = await documentContextErrors(ctx.saved, ctx.session, payload, { exam_type: examType, attempt_no: attemptNo }, req.body.verify_document_context === '1', req.body.verify_mixed_context === '1');
      if (documentErrors.length) errors.form = [errors.form, ...documentErrors].filter(Boolean).join(' ');
      await ctx.ocr.update({
        extracted_json: {
          configuration_snapshot: payload.configuration_snapshot,
          review_token: Object.keys(errors).length ? null : crypto.randomUUID(),
          document_context_verified: req.body.verify_document_context === '1',
          mixed_context_verified: req.body.verify_mixed_context === '1',
          document_evidence: ctx.saved.document_evidence,
          integrity_conflicts: ctx.saved.integrity_conflicts || [],
          student: payload.student,
          attempt: { attempt_no: attemptNo, exam_type: examType },
          subjects: mergedSubjects,
          excluded_subjects: ctx.saved.excluded_subjects || [],
          warnings: [...historyWarnings, ...(ctx.saved.integrity_conflicts || [])]
        },
        validation_status: Object.keys(errors).length > 0 ? 'pending' : 'validated'
      });

      if (Object.keys(errors).length > 0) {
        // Re-render review with inline field errors
        const dbSubjects = await Subject.findAll({
          where: { session_id: ctx.session.session_id },
          order: [['subject_code', 'ASC']],
          raw: true
        });
        const savedMap = new Map(payload.subjects.map(s => [String(s.subject_id), s]));
        const subjects = dbSubjects.map(dbSub => {
          const p = savedMap.get(String(dbSub.subject_id));
          return {
            subject_id: dbSub.subject_id,
            subject_code: dbSub.subject_code,
            subject_name: dbSub.subject_name,
            credits: dbSub.credits,
            max_internal: dbSub.max_internal,
            max_external: dbSub.max_external,
            max_marks: dbSub.max_marks,
            internalMarks: p && p.internalMarks !== null ? p.internalMarks : '',
            externalMarks: p && p.externalMarks !== null ? p.externalMarks : ''
          };
        });

        return res.status(422).render('results/review', {
          title: 'Review & Edit - SRAAS',
          breadcrumbItems: [
            { label: 'Result Management' },
            { label: 'Upload Results', route: '/results/upload' },
            { label: 'Review & Edit', active: true }
          ],
          importId: ctx.log.import_id,
          sessionDisplay: ctx.sessionDisplay,
          student: payload.student,
          attempt: { attempt_no: attemptNo, exam_type: examType },
          excludedSubjects: ctx.saved.excluded_subjects || [],
          subjects,
          warnings: historyWarnings,
          extractionWarning: Object.keys(errors).some(key => key !== 'form' && !(nameError && key === 'student.name'))
            ? 'Some required fields are missing or invalid. Please correct the highlighted fields below.' : null,
          errors,
          formError: errors.form || null,
          registrationBlocked: !!registrationError,
          duplicateStudent: false,
          fileUrl: ctx.fileUrl,
          fileType: (ctx.log.file_type || '').toLowerCase(),
          maxInternal: MAX_INTERNAL,
          maxExternal: MAX_EXTERNAL
        });
      }

      return res.redirect(`/results/upload/${ctx.log.import_id}/preview`);
    } catch (err) {
      console.error('validateReview error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ============================================================
  // PAGE 3 — Validated preview (read-only summary)
  // GET /results/upload/:importId/preview
  // ============================================================
  showPreviewPage: async (req, res) => {
    try {
      const ctx = await loadImportContext(req.params.importId);
      if (!ctx || !ctx.ocr) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Import record not found.'));
      }

      const markInputs = {};
      ctx.saved.subjects.forEach(s => {
        if (s.internalMarks !== '' && s.internalMarks !== null && s.internalMarks !== undefined) {
          markInputs[`internal_${s.subject_id}`] = s.internalMarks;
        }
        if (s.externalMarks !== '' && s.externalMarks !== null && s.externalMarks !== undefined) {
          markInputs[`external_${s.subject_id}`] = s.externalMarks;
        }
      });

      const { errors, payload } = await buildValidatedPayload(ctx.session.session_id, ctx.saved.student, markInputs, { session: ctx.session, exam_type: ctx.saved.attempt?.exam_type || 'REGULAR' });

      if (Object.keys(errors).length > 0) {
        return res.redirect(`/results/upload/${ctx.log.import_id}/review`);
      }

      const student = await Student.findOne({ where: { usn: payload.student.usn } });
      const registrationError = studentRegistrationError(student, ctx.session, payload.student.usn);
      if (registrationError) return res.redirect(`/results/upload/${ctx.log.import_id}/review?error=` + encodeURIComponent(registrationError));
      const nameError = studentNameError(student, payload.student.name, payload.student.usn);
      if (nameError) return res.redirect(`/results/upload/${ctx.log.import_id}/review?error=` + encodeURIComponent(nameError));
      const previewAttempt = sanitizeAttempt(ctx.saved.attempt?.attempt_no, ctx.saved.attempt?.exam_type);
      if (previewAttempt.ok) {
        const duplicateError = await duplicateResultError(student, ctx.session, previewAttempt);
        if (duplicateError) return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent(duplicateError));
      }
      const historyError = previewAttempt.ok
        ? await resultHistory.validationError(ctx.session, student, previewAttempt, undefined, payload.subjects) : previewAttempt.errors.join(' ');
      if (historyError) return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent(historyError));
      if (previewAttempt.ok) {
        const history = await academicOutcomes.load(ctx.session.batch_id, [student.student_id], 'original');
        payload.cgpa = academicOutcomes.previewCumulative(history, student.student_id, ctx.session,
          previewAttempt, payload.subjects);
      }

      res.render('results/preview', {
        reviewToken: ctx.saved.review_token,
        title: 'Validated Preview - SRAAS',
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Upload Results', route: '/results/upload' },
          { label: 'Validated Preview', active: true }
        ],
        importId: ctx.log.import_id,
        sessionDisplay: ctx.sessionDisplay,
        attempt: {
          attempt_no: (ctx.saved.attempt && ctx.saved.attempt.attempt_no) || 1,
          exam_type: (ctx.saved.attempt && ctx.saved.attempt.exam_type) || 'REGULAR'
        },
        data: payload,
        excludedSubjects: ctx.saved.excluded_subjects || [],
        warnings: academicPolicy.isRetakeAttempt(ctx.saved.attempt?.exam_type)
          ? await academicOutcomes.retakeWarnings(ctx.session, payload.student.usn, payload.subjects, undefined, ctx.saved.attempt?.attempt_no) : [],
        fileUrl: ctx.fileUrl,
        fileType: (ctx.log.file_type || '').toLowerCase()
      });
    } catch (err) {
      console.error('showPreviewPage error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ============================================================
  // PAGE 3 action — Confirm & Save (transactional import)
  // POST /results/upload/:importId/import
  // Recomputes everything server-side; never trusts client data.
  // ============================================================
  confirmImport: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const ctx = await loadImportContext(req.params.importId);
      if (!ctx || !ctx.ocr) {
        await t.rollback();
        return res.redirect('/results/upload?error=' + encodeURIComponent('Import record not found.'));
      }

      // Coordinate with Session Management so its identity cannot change during import.
      const lockedSession = await ResultSession.findByPk(ctx.session.session_id, { transaction: t, lock: true });
      if (!lockedSession || ['batch_id', 'semester'].some(field => String(lockedSession[field]) !== String(ctx.session[field]))
        || academicPolicy.periodKey(lockedSession) !== academicPolicy.periodKey(ctx.session)) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent('The examination session changed. Review its semester and examination period before importing.'));
      }
      // All curriculum writers take this batch lock before changing definitions.
      const lockedBatch = await Batch.findByPk(lockedSession.batch_id, { transaction: t, lock: true });
      if (!lockedBatch) throw new Error('Academic batch is unavailable.');
      const currentLog = await ImportLog.findByPk(ctx.log.import_id, { transaction: t, lock: true });
      if (!currentLog || currentLog.import_type && currentLog.import_type !== 'ORIGINAL') throw new Error('Invalid import type.');
      if (currentLog.status === 'success') {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/success');
      }
      const currentOcr = await OcrExtraction.findOne({ where: { import_id: ctx.log.import_id }, order: [['extraction_id','DESC']], transaction: t, lock: true });
      const currentSaved = typeof currentOcr?.extracted_json === 'string' ? safeParseJson(currentOcr.extracted_json) : currentOcr?.extracted_json;
      if (!currentOcr || integrity.digest(currentSaved) !== integrity.digest(ctx.saved)) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent('The reviewed document or decisions changed. Reload and Validate the current review before confirming.'));
      }

      const markInputs = {};
      ctx.saved.subjects.forEach(s => {
        if (s.internalMarks !== '' && s.internalMarks !== null && s.internalMarks !== undefined) {
          markInputs[`internal_${s.subject_id}`] = s.internalMarks;
        }
        if (s.externalMarks !== '' && s.externalMarks !== null && s.externalMarks !== undefined) {
          markInputs[`external_${s.subject_id}`] = s.externalMarks;
        }
      });

      const { errors, payload } = await buildValidatedPayload(ctx.session.session_id, ctx.saved.student, markInputs, { session: ctx.session, exam_type: ctx.saved.attempt?.exam_type || 'REGULAR', transaction: t });
      if (Object.keys(errors).length > 0) {
        await t.rollback();
        return res.redirect(`/results/upload/${ctx.log.import_id}/review?error=` + encodeURIComponent('Marks or the subject roster are no longer valid. Review the current marking limits and required courses, then Validate again.'));
      }

      // Student registration is required; result imports never provision students.
      const student = await Student.findOne({
        where: { usn: payload.student.usn },
        transaction: t,
        lock: true // Serialize semester attempt numbering for this student.
      });

      const registrationError = studentRegistrationError(student, ctx.session, payload.student.usn);
      if (registrationError) {
        await t.rollback();
        return res.redirect(`/results/upload/${ctx.log.import_id}/review?error=` + encodeURIComponent(registrationError));
      }

      const nameError = studentNameError(student, payload.student.name, payload.student.usn);
      if (nameError) {
        await t.rollback();
        return res.redirect(`/results/upload/${ctx.log.import_id}/review?error=` + encodeURIComponent(nameError));
      }

      // Attempt authority comes ONLY from the persisted OCR payload, which was
      // validated at upload/validate time (the browser never reaches here).
      const attempt = sanitizeAttempt(
        (ctx.saved.attempt && ctx.saved.attempt.attempt_no),
        (ctx.saved.attempt && ctx.saved.attempt.exam_type)
      );
      if (!attempt.ok) {
        await t.rollback();
        return res.redirect(`/results/upload/${ctx.log.import_id}/review`);
      }

      if (ctx.saved.integrity_conflicts?.length) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent(ctx.saved.integrity_conflicts.join(' ')));
      }
      const historyError = await resultHistory.validationError(ctx.session, student, attempt, t, payload.subjects);
      if (historyError) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent(historyError));
      }
      const documentErrors = await documentContextErrors(ctx.saved, ctx.session, payload, attempt, ctx.saved.document_context_verified === true, ctx.saved.mixed_context_verified === true, t);
      if (documentErrors.length) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent(documentErrors.join(' ')));
      }
      if (ctx.ocr.validation_status !== 'validated' || !ctx.saved.configuration_snapshot
        || ctx.saved.configuration_snapshot !== payload.configuration_snapshot || !ctx.saved.review_token
        || req.body?.review_token !== ctx.saved.review_token) {
        await t.rollback();
        return res.redirect('/results/upload/' + ctx.log.import_id + '/review?error=' + encodeURIComponent('This result was reviewed against older or unvalidated academic data. Review and Validate the current student, session, roster and marks again before confirmation.'));
      }

      // 2) Duplicate guard: block if this exact attempt already exists for
      //    this student + session. Attempt 2+ for the same student+session is
      //    allowed (creates brand-new Result + SubjectResult records).
      const existingResult = await Result.findOne({
        where: {
          student_id: student.student_id,
          session_id: ctx.session.session_id,
          attempt_no: attempt.attempt_no
        },
        transaction: t
      });
      if (existingResult) {
        await t.rollback();
        return res.redirect('/results/logs?error=' + encodeURIComponent(
          'Duplicate blocked: ' + payload.student.usn + ' already has attempt ' +
          attempt.attempt_no + ' (' + attempt.exam_type + ') in this session. ' +
          'Use the next semester attempt number for a new BACKLOG sitting.'
        ));
      }

      // 3) Insert master result (with attempt identity)
      const result = await Result.create({
        result_uuid: crypto.randomUUID(),
        student_id: student.student_id,
        session_id: ctx.session.session_id,
        attempt_no: attempt.attempt_no,
        exam_type: attempt.exam_type,
        sgpa: payload.sgpa,
        cgpa: null,
        sgpa_source: payload.sgpa === null ? 'UNKNOWN' : 'CALCULATED',
        cgpa_source: 'UNKNOWN', cgpa_is_cumulative: false,
        grading_scheme_version: academicPolicy.SCHEME,
        result_status: payload.overallResult,
        failed_subject_count: payload.failedSubjectCount
      }, { transaction: t });

      // 4) Insert subject results
      await SubjectResult.bulkCreate(payload.subjects.map(s => ({
        result_id: result.result_id,
        subject_id: s.subject_id,
        internal_marks: s.internalMarks,
        external_marks: s.externalMarks,
        marks: s.totalMarks,
        grade: s.grade,
        result_status: s.result_status,
        grading_scheme_version: s.grading_scheme_version, grade_point: s.grade_point,
        credits_snapshot: s.credits, course_id_snapshot: s.course_id
      })), { transaction: t });
      const cumulative = await academicOutcomes.calculateCumulative(ctx.session.batch_id, student.student_id, ctx.session.semester, academicPolicy.period(ctx.session), t);
      if (cumulative !== null) await result.update({ cgpa: cumulative, cgpa_source: 'CALCULATED', cgpa_is_cumulative: true }, { transaction: t });

      // 5) Close out the import log
      await ctx.log.update({
        status: 'success',
        total_records: payload.subjects.length,
        imported_records: payload.subjects.length,
        skipped_records: 0
      }, { transaction: t });

      await t.commit();
      return res.redirect(`/results/upload/${ctx.log.import_id}/success`);
    } catch (err) {
      await t.rollback();
      console.error('confirmImport error:', err);
      try {
        const failedLog = await ImportLog.findByPk(req.params.importId);
        if (failedLog) await failedLog.update({ status: 'failed' });
      } catch (e) { /* ignore */ }
      return res.redirect('/results/logs?error=' + encodeURIComponent('Import could not be completed. Review the current academic data and try again.'));
    }
  },

  // ============================================================
  // PAGE 4 — Import successful
  // GET /results/upload/:importId/success
  // ============================================================
  showSuccessPage: async (req, res) => {
    try {
      const ctx = await loadImportContext(req.params.importId);
      if (!ctx) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Import record not found.'));
      }

      const usn = (ctx.saved.student && ctx.saved.student.usn) || '';
      const importedAttemptNo = (ctx.saved.attempt && ctx.saved.attempt.attempt_no) || 1;
      const student = await Student.findOne({ where: { usn } });
      const result = student ? await Result.findOne({
        where: {
          student_id: student.student_id,
          session_id: ctx.session.session_id,
          attempt_no: importedAttemptNo
        },
        include: [{
          model: SubjectResult,
          include: [{ model: Subject, attributes: ['subject_code', 'subject_name'] }]
        }]
      }) : null;

      res.render('results/success', {
        title: 'Import Successful - SRAAS',
        pageStyles: ['/css/result-success.css'],
        savedConfirmed: !!result,
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Upload Results', route: '/results/upload' },
          { label: 'Import Successful', active: true }
        ],
        sessionDisplay: ctx.sessionDisplay,
        attemptNo: importedAttemptNo,
        examType: (ctx.saved.attempt && ctx.saved.attempt.exam_type) || 'REGULAR',
        studentName: result && student ? student.student_name : (ctx.saved.student.name || ''),
        usn,
        subjectsCount: result ? result.SubjectResults.length : 0,
        overallResult: result ? result.result_status : null,
        sgpa: result ? result.sgpa : null,
        cgpa: result ? result.cgpa : null
      });
    } catch (err) {
      console.error('showSuccessPage error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ============================================================
  // PAGE — Import Logs listing
  // GET /results/logs
  // ============================================================
  getImportLogs: async (req, res) => {
    try {
      const logs = await ImportLog.findAll({
        include: [{
          model: ResultSession,
          attributes: ['semester', 'exam_session', 'exam_year', 'exam_start_month', 'exam_start_year', 'exam_end_month', 'exam_end_year'],
          include: [{ model: Batch, attributes: ['batch_name'] }]
        }],
        order: [['created_at', 'DESC']],
        limit: 200
      });

      res.render('results/logs', {
        title: 'Import Logs - SRAAS',
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Import Logs', active: true }
        ],
        error: req.query.error || null,
        logs: logs.map(log => ({
          import_id: log.import_id,
          date: log.created_at ? new Date(log.created_at).toLocaleString() : '',
          file_name: log.file_name,
          session_display: log.ResultSession ?
            `${log.ResultSession.Batch.batch_name} | Sem ${log.ResultSession.semester} | ${academicPolicy.formatExamPeriod(log.ResultSession)}` : 'N/A',
          status: log.status,
          import_type: log.import_type,
          imported_records: log.imported_records,
          total_records: log.total_records
        }))
      });
    } catch (err) {
      console.error('getImportLogs error:', err);
      res.status(500).render('errors/500', { layout: 'layouts/main', title: 'Server Error' });
    }
  },

  // ========================
  // Legacy JSON API (kept)
  // ========================
  all: async (req, res) => {
    try { res.json(await Result.findAll()); }
    catch (err) { res.status(500).json({ error: 'Unable to load saved results. Please try again.' }); }
  },

  getById: async (req, res) => {
    try {
      const data = await Result.findByPk(req.params.id);
      if (!data) return res.status(404).json({ error: 'Result not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: 'Unable to load this result. Please try again.' }); }
  },

  getByStudent: async (req, res) => {
    try { res.json(await Result.findAll({ where: { student_id: req.params.student_id } })); }
    catch (err) { res.status(500).json({ error: 'Unable to load this student result history. Please try again.' }); }
  },

  create: async (req, res) => {
    return res.status(403).json({ error: 'Academic results must be created through Upload, Review, Validate and Confirm. Generic result creation is disabled to prevent incomplete academic history.' });
  },

  update: async (req, res) => {
    // Retired legacy mutation: original history is not a generic CRUD resource.
    return res.status(403).json({ error: 'Imported academic results cannot be directly edited. Use the appropriate controlled academic workflow.' });
  },

  delete: async (req, res) => {
    return res.status(403).json({ error: "Imported academic results cannot be deleted because they form part of the student's permanent academic history." });
  }
};

// Test-only hooks (not part of the public API)
resultController._test = {
  buildValidatedPayload,
  extractMarkInputs,
  gradeFromPercent,
  sanitizeAttempt,
  ALLOWED_EXAM_TYPES,
  PASS_PERCENT,
  MAX_INTERNAL,
  MAX_EXTERNAL
};

module.exports = resultController;
