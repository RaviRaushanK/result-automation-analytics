const crypto = require('crypto');
const { Result, SubjectResult, ImportLog, OcrExtraction, Student, Subject, Batch, ResultSession, sequelize } = require('../database/models');
const path = require('path');
const fs = require('fs');

// Document extraction service
const documentExtractor = require('../services/documentExtractor');

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
const gradeFromPercent = (pct) => {
  if (pct === null || pct === undefined || isNaN(pct)) return { grade: 'F', point: 0, status: 'fail' };
  if (pct >= 90) return { grade: 'O', point: 10, status: 'pass' };
  if (pct >= 80) return { grade: 'A+', point: 9, status: 'pass' };
  if (pct >= 70) return { grade: 'A', point: 8, status: 'pass' };
  if (pct >= 60) return { grade: 'B+', point: 7, status: 'pass' };
  if (pct >= 55) return { grade: 'B', point: 6, status: 'pass' };
  if (pct >= PASS_PERCENT) return { grade: 'C', point: 5, status: 'pass' };
  return { grade: 'F', point: 0, status: 'fail' };
}

// ============================================
// Attempt parsing & validation (foundation for multi-attempt results)
// ============================================
const ALLOWED_EXAM_TYPES = ['REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT'];

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
  if (rawType === undefined || rawType === null || String(rawType).trim() === '') {
    examType = defaults.exam_type;
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
    sessionDisplay: `${log.ResultSession.Batch.batch_name} | ${log.ResultSession.semester} | ${log.ResultSession.exam_session} ${log.ResultSession.exam_year}`
  };
}

function safeParseJson(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

// Core validation + computation used by review-validate, preview and import.
// markInputs: object keyed by `internal_<subject_id>` / `external_<subject_id>`
async function buildValidatedPayload(sessionId, studentInput, markInputs) {
  const errors = {};
  const usn = ((studentInput && studentInput.usn) || '').trim().toUpperCase();
  const name = ((studentInput && studentInput.name) || '').trim();

  if (!usn) errors['student.usn'] = 'USN is required.';
  if (!name) errors['student.name'] = 'Student name is required.';

  const subjects = await Subject.findAll({
    where: { session_id: sessionId },
    order: [['subject_code', 'ASC']],
    raw: true
  });
  if (subjects.length === 0) errors.form = 'This result session has no subjects configured.';

  const list = [];
  let allPoints = 0, allCredits = 0;      // SGPA: every registered course
  let passedPoints = 0, passedCredits = 0; // CGPA: excludes F-grade courses (P.G. 2022/24)
  let failedCount = 0;

  for (const s of subjects) {
    // Per-subject limits from the database (fallbacks only for legacy rows)
    const maxInt = (s.max_internal !== null && s.max_internal !== undefined) ? s.max_internal : MAX_INTERNAL;
    const maxExt = (s.max_external !== null && s.max_external !== undefined) ? s.max_external : MAX_EXTERNAL;
    const maxTotal = (s.max_marks !== null && s.max_marks !== undefined) ? s.max_marks : (maxInt + maxExt);
    const credits = (s.credits !== null && s.credits !== undefined) ? s.credits : 0;

    const iRaw = markInputs[`internal_${s.subject_id}`];
    const eRaw = markInputs[`external_${s.subject_id}`];
    // Explicitly check for null/undefined/empty-string BEFORE parseInt so that
    // "0" is NOT incorrectly treated as missing. parseInt returns NaN for empty
    // string; we treat that as a required-field error rather than a range error.
    const iMissing = (iRaw === null || iRaw === undefined || iRaw === '');
    const eMissing = (eRaw === null || eRaw === undefined || eRaw === '');
    const internal = iMissing ? NaN : parseInt(iRaw, 10);
    const external = eMissing ? NaN : parseInt(eRaw, 10);

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
    } else {
      passedPoints += gradeInfo.point * credits;
      passedCredits += credits;
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
      result_status: gradeInfo.status
    });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return {
    errors,
    hasErrors,
    payload: {
      student: { usn, name },
      subjects: list,
      overallResult: (!hasErrors && failedCount === 0) ? 'pass' : 'fail',
      // SGPA = Σ(credits × grade points) / Σ(credits) over ALL registered courses
      sgpa: allCredits > 0 ? Number((allPoints / allCredits).toFixed(2)) : 0,
      // CGPA = same, but excluding F-grade courses (P.G. 2022/2024 definition)
      cgpa: passedCredits > 0 ? Number((passedPoints / passedCredits).toFixed(2)) : null,
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

const resultController = {

  // ============================================================
  // PAGE 1 — Upload Results (session select + marks card upload)
  // GET /results/upload
  // ============================================================
  showUploadPage: async (req, res) => {
    try {
      const sessions = await ResultSession.findAll({
        include: [{ model: Batch, attributes: ['batch_name'] }],
        order: [['exam_year', 'DESC'], ['semester', 'ASC']]
      });

      res.render('results/upload', {
        title: 'Upload Results - SRAAS',
        breadcrumbItems: [
          { label: 'Result Management' },
          { label: 'Upload Results', active: true }
        ],
        sessions: sessions.map(s => ({
          session_id: s.session_id,
          display_name: `${s.Batch.batch_name} | ${s.semester} | ${s.exam_session} ${s.exam_year}`,
          semester: s.semester,
          exam_session: s.exam_session,
          exam_year: s.exam_year,
          batch_name: s.Batch.batch_name
        })),
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
      res.status(500).json({ success: false, message: err.message });
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
      const attempt = sanitizeAttempt(req.body.attempt_no, req.body.exam_type);
      if (!attempt.ok) {
        return res.redirect('/results/upload?error=' + encodeURIComponent(attempt.errors.join(' ')));
      }

      if (!req.file) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Please choose a marks card file.'));
      }
      if (!sessionId) {
        return res.redirect('/results/upload?error=' + encodeURIComponent('Please select a result session.'));
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

      // OCR / text extraction (the slow step)
      const extraction = await documentExtractor.extract(storedFilePath, resultType);
      const ex = extraction.extraction;

      // Map extracted marks onto DATABASE subjects of this session.
      // Subject code/name ALWAYS come from the database; OCR only fills marks.
      const sessionSubjects = await Subject.findAll({
        where: { session_id: sessionId },
        order: [['subject_code', 'ASC']],
        raw: true
      });

      const mappedSubjects = sessionSubjects.map(dbSub => {
        const ocrSub = (ex.subjects || []).find(o =>
          o.subjectCode && String(o.subjectCode).toUpperCase() === dbSub.subject_code.toUpperCase()
        );
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
          student: {
            usn: (ex.student && ex.student.usn) || '',
            name: (ex.student && ex.student.name) || ''
          },
          attempt: {
            attempt_no: attempt.attempt_no,
            exam_type: attempt.exam_type
          },
          subjects: mappedSubjects,
          warnings: ex.warnings || []
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
      return res.redirect('/results/upload?error=' + encodeURIComponent('Extraction failed: ' + err.message));
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
        s.internalMarks === '' || s.externalMarks === ''
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

      // ---- Duplicate student detection (per student + session + attempt) ----
      const usn = (ctx.saved.student && ctx.saved.student.usn) || '';
      const savedAttempt = sanitizeAttempt(
        (ctx.saved.attempt && ctx.saved.attempt.attempt_no),
        (ctx.saved.attempt && ctx.saved.attempt.exam_type)
      );
      const attemptInfo = savedAttempt.ok
        ? { attempt_no: savedAttempt.attempt_no, exam_type: savedAttempt.exam_type }
        : { attempt_no: 1, exam_type: 'REGULAR' };
      let duplicateStudent = false;
      if (usn) {
        const existingStudent = await Student.findOne({ where: { usn: usn.trim().toUpperCase() } });
        if (existingStudent) {
          const existingResult = await Result.findOne({
            where: {
              student_id: existingStudent.student_id,
              session_id: ctx.session.session_id,
              attempt_no: attemptInfo.attempt_no
            }
          });
          if (existingResult) duplicateStudent = true;
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
        subjects,
        warnings,
        extractionWarning,
        errors: {},
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

      const markInputs = extractMarkInputs(req.body);
      const { errors, payload } = await buildValidatedPayload(
        ctx.session.session_id,
        { usn: req.body.usn, name: req.body.name },
        markInputs
      );

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

      // Attempt preservation: the review UI does not submit attempt fields.
      // Only overwrite the persisted attempt when a trusted workflow explicitly
      // submits them; otherwise preserve the attempt recorded at upload time.
      // Legacy OCR payloads with no attempt info at all still fall back to
      // 1 / REGULAR (sanitizeAttempt's historical defaults) for compatibility.
      let attemptNo, examType;

      const attemptSubmitted =
        req.body.attempt_no !== undefined || req.body.exam_type !== undefined;

      if (attemptSubmitted) {
        // Explicit submission — validated with the existing sanitizeAttempt
        // (arbitrary client values are never trusted blindly). On failure,
        // fall back to the persisted values exactly as before.
        const attempt = sanitizeAttempt(req.body.attempt_no, req.body.exam_type);
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
          attemptNo = 1;
          examType = 'REGULAR';
        }
      }

      await ctx.ocr.update({
        extracted_json: {
          student: payload.student,
          attempt: { attempt_no: attemptNo, exam_type: examType },
          subjects: mergedSubjects,
          warnings: []
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
          subjects,
          warnings: [],
          extractionWarning: (errors.form ? errors.form + ' Please correct the highlighted fields below.' : 'Some required fields are missing. Please correct the highlighted fields below.'),
          errors,
          formError: errors.form || null,
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

      const { errors, payload } = await buildValidatedPayload(ctx.session.session_id, ctx.saved.student, markInputs);

      if (Object.keys(errors).length > 0) {
        return res.redirect(`/results/upload/${ctx.log.import_id}/review`);
      }

      res.render('results/preview', {
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

      const markInputs = {};
      ctx.saved.subjects.forEach(s => {
        if (s.internalMarks !== '' && s.internalMarks !== null && s.internalMarks !== undefined) {
          markInputs[`internal_${s.subject_id}`] = s.internalMarks;
        }
        if (s.externalMarks !== '' && s.externalMarks !== null && s.externalMarks !== undefined) {
          markInputs[`external_${s.subject_id}`] = s.externalMarks;
        }
      });

      const { errors, payload } = await buildValidatedPayload(ctx.session.session_id, ctx.saved.student, markInputs);
      if (Object.keys(errors).length > 0) {
        await t.rollback();
        return res.redirect(`/results/upload/${ctx.log.import_id}/review`);
      }

      // 1) Find or provision the student inside the session's batch
      let student = await Student.findOne({
        where: { usn: payload.student.usn },
        transaction: t
      });

      if (!student) {
        student = await Student.create({
          student_uuid: crypto.randomUUID(),
          batch_id: ctx.session.batch_id,
          usn: payload.student.usn,
          student_name: payload.student.name,
          status: 'active'
        }, { transaction: t });
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
          'Choose a different attempt number to create a new attempt.'
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
        cgpa: payload.cgpa, // P.G. 2022/2024: excludes F-grade courses; NULL if all failed
        result_status: payload.overallResult,
        failed_subject_count: payload.failedSubjectCount
      }, { transaction: t });

      // 4) Insert subject results
      await SubjectResult.bulkCreate(payload.subjects.map(s => ({
        result_id: result.result_id,
        subject_id: s.subject_id,
        marks: s.totalMarks,
        grade: s.grade,
        result_status: s.result_status
      })), { transaction: t });

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
      return res.redirect('/results/logs?error=' + encodeURIComponent('Import failed: ' + err.message));
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
          attributes: ['semester', 'exam_session', 'exam_year'],
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
            `${log.ResultSession.Batch.batch_name} | ${log.ResultSession.semester} | ${log.ResultSession.exam_session} ${log.ResultSession.exam_year}` : 'N/A',
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
    catch (err) { res.status(500).json({ error: err.message }); }
  },

  getById: async (req, res) => {
    try {
      const data = await Result.findByPk(req.params.id);
      if (!data) return res.status(404).json({ error: 'Result not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  getByStudent: async (req, res) => {
    try { res.json(await Result.findAll({ where: { student_id: req.params.student_id } })); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },

  create: async (req, res) => {
    try {
      // LEGACY JSON endpoint (intentionally NOT an attempt-authoring surface).
      // attempt_no / exam_type are always server-controlled: first sitting /
      // REGULAR. Any client-supplied attempt_no, exam_type or result_uuid in
      // req.body is silently ignored (explicit allowlist, no mass assignment).
      const {
        student_id,
        session_id,
        sgpa,
        cgpa,
        result_status,
        failed_subject_count
      } = req.body;

      const result = await Result.create({
        result_uuid: crypto.randomUUID(), // server-generated, never client-controlled
        student_id,
        session_id,
        attempt_no: 1,                    // forced — disallow client control
        exam_type: 'REGULAR',             // forced — disallow client control
        sgpa,
        cgpa,
        result_status,
        failed_subject_count
      });
      res.status(201).json(result);
    } catch (err) {
      // DB-level UNIQUE(student_id, session_id, attempt_no) remains the backstop.
      res.status(500).json({ error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      // LEGACY JSON endpoint — only the mutable academic snapshot fields can be
      // updated here. identity (result_id/student_id/session_id), attempt
      // (attempt_no/exam_type) and result_uuid are immutable via this route.
      const { sgpa, cgpa, result_status, failed_subject_count } = req.body;

      const [updated] = await Result.update(
        { sgpa, cgpa, result_status, failed_subject_count },
        { where: { result_id: req.params.id } }
      );
      if (!updated) return res.status(404).json({ error: 'Result not found' });
      res.json({ message: 'Updated successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  delete: async (req, res) => {
    try {
      const deleted = await Result.destroy({ where: { result_id: req.params.id } });
      if (!deleted) return res.status(404).json({ error: 'Result not found' });
      res.json({ message: 'Deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
