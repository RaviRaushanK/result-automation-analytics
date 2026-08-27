/**
 * Revaluation Upload Controller (PROMPT 3 — registration stage only).
 *
 * Authority: the browser never supplies authoritative identity (student /
 * session / attempt_no / exam_type / result_id / subject_result_id). The admin
 * picks a Result; every handler re-resolves it from the DB and re-verifies that
 * each selected subject_result_id belongs to THAT result. The selected list is
 * stashed in the server-side session and re-validated on submit.
 *
 * Creates processing state only: ImportLog(import_type='REVALUATION') +
 * OcrExtraction(validation_status='pending'). No Result/SubjectResult row is
 * created or modified here. RevaluationResult rows (NOT NULL revised_marks /
 * revised_status) are intentionally deferred to the post-OCR stage.
 */
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const {
  Result, Student, ResultSession, SubjectResult, Subject,
  ImportLog, OcrExtraction, sequelize
} = require('../database/models');
const {
  ensureRevalDir, generateSecureFilename, REVAL_DIR, REVAL_ALLOWED_EXT
} = require('../middlewares/upload');

const REVAL_PENDING_SECONDS = 15 * 60;

function resolveAdminId(req) {
  return (req.user && req.user.adminId) ||
         (req.session && req.session.adminId) || 1;
}

function safeJson(v) {
  try {
    return typeof v === 'object' && v !== null ? v : JSON.parse(v || '{}');
  } catch { return {}; }
}

function sessionDisplay(rs) {
  if (!rs) return '';
  return [rs.semester, rs.exam_session, rs.exam_year]
    .filter(Boolean).join(' | ');
}

// Eager-load a Result with everything needed for the revaluation flow.
function loadResultContext(resultId) {
  return Result.findByPk(resultId, {
    include: [
      { model: Student, attributes: ['student_name', 'usn'] },
      { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] },
      {
        model: SubjectResult,
        attributes: ['subject_result_id', 'result_id', 'subject_id', 'marks', 'grade', 'result_status', 'created_at'],
        include: [{ model: Subject, attributes: ['subject_code', 'subject_name', 'credits', 'max_marks'] }]
      }
    ]
  });
}
/**
 * GET /revaluation/upload — Result picker ("find an existing Result").
 */
exports.showResultPicker = async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    const studentWhere = q
      ? { [Op.or]: [
          { usn: { [Op.like]: `%${q}%` } },
          { student_name: { [Op.like]: `%${q}%` } }
        ] }
      : undefined;

    const results = await Result.findAll({
      include: [
        { model: Student, attributes: ['student_name', 'usn'], where: studentWhere },
        { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] }
      ],
      limit: 200,
      order: [['result_id', 'DESC']]
    });

    const list = results.map(r => ({
      result_id: r.result_id,
      student_name: r.Student ? r.Student.student_name : '',
      usn: r.Student ? r.Student.usn : '',
      semester: r.ResultSession ? r.ResultSession.semester : '',
      exam_session: r.ResultSession ? r.ResultSession.exam_session : '',
      exam_year: r.ResultSession ? r.ResultSession.exam_year : '',
      attempt_no: r.attempt_no,
      exam_type: r.exam_type,
      result_status: r.result_status,
      cgpa: r.cgpa
    }));

    return res.render('revaluation/result-picker', {
      title: 'Revaluation — Select a Result',
      breadcrumbItems: [
        { label: 'Result Management' },
        { label: 'Upload Revaluation', href: '/revaluation/upload', active: true }
      ],
      query: q,
      results: list,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('[revaluation] showResultPicker error:', err);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Could not load results.'));
  }
};

/**
 * GET /revaluation/:resultId — Result detail (attempt + subjects w/ marks).
 */
exports.showResultDetail = async (req, res) => {
  const resultId = Number(req.params.resultId);
  if (!Number.isInteger(resultId) || resultId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid result.'));
  }

  let result;
  try {
    result = await loadResultContext(resultId);
  } catch (err) {
    console.error('[revaluation] showResultDetail error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load result.'));
  }
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  const subjects = (result.SubjectResults || []).map(sr => ({
    subject_result_id: sr.subject_result_id,
    result_id: sr.result_id,
    subject_id: sr.subject_id,
    subject_code: sr.Subject ? sr.Subject.subject_code : '',
    subject_name: sr.Subject ? sr.Subject.subject_name : '',
    credits: sr.Subject ? sr.Subject.credits : '',
    marks: sr.marks,
    grade: sr.grade,
    result_status: sr.result_status,
    created_at: sr.created_at
  }));

  return res.render('revaluation/result-detail', {
    title: 'Revaluation — Result Detail',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Result Detail', active: true }
    ],
    resultId: result.result_id,
    student: { name: result.Student ? result.Student.student_name : '', usn: result.Student ? result.Student.usn : '' },
    sessionDisplay: sessionDisplay(result.ResultSession),
    attempt: { attempt_no: Number(result.attempt_no), exam_type: result.exam_type },
    result_status: result.result_status,
    cgpa: result.cgpa,
    subjects,
    error: req.query.error || null
  });
};
/**
 * POST /revaluation/:resultId/start — "Start Revaluation".
 * Re-validates the selection server-side (exist + belongs-to-this-result)
 * and stashes the verified ids in the session (source of truth on submit).
 */
exports.startRevaluation = async (req, res) => {
  const resultId = Number(req.params.resultId);
  if (!Number.isInteger(resultId) || resultId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid result.'));
  }

  let result;
  try {
    result = await Result.findByPk(resultId, {
      attributes: ['result_id', 'student_id', 'session_id', 'attempt_no', 'exam_type']
    });
  } catch (err) {
    console.error('[revaluation] startRevaluation lookup error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load result.'));
  }
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  // Parse selection only as a "hint"; it is re-validated below.
  let ids = req.body.subject_result_id;
  const arr = Array.isArray(ids) ? ids : (ids ? [ids] : []);
  const parsed = arr
    .map(v => Number(String(v || '').trim()))
    .filter(n => Number.isInteger(n) && n > 0);
  const unique = [...new Set(parsed)];

  if (unique.length === 0) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('Select at least one subject to revalue.'));
  }

  // SECURITY: every id must exist AND belong to THIS result.
  const rows = await SubjectResult.findAll({
    where: { subject_result_id: unique },
    attributes: ['subject_result_id', 'result_id']
  });
  const byId = new Map(rows.map(r => [r.subject_result_id, r]));

  const missing = unique.filter(id => !byId.has(id));
  if (missing.length) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('One or more selected subjects could not be found.'));
  }
  const foreign = unique.filter(id => Number(byId.get(id).result_id) !== Number(result.result_id));
  if (foreign.length) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('One or more subjects do not belong to this result. Selection rejected.'));
  }

  // Stash the server-verified selection (the source of truth on submit).
  req.session.revaluationDraft = {
    resultId: Number(result.result_id),
    studentId: Number(result.student_id),
    sessionId: Number(result.session_id),
    attempt_no: Number(result.attempt_no),
    exam_type: result.exam_type,
    subjectResultIds: unique,
    startedAt: Date.now()
  };

  return res.redirect(`/revaluation/${result.result_id}/upload`);
};

/**
 * GET /revaluation/:resultId/upload — upload page.
 * Re-derives the selected subjects server-side from the session draft and
 * renders them read-only; the submitted list is never trusted from the browser.
 */
exports.showUploadPage = async (req, res) => {
  const resultId = Number(req.params.resultId);
  const draft = req.session && req.session.revaluationDraft;

  if (!draft || Number(draft.resultId) !== resultId) {
    return res.redirect(`/revaluation/${resultId}?error=` +
      encodeURIComponent('No revaluation in progress. Please select subjects first.'));
  }
  if (Date.now() - (draft.startedAt || 0) > REVAL_PENDING_SECONDS * 1000) {
    delete req.session.revaluationDraft;
    return res.redirect(`/revaluation/${resultId}?error=` +
      encodeURIComponent('Your subject selection expired. Please re-select.'));
  }

  const result = await loadResultContext(resultId);
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  const ids = draft.subjectResultIds || [];
  const owned = await SubjectResult.findAll({
    where: { subject_result_id: ids, result_id: Number(result.result_id) },
    attributes: ['subject_result_id', 'marks', 'grade', 'result_status'],
    include: [{ model: Subject, attributes: ['subject_code', 'subject_name', 'credits', 'max_marks'] }]
  });
  const validSet = new Set(owned.map(s => Number(s.subject_result_id)));
  if (owned.length !== ids.length) {
    delete req.session.revaluationDraft;
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('Stashed selection is no longer valid. Please re-select.'));
  }

  const subjects = owned.map(sr => ({
    subject_result_id: sr.subject_result_id,
    subject_code: sr.Subject ? sr.Subject.subject_code : '',
    subject_name: sr.Subject ? sr.Subject.subject_name : '',
    credits: sr.Subject ? (sr.Subject.credits || 0) : 0,
    max_marks: sr.Subject ? (sr.Subject.max_marks || 100) : 100,
    original_marks: sr.marks,
    grade: sr.grade,
    result_status: sr.result_status
  }));

  return res.render('revaluation/upload', {
    title: 'Revaluation — Upload Document',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Result Detail', href: `/revaluation/${result.result_id}` },
      { label: 'Upload Document', active: true }
    ],
    resultId: result.result_id,
    student: { name: result.Student ? result.Student.student_name : '', usn: result.Student ? result.Student.usn : '' },
    sessionDisplay: sessionDisplay(result.ResultSession),
    attempt: { attempt_no: Number(result.attempt_no), exam_type: result.exam_type },
    subjects,
    subjectCount: subjects.length,
    error: req.query.error || null
  });
};
/**
 * POST /revaluation/:resultId/upload — register the revaluation document and
 * its processing state. Selection is recovered from the server session draft
 * (re-validated); Result/attempt context is resolved from the DB. No
 * Result/SubjectResult/RevaluationResult row is created or modified here.
 */
exports.processUpload = async (req, res) => {
  const resultId = Number(req.params.resultId);
  const adminId = resolveAdminId(req);
  let result;

  try {
    result = await Result.findByPk(resultId, {
      attributes: ['result_id', 'student_id', 'session_id', 'attempt_no', 'exam_type', 'result_status'],
      include: [
        { model: Student, attributes: ['student_name', 'usn'] },
        { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] }
      ]
    });
  } catch (err) {
    console.error('[revaluation] processUpload lookup error:', err);
    return res.redirect(`/revaluation/${Number.isFinite(resultId) ? resultId : ''}/upload?error=` +
      encodeURIComponent('Could not load result.'));
  }
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  // Recover the server-stashed selection and re-validate ownership (DB truth).
  const draft = req.session && req.session.revaluationDraft;
  const subjectResultIds = (draft && Number(draft.resultId) === Number(result.result_id))
    ? (draft.subjectResultIds || [])
    : [];
  if (!draft || Number(draft.resultId) !== Number(result.result_id) || subjectResultIds.length === 0) {
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('No subjects selected. Please go back and select subjects.'));
  }

  const owned = await SubjectResult.findAll({
    where: { subject_result_id: subjectResultIds, result_id: Number(result.result_id) },
    attributes: ['subject_result_id', 'subject_id', 'marks', 'grade', 'result_status'],
    include: [{ model: Subject, attributes: ['subject_code', 'subject_name', 'credits', 'max_marks'] }]
  });
  if (owned.length !== subjectResultIds.length) {
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Selection validation failed. Please re-select subjects.'));
  }

  // File validation (multer already gates MIME/type/size; verify again here).
  if (!req.file) {
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Please choose a revaluation document (PDF).'));
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const mimeType = (req.file.mimetype || '').toLowerCase();
  if (!REVAL_ALLOWED_EXT.includes(ext) || !mimeType.includes('pdf')) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Only PDF documents are accepted.'));
  }

  // Move the validated file into the revaluation upload directory.
  ensureRevalDir();
  const secureName = generateSecureFilename(req.file.originalname);
  const storedPath = path.join(REVAL_DIR, secureName);
  fs.renameSync(req.file.path, storedPath);
  const fileUrl = '/uploads/revaluation/' + secureName;

  const t = await sequelize.transaction();
  let importLog;
  try {
    importLog = await ImportLog.create({
      session_id: Number(result.session_id),
      uploaded_by: adminId,
      file_name: secureName,
      file_path: storedPath,
      file_type: ext.replace(/^\./, ''),
      import_type: 'REVALUATION',
      status: 'pending',
      total_records: owned.length,
      imported_records: 0,
      skipped_records: 0
    }, { transaction: t });

    const subjectJson = owned.map(sr => ({
      subject_result_id: sr.subject_result_id,
      result_id: Number(result.result_id),
      subject_id: sr.subject_id,
      subject_code: sr.Subject ? sr.Subject.subject_code : null,
      subject_name: sr.Subject ? sr.Subject.subject_name : null,
      credits: sr.Subject ? (sr.Subject.credits || 0) : 0,
      max_marks: sr.Subject ? (sr.Subject.max_marks || 100) : 100,
      original_marks: sr.marks,
      grade: sr.grade,
      result_status: sr.result_status
    }));

    await OcrExtraction.create({
      import_id: importLog.import_id,
      raw_text: '',
      extracted_json: {
        source: 'revaluation',
        result_id: Number(result.result_id),
        student_id: Number(result.student_id),
        session_id: Number(result.session_id),
        attempt: { attempt_no: Number(result.attempt_no), exam_type: result.exam_type },
        documents: [{
          file_name: secureName, file_path: storedPath, file_url: fileUrl,
          file_type: ext.replace(/^\./, ''), uploaded_by: adminId
        }],
        student: {
          student_id: Number(result.student_id),
          name: result.Student ? result.Student.student_name : null,
          usn: result.Student ? result.Student.usn : null
        },
        session: {
          session_id: Number(result.session_id),
          semester: result.ResultSession ? result.ResultSession.semester : null,
          exam_session: result.ResultSession ? result.ResultSession.exam_session : null,
          exam_year: result.ResultSession ? result.ResultSession.exam_year : null
        },
        subjects: subjectJson
      },
      confidence_score: 0,
      validation_status: 'pending'
    }, { transaction: t });

    await t.commit();
    delete req.session.revaluationDraft;
    return res.redirect(`/revaluation/pending/${importLog.import_id}`);
  } catch (err) {
    await t.rollback();
    try { if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath); } catch { /* ignore */ }
    console.error('[revaluation] processUpload create error:', err);
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Failed to register revaluation: ' + (err.message || 'server error')));
  }
};

/**
 * GET /revaluation/pending/:importId — placeholder for the OCR stage.
 * Read-only view of the registered processing state.
 */
exports.showPending = async (req, res) => {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId) || importId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid revaluation record.'));
  }

  let log;
  try {
    log = await ImportLog.findByPk(importId, {
      include: [
        { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] },
        { model: OcrExtraction }
      ]
    });
  } catch (err) {
    console.error('[revaluation] showPending error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }

  const ocr = log.OcrExtractions && log.OcrExtractions[0];
  const saved = safeJson(ocr ? ocr.extracted_json : null);

  return res.render('revaluation/pending', {
    title: 'Revaluation — Pending OCR',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Pending OCR', active: true }
    ],
    importId: log.import_id,
    status: log.status,
    import_type: log.import_type,
    uploadedBy: log.uploaded_by,
    createdAt: log.created_at,
    file_name: log.file_name,
    sessionDisplay: sessionDisplay(log.ResultSession),
    student: (saved && saved.student) || {},
    attempt: (saved && saved.attempt) || {},
        documents: (saved && saved.documents) || [],
    subjects: (saved && saved.subjects) || [],
    subjectCount: (saved && saved.subjects) ? saved.subjects.length : 0,
    error: req.query.error || null
  });
};

// ============================================================
// PROMPT 4 — REVALUATION OCR EXTRACTION STAGE
// OCR output is CANDIDATE data only. The selected Result remains
// the authoritative identity; academic tables are never written.
// ============================================================
const revaluationExtractor = require('../services/revaluationExtractor');

/** Shared loader for the extraction stage (ImportLog + session + extractions). */
async function loadRevalImport(importId) {
  return ImportLog.findByPk(importId, {
    include: [
      { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] },
      { model: OcrExtraction }
    ]
  });
}

/** Build the failure variant of extracted_json (context keys preserved, ocr marked failed). */
function failedExtractionJson(saved, reason, message) {
  const ocrBlock = Object.assign({}, (saved && saved.ocr) || {}, {
    extraction_status: 'failed',
    failed_reason: reason,
    error: message,
    extracted_at: new Date().toISOString()
  });
  const next = Object.assign({}, saved || {}, { ocr: ocrBlock });
  next.warnings = Array.from(new Set([].concat(next.warnings || [], [message]))).filter(Boolean);
  return next;
}

/** Transactionally persist a failed attempt: OcrExtraction=rejected + ImportLog=failed. */
async function persistExtractionFailure(ocrRow, log, saved, reason, message) {
  const t = await sequelize.transaction();
  try {
    await ocrRow.update({
      validation_status: 'rejected',
      extracted_json: failedExtractionJson(saved, reason, message)
    }, { transaction: t });
    await log.update({ status: 'failed' }, { transaction: t });
    await t.commit();
    return true;
  } catch (err) {
    await t.rollback();
    console.error('[revaluation] persistExtractionFailure error:', err);
    return false;
  }
}

/**
 * POST /revaluation/pending/:importId/extract
 * Runs the shared OCR engine over the ALREADY-STORED revaluation document and
 * records candidates into OcrExtraction.extracted_json.ocr. Request body is
 * ignored entirely — importId is the only input, everything else comes from DB.
 */
exports.runExtraction = async (req, res) => {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId) || importId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid revaluation record.'));
  }

  let log;
  try { log = await loadRevalImport(importId); }
  catch (err) {
    console.error('[revaluation] runExtraction load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }
  if (log.import_type !== 'REVALUATION') {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('This record is not a revaluation import.'));
  }
  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  if (!ocrRow) {
    return res.redirect(`/revaluation/pending/${importId}?error=` + encodeURIComponent('No OCR processing record is attached to this import.'));
  }

  // Idempotency: a completed extraction is never re-run; failures are retryable.
  if (log.status === 'extracted' || log.status === 'success') {
    return res.redirect(`/revaluation/extraction/${importId}`);
  }

  const saved = safeJson(ocrRow.extracted_json);

  // ---- Server-authoritative context re-validation (DB truth vs stored JSON) ----
  const ctxErrors = [];
  let result = null;
  if (!stored_guardHasContext(saved)) {
    ctxErrors.push('Stored extraction context is incomplete (result_id/student/session/attempt).');
  } else {
    try { result = await loadResultContext(saved.result_id); }
    catch (err) {
      console.error('[revaluation] runExtraction context load error:', err);
      ctxErrors.push('Could not reload the selected Result.');
    }
    if (!result && ctxErrors.length === 0) {
      ctxErrors.push('The selected Result no longer exists.');
    }
    if (result) {
      if (Number(result.student_id) !== Number(saved.student_id)) ctxErrors.push('Stored student no longer matches the Result.');
      if (Number(result.session_id) !== Number(saved.session_id)) ctxErrors.push('Stored session no longer matches the Result.');
      if (saved.attempt && (Number(result.attempt_no) !== Number(saved.attempt.attempt_no) || result.exam_type !== saved.attempt.exam_type)) {
        ctxErrors.push('Stored attempt number/type no longer matches the Result.');
      }
      const ownedIds = new Set((result.SubjectResults || []).map(sr => Number(sr.subject_result_id)));
      for (const s of (saved.subjects || [])) {
        if (!ownedIds.has(Number(s.subject_result_id))) {
          ctxErrors.push(`Selected subject ${(s.subject_code || s.subject_result_id)} no longer belongs to this Result.`);
        }
      }
    }
  }
  if (ctxErrors.length > 0) {
    const msg = 'Server-side revaluation context is invalid: ' + ctxErrors.join(' ');
    const okPersist = await persistExtractionFailure(ocrRow, log, saved, 'CONTEXT_INVALID', msg);
    return res.redirect(`/revaluation/extraction/${importId}` + (okPersist ? '' : '?error=' + encodeURIComponent('Could not save extraction failure state.')));
  }

  // ---- Stored document only (never a browser-supplied path; never moved/deleted) ----
  const doc = (Array.isArray(saved.documents) && saved.documents[0]) || null;
  const filePath = doc ? doc.file_path : null;
  if (!filePath || !fs.existsSync(filePath)) {
    await persistExtractionFailure(ocrRow, log, saved, 'FILE_MISSING',
      'The stored revaluation document could not be found on disk. Re-upload may be required at the upload stage.');
    return res.redirect(`/revaluation/extraction/${importId}`);
  }

  // ---- Run the shared OCR engine through the thin adapter ----
  const serverCtx = {
    studentUsn: (result.Student && result.Student.usn) || (saved.student && saved.student.usn) || null,
    studentName: (result.Student && result.Student.student_name) || (saved.student && saved.student.name) || null,
    selectedSubjects: (saved.subjects || []).map(s => ({
      subject_result_id: s.subject_result_id,
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      original_marks: s.original_marks
    }))
  };

  let outcome = null;
  try {
    outcome = await revaluationExtractor.extractAndBuild(filePath, serverCtx);
  } catch (err) {
    console.error('[revaluation] extractAndBuild error:', err);
    outcome = { ok: false, reason: 'EXTRACTION_ERROR', ocr: {} };
    const okPersist = await persistExtractionFailure(ocrRow, log, saved, 'EXTRACTION_ERROR',
      'OCR extraction failed' + ((err && err.message) ? ': ' + err.message : '.'));
    return res.redirect(`/revaluation/extraction/${importId}` + (okPersist ? '' : '?error=' + encodeURIComponent('Could not save extraction failure state.')));
  }

  // ---- Transactional state write (OcrExtraction + ImportLog together) ----
  const t = await sequelize.transaction();
  try {
    if (outcome.ok) {
      const nextJson = Object.assign({}, saved, { ocr: outcome.ocr });
      await ocrRow.update({
        raw_text: outcome.ocr.raw_text || '',
        confidence_score: outcome.confidenceScore,
        validation_status: 'pending',
        extracted_json: nextJson
      }, { transaction: t });
      await log.update({ status: 'extracted' }, { transaction: t });
      await t.commit();
    } else {
      const block = Object.assign({}, outcome.ocr || {}, {
        extraction_status: 'failed',
        failed_reason: outcome.reason || 'FAILED',
        extracted_at: new Date().toISOString()
      });
      if (outcome.reason === 'EMPTY_EXTRACTION' && block.error) {
        block.error = block.error; // message already set by the adapter
      }
      const nextJson = Object.assign({}, saved, { ocr: block });
      nextJson.warnings = Array.from(new Set([].concat(nextJson.warnings || [], block.warnings || []))).filter(Boolean);
      await ocrRow.update({ validation_status: 'rejected', extracted_json: nextJson }, { transaction: t });
      await log.update({ status: 'failed' }, { transaction: t });
      await t.commit();
    }
  } catch (err) {
    await t.rollback();
    console.error('[revaluation] extraction persist error:', err);
    return res.redirect(`/revaluation/pending/${importId}?error=` + encodeURIComponent('Could not save extraction state.'));
  }

  return res.redirect(`/revaluation/extraction/${importId}`);
};

function stored_guardHasContext(saved) {
  return !!(saved && saved.result_id && saved.student_id && saved.session_id &&
             saved.attempt && Array.isArray(saved.subjects));
}

/**
 * GET /revaluation/extraction/:importId — READ-ONLY extraction result.
 * Shows OCR candidates next to the server-authoritative context. No inputs.
 */
exports.showExtraction = async (req, res) => {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId) || importId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid revaluation record.'));
  }

  let log;
  try { log = await loadRevalImport(importId); }
  catch (err) {
    console.error('[revaluation] showExtraction load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }
  if (log.import_type !== 'REVALUATION') {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('This record is not a revaluation import.'));
  }

  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  const saved = safeJson(ocrRow ? ocrRow.extracted_json : null);
  const ocr = (saved && saved.ocr) || {};
  const doc = (saved && Array.isArray(saved.documents) && saved.documents[0]) || null;

  const unmatched = (ocr.unmatched_ocr_details && ocr.unmatched_ocr_details.length)
    ? ocr.unmatched_ocr_details
    : ((ocr.unmatched_ocr_codes || []).map(c => ({ ocr_subject_code: c })));

  return res.render('revaluation/extraction', {
    title: 'Revaluation — OCR Extraction',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Pending OCR', href: `/revaluation/pending/${log.import_id}` },
      { label: 'OCR Extraction', active: true }
    ],
    importId: log.import_id,
    logStatus: log.status,
    extractionStatus: ocr.extraction_status || null,
    failedReason: ocr.failed_reason || null,
    errorMsg: ocr.error || null,
    resultId: (saved && saved.result_id) || null,
    student: {
      name: (saved && saved.student && saved.student.name) || '',
      usn: (saved && saved.student && saved.student.usn) || ''
    },
    sessionDisplay: sessionDisplay(log.ResultSession),
    attempt: (saved && saved.attempt) || {},
    docLink: (doc && doc.file_url) ? doc.file_url : null,
    docName: (doc && doc.file_name) ? doc.file_name : (log.file_name || ''),
    ocrStudent: ocr.student_candidates || {},
    semesterCandidate: (ocr.semester_candidate === undefined ? null : ocr.semester_candidate),
    subjects: ocr.subjects || [],
    unmatched: unmatched,
    unmatchedCodes: ocr.unmatched_ocr_codes || [],
    warnings: ocr.warnings || [],
    rawText: ocr.raw_text || (ocrRow && ocrRow.raw_text) || '',
    confidenceScore: ocrRow ? ocrRow.confidence_score : null,
    extractionMethod: ocr.extraction_method || null,
    extractedAt: ocr.extracted_at || null,
    error: req.query.error || null
  });
};

// ============================================================
// PROMPT 5 — REVIEW / VALIDATION / APPROVAL / EFFECTIVE OVERLAY
// Browser input is a PROPOSAL ONLY. Identity, original values and every
// derived value are resolved/recalculated server-side:
//   - revised total is ALWAYS internal + external (client totals ignored)
//   - status/grade come from the SHARED gradeFromPercent engine (reused,
//     never reimplemented differently)
//   - original marks/status snapshots come from LOCKED DB rows at approval
//     time, never from extracted_json or the request body
// Confirmed decisions: D1 manual entry allowed; D2 server-derived status;
// D3 lower-than-original allowed + warning; D4 batch approval per import;
// D5 same admin may review and approve; D6 aggregates are derived analytics.
// ============================================================
// Shared authoritative grade/status engine (single source of truth).
// Exposed by resultController via its documented test-hook namespace.
const rcInternals = require('./resultController')._test;
if (!rcInternals || typeof rcInternals.gradeFromPercent !== 'function') {
  throw new Error('PROMPT 5 requires resultController._test.gradeFromPercent (the shared P.G. 2022/2024 scale).');
}
const gradeFromPercent = rcInternals.gradeFromPercent;
const { STATUS_MAP } = require('../services/revaluationExtractor');

// Card letters that cannot exist in the ('pass','fail') status enums.
const REVAL_ACK_LETTERS = ['ABSENT', 'WITHHELD', 'NOT_ELIGIBLE'];

function canonicalLetter(raw) {
  if (raw === null || raw === undefined) return null;
  return STATUS_MAP[String(raw).trim().toUpperCase()] || null;
}

/** Strict integer-field parse: absent -> present:false; garbage -> invalid:true. */
function normalizeIntInput(v) {
  if (v === undefined || v === null || String(v).trim() === '') {
    return { present: false, value: null };
  }
  const s = String(v).trim();
  if (!/^-?[0-9]+$/.test(s)) return { present: true, value: null, invalid: true };
  return { present: true, value: parseInt(s, 10) };
}

/** Server-side bounds ladder, mirroring buildValidatedPayload fallbacks. */
function subjectLimits(subject) {
  const maxInt = (subject && subject.max_internal !== null && subject.max_internal !== undefined)
    ? Number(subject.max_internal) : 50;
  const maxExt = (subject && subject.max_external !== null && subject.max_external !== undefined)
    ? Number(subject.max_external) : 50;
  const maxTotal = (subject && subject.max_marks !== null && subject.max_marks !== undefined)
    ? Number(subject.max_marks) : (maxInt + maxExt);
  return { maxInt, maxExt, maxTotal };
}

/**
 * Validate ONE subject decision and compute the AUTHORITATIVE revision.
 * @param {Object} a { decision, internalRaw, externalRaw, ackRaw,
 *                      sr, subject, ocrRow }
 *   sr      = SubjectResult row (CURRENT values; callers lock rows when writing)
 *   subject = associated Subject row providing mark ceilings/credits
 *   ocrRow  = matching extracted_json.ocr.subjects entry (evidence only) or null
 * @returns {ok, errors[], warnings[], proposal|null}
 */
function validateAndComputeRevised(a) {
  const errors = [];
  const warnings = [];
  const srid = Number(a.sr.subject_result_id);

  if (!a.decision) {
    return { ok: true, errors, warnings,
      proposal: { subject_result_id: srid, decision: 'reject',
        rejection_reason: 'ADMIN_REJECTED' } };
  }

  const i = normalizeIntInput(a.internalRaw);
  const e = normalizeIntInput(a.externalRaw);
  const limits = subjectLimits(a.subject);

  if (!i.present) errors.push('Internal marks are required.');
  else if (i.invalid) errors.push('Internal marks must be a whole number.');
  else if (i.value < 0 || i.value > limits.maxInt) {
    errors.push('Internal marks must be between 0 and ' + limits.maxInt + '.');
  }

  if (!e.present) errors.push('External marks are required.');
  else if (e.invalid) errors.push('External marks must be a whole number.');
  else if (e.value < 0 || e.value > limits.maxExt) {
    errors.push('External marks must be between 0 and ' + limits.maxExt + '.');
  }

  if (errors.length) return { ok: false, errors, warnings, proposal: null };

  // D2/E: total is NEVER trusted from the browser.
  const total = i.value + e.value;
  if (total > limits.maxTotal) {
    errors.push('Total ' + total + ' exceeds maximum ' + limits.maxTotal + ' marks.');
    return { ok: false, errors, warnings, proposal: null };
  }
  const pct = limits.maxTotal > 0 ? Math.floor((total / limits.maxTotal) * 100) : 0;
  const g = gradeFromPercent(pct);            // shared P.G. 2022/2024 scale

  const ocr = a.ocrRow || null;
  const acknowledged = !!a.ackRaw;
  if (ocr && ocr.raw_status) {
    const canon = canonicalLetter(ocr.raw_status);
    if (!canon) {
      warnings.push('Unrecognized document status "' + ocr.raw_status + '" ignored; server-derived outcome used.');
    } else if (REVAL_ACK_LETTERS.indexOf(canon) !== -1 && !acknowledged) {
      errors.push('Document shows ' + canon + ', which cannot be stored as pass/fail. Tick the acknowledgement box to record the computed outcome (' + g.status + ').');
    } else if ((canon === 'FAIL') !== (g.status === 'fail')) {
      warnings.push('Document letter (' + canon + ') differs from server-derived outcome (' + g.status + '); computed value stored.');
    }
  }

  // Acknowledgement-required letters (ABSENT/WITHHELD/NOT_ELIGIBLE without the
  // explicit admin tick) must abort THIS decision entirely — the proposal can
  // never be frozen or approved while such an error stands. Everything below
  // assumes all blocking validation has passed.
  if (errors.length) {
    return { ok: false, errors, warnings, proposal: null };
  }

  if (ocr && ocr.revised_marks !== null && ocr.revised_marks !== undefined &&
      Number(ocr.revised_marks) !== total) {
    warnings.push('Document total ' + ocr.revised_marks + ' replaced by recalculated ' + total + ' (internal + external).');
  }

  // D3: falling below the original is permitted but always recorded loudly.
  const origMarks = Number(a.sr.marks);
  if (total < origMarks) {
    warnings.push('Revised total (' + total + ') is LOWER than the original (' + origMarks + '); recorded intentionally.');
  }

  const wasManual = !ocr ||
    !(ocr.match_state === 'MATCHED') ||
    Number(ocr.revised_internal_marks) !== i.value ||
    Number(ocr.revised_external_marks) !== e.value;

  return { ok: true, errors, warnings, proposal: {
    subject_result_id: srid,
    decision: 'accept',
    was_manual_correction: !!wasManual,
    proposed_revised_internal_marks: i.value,
    proposed_revised_external_marks: e.value,
    proposed_revised_total_marks: total,
    proposed_revised_percent: pct,
    proposed_revised_status: g.status,
    proposed_revised_grade: g.grade,
    warnings: warnings
  } };
}

/** Read one accept/reject radio; anything other than an explicit accept rejects. */
function readDecisionField(body, srid) {
  return !!(body && body['decision_' + srid] === 'accept');
}

/** Optional ambiguity binding: which selected SubjectResult this source row resolves onto. */
function readPickField(body, srid) {
  const raw = body ? body['ambiguous_pick_' + srid] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n > 0 ? n : -1;
}

/** Provenance string — sole cross-stage link without any schema change. */
function buildEventRemarks(importId, method) {
  return 'Revaluation import #' + importId + (method ? ' | OCR ' + method : '');
}

/**
 * Derived effective aggregates over a subject mix (D6: display analytics ONLY;
 * Result rows are never written). Formulas mirror buildValidatedPayload:
 * SGPA over ALL courses; CGPA excluding F-grade courses; overall by fail count.
 * mix items: { credits, max_marks, effective_marks }
 */
function computeOverlayAggregates(mix) {
  let allPoints = 0, allCredits = 0, failedCount = 0;
  let passedPoints = 0, passedCredits = 0;
  for (const m of mix) {
    const maxTotal = m.max_marks || 100;
    const pct = maxTotal > 0 ? Math.floor((m.effective_marks / maxTotal) * 100) : 0;
    const g = gradeFromPercent(pct);
    const credits = m.credits || 0;
    allPoints += g.point * credits;
    allCredits += credits;
    if (g.status === 'fail') failedCount++;
    else { passedPoints += g.point * credits; passedCredits += credits; }
  }
  return {
    overall_result: failedCount === 0 ? 'pass' : 'fail',
    sgpa: allCredits > 0 ? Number((allPoints / allCredits).toFixed(2)) : 0,
    cgpa: passedCredits > 0 ? Number((passedPoints / passedCredits).toFixed(2)) : null,
    failed_subject_count: failedCount
  };
}

// ---------------- Review state (shared by GET/POST/approve/outcome) ----------------
const enc = encodeURIComponent;

/** Like loadResultContext, but also pulls the mark ceilings for review math. */
function loadResultContextFull(resultId, t, lock) {
  const opts = {
    include: [
      { model: Student, attributes: ['student_name', 'usn'] },
      { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] },
      {
        model: SubjectResult,
        attributes: ['subject_result_id', 'result_id', 'subject_id', 'marks', 'grade', 'result_status'],
        include: [{
          model: Subject,
          attributes: ['subject_code', 'subject_name', 'credits',
                       'max_internal', 'max_external', 'max_marks']
        }]
      }
    ]
  };
  if (t) { opts.transaction = t; if (lock) opts.lock = lock; }
  return Result.findByPk(resultId, opts);
}

/** Normalization identical to the extractor's comparison-only variant. */
function normCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Shared guard-loader for review/approve/outcome.
 * Re-derives EVERYTHING from the database and fail-closes on any drift
 * between the stored server context and current DB truth (same policy as
 * runExtraction). Returns either
 *   { ok:true, log, ocrRow, saved, ocr, review, approved, result, srById, rows, meta }
 * or { ok:false, redirect }.
 */
async function loadReviewState(importId, optsIn) {
  const opts = optsIn || {};
  if (!Number.isInteger(importId) || importId <= 0) {
    return { ok: false, redirect: '/revaluation/upload?error=' + enc('Invalid revaluation record.') };
  }

  const log = await loadRevalImport(importId);
  if (!log) {
    return { ok: false, redirect: '/revaluation/upload?error=' + enc('Revaluation record not found.') };
  }
  if (log.import_type !== 'REVALUATION') {
    return { ok: false, redirect: '/revaluation/upload?error=' + enc('This record is not a revaluation import.') };
  }
  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  if (!ocrRow) {
    return { ok: false, redirect: `/revaluation/pending/${importId}?error=` +
      enc('No OCR processing record is attached to this import.') };
  }
  const saved = safeJson(ocrRow.extracted_json);
  if (!stored_guardHasContext(saved)) {
    return { ok: false, redirect: `/revaluation/pending/${importId}?error=` +
      enc('Stored extraction context is incomplete.') };
  }
  const ocr = saved.ocr || {};
  const backTo = opts.failureBack || `/revaluation/extraction/${importId}`;

  let result = null;
  try { result = await loadResultContextFull(saved.result_id, opts.t, opts.t ? opts.lock : undefined); }
  catch (err) {
    console.error('[revaluation] loadReviewState context error:', err);
    result = null;
  }
  if (!result) {
    return { ok: false, redirect: `${backTo}?error=` + enc('The selected Result no longer exists.') };
  }

  const extractedOk = !opts.requireExtracted || ocr.extraction_status === 'extracted';
  if (!extractedOk) {
    return { ok: false, redirect: `${backTo}?error=` +
      enc('OCR candidates are not available for this record yet.') };
  }

  // Identity drift checks vs CURRENT DB truth (fail-closed).
  const ctxErrs = [];
  if (Number(result.student_id) !== Number(saved.student_id)) ctxErrs.push('Stored student no longer matches the Result.');
  if (Number(result.session_id) !== Number(saved.session_id)) ctxErrs.push('Stored session no longer matches the Result.');
  if (saved.attempt && (Number(result.attempt_no) !== Number(saved.attempt.attempt_no) ||
                        result.exam_type !== saved.attempt.exam_type)) {
    ctxErrs.push('Stored attempt number/type no longer matches the Result.');
  }
  const ownedIds = new Set((result.SubjectResults || []).map(sr => Number(sr.subject_result_id)));
  for (const s of (saved.subjects || [])) {
    if (!ownedIds.has(Number(s.subject_result_id))) {
      ctxErrs.push(`Selected subject ${s.subject_code || s.subject_result_id} no longer belongs to this Result.`);
    }
  }
  if (ctxErrs.length) {
    return { ok: false, redirect: `${backTo}?error=` +
      enc('Server-side revaluation context is invalid: ' + ctxErrs.join(' ')) };
  }

  const srById = new Map();
  for (const sr of (result.SubjectResults || [])) srById.set(Number(sr.subject_result_id), sr);

  // Evidence lookup + normalized-code grouping among SELECTED subjects.
  const evBySrid = new Map((ocr.subjects || []).map(r => [Number(r.subject_result_id), r]));
  const selNorms = (saved.subjects || []).map(s => ({
    id: Number(s.subject_result_id), norm: normCode(s.subject_code)
  }));

  const rows = (saved.subjects || []).map(sv => {
    const srid = Number(sv.subject_result_id);
    const sr = srById.get(srid);
    const subj = (sr && sr.Subject) ? sr.Subject : null;
    const limits = subjectLimits(subj);
    const ev = evBySrid.get(srid) || null;
    const ambiguous = !!(ev && ev.match_state === 'AMBIGUOUS');
    const pickOptions = ambiguous
      ? selNorms
          .filter(x => x.norm === normCode(sv.subject_code) && x.id !== srid)
          .map(x => ({
            id: x.id,
            code: ((srById.get(x.id) || {}).Subject || {}).subject_code || ('#' + x.id)
          }))
      : [];
    return {
      srid,
      code: sv.subject_code || ((subj && subj.subject_code) || ''),
      name: sv.subject_name || ((subj && subj.subject_name) || ''),
      credits: (subj && subj.credits) || sv.credits || 0,
      maxInternal: limits.maxInt,
      maxExternal: limits.maxExt,
      maxMarks: limits.maxTotal,
      origMarks: sr ? Number(sr.marks) : null,
      origStatus: sr ? sr.result_status : null,
      origGrade: sr ? sr.grade : null,
      evidence: {
        match_state: ev ? ev.match_state : 'SELECTED_BUT_NOT_FOUND',
        ocr_subject_code: ev ? ev.ocr_subject_code : null,
        normalized: ev ? ev.normalized_code : normCode(sv.subject_code),
        revised_int: ev ? ev.revised_internal_marks : null,
        revised_ext: ev ? ev.revised_external_marks : null,
        revised_total: ev ? ev.revised_marks : null,
        status_candidate: ev ? ev.revised_status_candidate : null,
        raw_letter: ev ? ev.raw_status : null,
        confidence: ev ? ev.confidence : null,
        raw_line: ev ? ev.raw_line : null,
        ambiguous
      },
      pickOptions
    };
  });

  const doc = (Array.isArray(saved.documents) && saved.documents[0]) || {};
  const review = saved.review || null;

  return {
    ok: true, log, ocrRow, saved, ocr, review,
    approved: log.status === 'success',
    result, srById, rows,
    meta: {
      importId: Number(log.import_id),
      resultId: Number(result.result_id),
      studentName: result.Student ? result.Student.student_name : '',
      studentUsn: result.Student ? result.Student.usn : '',
      sessionDisplay: sessionDisplay(result.ResultSession),
      attemptNo: Number(result.attempt_no),
      examType: result.exam_type,
      docName: doc.file_name || log.file_name || '',
      docUrl: doc.file_url || null,
      ocrStudent: ocr.student_candidates || {},
      warnings: ocr.warnings || [],
      unmatched: (ocr.unmatched_ocr_details && ocr.unmatched_ocr_details.length)
        ? ocr.unmatched_ocr_details
        : (ocr.unmatched_ocr_codes || []).map(c => ({ ocr_subject_code: c })),
      rawText: ocr.raw_text || ocrRow.raw_text || '',
      extractionMethod: ocr.extraction_method || null,
      uploadedByAdminId: Number(log.uploaded_by)
    }
  };
}

/**
 * GET /revaluation/review/:importId — Review/Edit stage.
 * S0 "edit": editable proposals per selected subject. After a saved decision
 * set, renders S1 "locked" with the Approve entry point. Approved imports go
 * straight to the outcome page.
 */
exports.showReview = async (req, res) => {
  const importId = Number(req.params.importId);
  let st;
  try { st = await loadReviewState(importId, { requireExtracted: true }); }
  catch (err) {
    console.error('[revaluation] showReview error:', err);
    return res.redirect('/revaluation/upload?error=' +
      enc('Could not load revaluation record.'));
  }
  if (!st.ok) return res.redirect(st.redirect);
  if (st.approved) return res.redirect(`/revaluation/outcome/${importId}`);

  return res.render('revaluation/review', {
    title: 'Revaluation — Review & Validate',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
      { label: 'OCR Extraction', href: `/revaluation/extraction/${importId}` },
      { label: 'Review & Validate', active: true }
    ],
    mode: st.review ? 'locked' : 'edit',
    review: st.review,
    rows: st.rows,
    meta: st.meta,
    errors: {},
    enteredVals: {},
    notice: req.query.notice ? decodeURIComponent(req.query.notice) : null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null
  });
};

/** Shape stored evidence into what validateAndComputeRevised expects. */
function pseudoOcrEvidence(row) {
  const ev = row.evidence;
  if (!ev || (!ev.ocr_subject_code && ev.match_state === 'SELECTED_BUT_NOT_FOUND')) return null;
  return {
    match_state: ev.match_state,
    revised_internal_marks: ev.revised_int,
    revised_external_marks: ev.revised_ext,
    revised_marks: ev.revised_total,
    raw_status: ev.raw_letter
  };
}

/**
 * POST /revaluation/review/:importId — decision submission (TX-A).
 * The browser proposes decisions/corrections; identity, subject ownership,
 * ceilings and EVERY derived value are recomputed server-side. Foreign ids
 * abort the whole submission; nothing academic is ever written here.
 */
exports.submitReview = async (req, res) => {
  const importId = Number(req.params.importId);
  let st;
  try { st = await loadReviewState(importId, { requireExtracted: true }); }
  catch (err) {
    console.error('[revaluation] submitReview load error:', err);
    return res.redirect('/revaluation/upload?error=' + enc('Could not load revaluation record.'));
  }
  if (!st.ok) return res.redirect(st.redirect);
  if (st.approved) return res.redirect(`/revaluation/outcome/${importId}`);

  const body = req.body || {};
  const attempts = [];       // { sourceSrid, targetSrid, dup?, proposal }
  const fieldErrors = {};    // srid -> [messages]
  const enteredVals = {};

  for (const row of st.rows) {
    const srid = row.srid;
    const sr = st.srById.get(srid);

    enteredVals[srid] = {
      internal: body['internal_' + srid] !== undefined ? String(body['internal_' + srid]) : '',
      external: body['external_' + srid] !== undefined ? String(body['external_' + srid]) : '',
      ack: !!body['ack_' + srid],
      pick: row.evidence.ambiguous ? String(body['ambiguous_pick_' + srid] || '') : ''
    };

    if (!readDecisionField(body, srid)) {
      attempts.push({ sourceSrid: srid, targetSrid: srid,
        proposal: { subject_result_id: srid, decision: 'reject',
                    rejection_reason: 'ADMIN_REJECTED' } });
      continue;
    }

    let target = srid;
    if (row.evidence.ambiguous) {
      const pick = readPickField(body, srid);
      if (pick === -1 || (pick && !st.srById.has(pick))) {
        // Forged/garbage binding identifier — treat as tampering, hard stop.
        console.warn('[revaluation] submitReview rejected forged ambiguous pick on import', importId);
        return res.redirect(`/revaluation/extraction/${importId}?error=` +
          enc('Submitted subject binding is invalid. Decision saved nothing.'));
      }
      if (!pick) {
        fieldErrors[srid] = ['This document row is AMBIGUOUS — choose which selected subject it belongs to, or reject it.'];
        continue;
      }
      if (pick === srid) {
        fieldErrors[srid] = ['Pick a DIFFERENT selected subject for this ambiguous source row.'];
        continue;
      }
      target = pick;
    }

    const outcome = validateAndComputeRevised({
      decision: true,
      internalRaw: body['internal_' + srid],
      externalRaw: body['external_' + srid],
      ackRaw: body['ack_' + srid],
      sr: sr,
      subject: sr ? sr.Subject : null,
      ocrRow: pseudoOcrEvidence(row)
    });
    if (!outcome.ok || !outcome.proposal) {
      fieldErrors[srid] = outcome.errors.length ? outcome.errors : ['Decision could not be validated.'];
      continue;
    }
    outcome.proposal.bound_to_srid = target;
    attempts.push({ sourceSrid: srid, targetSrid: target, proposal: outcome.proposal });
  }

  // Duplicate effective-target guard across ALL accepted rows.
  const ownerOfTarget = new Map();
  for (const a of attempts) {
    if (a.proposal.decision !== 'accept') continue;
    if (ownerOfTarget.has(a.targetSrid)) {
      const firstSrid = ownerOfTarget.get(a.targetSrid);
      const msg = 'This subject is bound more than once in this submission.';
      (fieldErrors[a.sourceSrid] = fieldErrors[a.sourceSrid] || []).push(msg);
      (fieldErrors[firstSrid] = fieldErrors[firstSrid] || []).push(msg);
      a.dup = true;
    } else {
      ownerOfTarget.set(a.targetSrid, a.sourceSrid);
    }
  }
  const parsed = attempts.filter(a => !a.dup);
  const accepts = parsed.filter(a => a.proposal.decision === 'accept');

  function failRender(message) {
    return res.status(422).render('revaluation/review', {
      title: 'Revaluation — Review & Validate',
      breadcrumbItems: [
        { label: 'Result Management' },
        { label: 'Upload Revaluation', href: '/revaluation/upload' },
        { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
        { label: 'OCR Extraction', href: `/revaluation/extraction/${importId}` },
        { label: 'Review & Validate', active: true }
      ],
      mode: 'edit',
      review: null,
      rows: st.rows,
      meta: st.meta,
      errors: fieldErrors,
      enteredVals,
      notice: null,
      error: message
    });
  }

  if (Object.keys(fieldErrors).length > 0) {
    return failRender('Some decisions could not be validated — nothing was saved.');
  }
  if (accepts.length === 0) {
    return failRender('No subjects were accepted. Accept at least one subject or reject the revaluation from the extraction stage.');
  }

  // Per-TARGET baselines snapshot from CURRENT DB values + D6 display preview.
  const baselines = {};
  const previewMix = [];
  for (const a of accepts) {
    const tgtSr = st.srById.get(a.targetSrid);
    const subj = (tgtSr && tgtSr.Subject) ? tgtSr.Subject : null;
    baselines[a.targetSrid] = {
      marks: Number(tgtSr.marks),
      status: tgtSr.result_status
    };
    previewMix.push({
      credits: (subj && subj.credits) || 0,
      max_marks: subjectLimits(subj).maxTotal,
      effective_marks: a.proposal.proposed_revised_total_marks
    });
  }
  const aggregatePreview = computeOverlayAggregates(previewMix);

  // ---- TX-A: freeze decisions on the OcrExtraction record ONLY ----
  const t = await sequelize.transaction();
  try {
    const freshOcr = await OcrExtraction.findByPk(st.ocrRow.extraction_id,
      { transaction: t, lock: t.LOCK.UPDATE });
    if (!freshOcr) throw new Error('OcrExtraction record disappeared during submission.');
    const currentJson = safeJson(freshOcr.extracted_json);

    const nextJson = Object.assign({}, currentJson, {
      review: {
        version: 1,
        submitted_at: new Date().toISOString(),
        submitted_by: resolveAdminId(req),
        proposal: parsed.map(a => Object.assign({}, a.proposal)),
        baselines: baselines,
        aggregate_preview: aggregatePreview
      }
    });

    await freshOcr.update({
      validation_status: 'validated',
      extracted_json: nextJson
    }, { transaction: t });

    await t.commit();
    return res.redirect(`/revaluation/review/${importId}`);
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('[revaluation] submitReview tx error:', err);
    return res.redirect(`/revaluation/review/${importId}?error=` +
      enc('Could not save decisions: ' + (err.message || 'server error')));
  }
};

// ---------------- Approval & outcome ----------------
const { AdminUser, RevaluationResult } = require('../database/models');

/** Classified failures so TX-B can route friendly, retryable errors. */
class BadState extends Error {}
class StaleState extends Error {}
class AuthzError extends Error {}

/**
 * GET /revaluation/approve/:importId — confirmation interstitial.
 * Reachable ONLY from a validated, not-yet-approved review (S1).
 */
exports.showApproveConfirm = async (req, res) => {
  const importId = Number(req.params.importId);
  let st;
  try { st = await loadReviewState(importId, { requireExtracted: true }); }
  catch (err) {
    console.error('[revaluation] showApproveConfirm error:', err);
    return res.redirect('/revaluation/upload?error=' + enc('Could not load revaluation record.'));
  }
  if (!st.ok) return res.redirect(st.redirect);
  if (st.approved) return res.redirect(`/revaluation/outcome/${importId}`);
  if (!st.review) {
    return res.redirect(`/revaluation/review/${importId}?error=` +
      enc('Save the decisions first — nothing has been validated yet.'));
  }

  return res.render('revaluation/review', {
    title: 'Revaluation — Review & Validate',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
      { label: 'OCR Extraction', href: `/revaluation/extraction/${importId}` },
      { label: 'Review & Validate', active: true }
    ],
    mode: 'confirm',
    review: st.review,
    rows: st.rows,
    meta: st.meta,
    errors: {},
    enteredVals: {},
    notice: null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null
  });
};

/**
 * POST /revaluation/approve/:importId — THE critical transaction (TX-B).
 * Locks Result/SubjectResults + processing rows, re-validates against
 * CURRENT DB truth (stale-proposal guard via stored baselines), assigns
 * per-subject event numbers under lock, demotes any previous effective
 * event, inserts ONE approved+effective RevaluationResult per accepted
 * target subject, stamps approval audit, closes the import. Atomic.
 */
exports.approveReview = async (req, res) => {
  const importId = Number(req.params.importId);
  const t = await sequelize.transaction();
  try {
    const log = await ImportLog.findByPk(importId,
      { transaction: t, lock: t.LOCK.UPDATE, include: [{ model: OcrExtraction }] });
    if (!log || log.import_type !== 'REVALUATION') {
      throw new BadState('Import record is not a valid revaluation import.');
    }
    if (log.status === 'success') {
      await t.rollback();
      return res.redirect(`/revaluation/outcome/${importId}?notice=` +
        enc('This revaluation was already approved.'));
    }
    if (log.status !== 'extracted') {
      throw new BadState('Import is not in an approvable state (' + log.status + ').');
    }
    const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
    if (!ocrRow) throw new BadState('No OCR processing record is attached.');
    if (ocrRow.validation_status !== 'validated') {
      throw new StaleState('Save and validate the review decisions before approving.');
    }

    const saved = safeJson(ocrRow.extracted_json);
    const ocr = saved.ocr || {};
    if (ocr.extraction_status !== 'extracted') {
      throw new BadState('OCR extraction is not in a completed state.');
    }
    const review = saved.review;
    if (!review || !Array.isArray(review.proposal) || !review.baselines) {
      throw new StaleState('Stored review proposal missing — re-run the review.');
    }

    const accepts = review.proposal
      .filter(p => p && p.decision === 'accept')
      .map(p => ({
        src: Number(p.subject_result_id),
        tgt: Number(p.bound_to_srid || p.subject_result_id),
        p
      }))
      .sort((x, y) => x.tgt - y.tgt);
    if (accepts.length === 0) throw new StaleState('No accepted subjects remain in the proposal.');

    // Defense-in-depth duplicate-target guard at approval time.
    const seenTgt = new Set();
    for (const a of accepts) {
      if (seenTgt.has(a.tgt)) throw new BadState('Proposal binds one subject more than once.');
      seenTgt.add(a.tgt);
    }

    const result = await loadResultContextFull(saved.result_id, t, t.LOCK.UPDATE);
    if (!result) throw new BadState('The selected Result no longer exists.');
    if (Number(result.student_id) !== Number(saved.student_id) ||
        Number(result.session_id) !== Number(saved.session_id) ||
        (saved.attempt && Number(result.attempt_no) !== Number(saved.attempt.attempt_no)) ||
        (saved.attempt && result.exam_type !== saved.attempt.exam_type)) {
      throw new BadState('Result identity drifted from the validated review context.');
    }
    const srById = new Map((result.SubjectResults || []).map(sr => [Number(sr.subject_result_id), sr]));
    for (const a of accepts) {
      if (!srById.has(a.tgt)) throw new BadState('Accepted subject no longer belongs to this Result.');
    }

    const approverId = resolveAdminId(req);
    const approver = await AdminUser.findByPk(approverId, { transaction: t });
    if (!approver || approver.status !== 'active') {
      throw new AuthzError('Only an active administrator account can approve revaluations.');
    }

    const evMap = new Map((ocr.subjects || []).map(r => [Number(r.subject_result_id), r]));
    const doc = (Array.isArray(saved.documents) && saved.documents[0]) || {};
    const createdEvents = [];

    for (const a of accepts) {
      const sr = srById.get(a.tgt);
      const subj = (sr && sr.Subject) ? sr.Subject : null;
      const codeOf = (subj && subj.subject_code) || ('#' + a.tgt);

      // Stale-proposal guard: originals must still equal the review baseline.
      const bl = review.baselines[String(a.tgt)];
      if (!bl || Number(bl.marks) !== Number(sr.marks) || bl.status !== sr.result_status) {
        throw new StaleState('Original marks changed since validation for ' +
          codeOf + '. Re-run the review before approving.');
      }

      const evRaw = evMap.get(a.src) || null;
      const pseudoE = evRaw ? {
        match_state: evRaw.match_state,
        revised_internal_marks: evRaw.revised_internal_marks,
        revised_external_marks: evRaw.revised_external_marks,
        revised_marks: evRaw.revised_marks,
        raw_status: evRaw.raw_status
      } : null;

      // Identical authoritative math as at submission time.
      const rec = validateAndComputeRevised({
        decision: true,
        internalRaw: a.p.proposed_revised_internal_marks,
        externalRaw: a.p.proposed_revised_external_marks,
        ackRaw: 'on',
        sr, subject: subj, ocrRow: pseudoE
      });
      if (!rec.ok || !rec.proposal) {
        throw new BadState('Recomputed revision invalid for ' + codeOf + ': ' + rec.errors.join(' '));
      }
      if (Number(rec.proposal.proposed_revised_total_marks) !==
          Number(a.p.proposed_revised_total_marks)) {
        throw new BadState('Recomputed total mismatch for ' + codeOf + '.');
      }
      const P = rec.proposal;

      // Event number per target subject, computed inside this locked tx.
      const [[numRow]] = await sequelize.query(
        'SELECT COALESCE(MAX(revaluation_no),0)+1 AS next_no FROM revaluation_results WHERE subject_result_id = ?',
        { replacements: [a.tgt], transaction: t });
      const nextNo = Number(numRow.next_no);

      // Exactly-one-effective invariant: demote, then insert as effective.
      await RevaluationResult.update({ is_effective: false },
        { where: { subject_result_id: a.tgt, is_effective: true }, transaction: t });

      const createdEvent = await RevaluationResult.create({
        subject_result_id: a.tgt,
        original_marks: Number(sr.marks),
        revised_marks: P.proposed_revised_total_marks,
        original_status: sr.result_status,
        revised_status: P.proposed_revised_status,
        revised_grade: P.proposed_revised_grade,
        revaluation_no: nextNo,
        is_effective: true,
        revaluation_status: 'approved',
        reviewed_by: approver.admin_id,
        reviewed_at: new Date(),
        uploaded_by: Number(review.submitted_by) || approver.admin_id,
        file_name: doc.file_name || null,
        file_path: doc.file_path || null,
        remarks: buildEventRemarks(importId, ocr.extraction_method)
      }, { transaction: t });
      createdEvents.push(createdEvent.revaluation_id);
    }

    // Stamp approval audit onto persisted JSON; validation_status stays 'validated'.
    ocrRow.set('extracted_json', Object.assign({}, saved, {
      review: Object.assign({}, review, {
        approved_at: new Date().toISOString(),
        approved_by: approver.admin_id,
        event_ids: createdEvents
      })
    }));
    await ocrRow.save({ transaction: t });

    await log.update({ status: 'success' }, { transaction: t });
    await t.commit();

    return res.redirect(`/revaluation/outcome/${importId}`);
  } catch (err) {
    if (!t.finished) { try { await t.rollback(); } catch (_) { /* noop */ } }
    console.error('[revaluation] approveReview tx error:', err);
    const back = (err instanceof StaleState)
      ? `/revaluation/review/${importId}`
      : `/revaluation/extraction/${importId}`;
    return res.redirect(back + '?error=' + enc(err.message || 'Approval failed.'));
  }
};

/**
 * GET /revaluation/outcome/:importId — read-only effective-result view.
 * Original rows remain historical truth; each approved event overlays ONLY
 * its own subject. Aggregates are derived analytics (D6), never persisted.
 */
exports.showOutcome = async (req, res) => {
  const importId = Number(req.params.importId);
  let st;
  try { st = await loadReviewState(importId); }
  catch (err) {
    console.error('[revaluation] showOutcome error:', err);
    return res.redirect('/revaluation/upload?error=' + enc('Could not load revaluation record.'));
  }
  if (!st.ok) return res.redirect(st.redirect);

  const saved = st.saved;
  const review = saved.review || {};
  const eventIds = (review.event_ids || []).map(Number).filter(Number.isInteger);

  const events = eventIds.length ? await RevaluationResult.findAll({
    where: { revaluation_id: eventIds },
    include: [{ model: SubjectResult, include: [{ model: Subject }] }]
  }) : [];
  const effBySrid = new Map(events.map(e => [Number(e.subject_result_id), e]));

  // Historical Result-level numbers for the header card (read-only).
  const fullResult = await Result.findByPk(st.result.result_id, {
    attributes: ['result_id', 'sgpa', 'cgpa', 'result_status', 'failed_subject_count']
  });

  const overlayRows = st.rows.map(r => {
    const eff = effBySrid.get(r.srid) || null;
    const marks = eff ? Number(eff.revised_marks) : r.origMarks;
    const grade = eff ? (eff.revised_grade || r.origGrade) : r.origGrade;
    const pct = r.maxMarks > 0 ? Math.floor((marks / r.maxMarks) * 100) : 0;
    const g = gradeFromPercent(pct);
    return Object.assign({}, r, {
      effective: { marks, grade, status: g.status, derivedGrade: g.grade },
      changed: !!eff
    });
  });

  const aggregates = computeOverlayAggregates(overlayRows.map(r => ({
    credits: r.credits, max_marks: r.maxMarks, effective_marks: r.effective.marks
  })));

  return res.render('revaluation/outcome', {
    title: 'Revaluation — Outcome',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/upload' },
      { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
      { label: 'OCR Extraction', href: `/revaluation/extraction/${importId}` },
      { label: 'Review & Validate', href: `/revaluation/review/${importId}` },
      { label: 'Outcome', active: true }
    ],
    meta: st.meta,
    logStatus: st.log.status,
    reviewedAt: review.approved_at || review.submitted_at || null,
    reviewPresent: !!saved.review,
    events: events.map(e => ({
      id: e.revaluation_id, srid: e.subject_result_id, no: e.revaluation_no,
      originalMarks: e.original_marks, revisedMarks: e.revised_marks,
      originalStatus: e.original_status, revisedStatus: e.revised_status,
      revisedGrade: e.revised_grade, isEffective: e.is_effective,
      remarks: e.remarks
    })),
    rows: overlayRows,
    aggregates,
    origResult: fullResult || null,
    notice: req.query.notice ? decodeURIComponent(req.query.notice) : null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null
  });
};







