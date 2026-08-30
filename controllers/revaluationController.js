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
  ImportLog, OcrExtraction, RevaluationResult, sequelize
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
/** Step 1 — list Result Sessions that contain at least one Result. */
exports.showSessionPicker = async (req, res) => {
  let sessions = [];
  try {
    sessions = await ResultSession.findAll({
      attributes: ['session_id', 'semester', 'exam_session', 'exam_year'],
      include: [{ model: Result, attributes: ['result_id'] }],
      where: { '$Results.result_id$': { [Op.ne]: null } },
      order: [['exam_year', 'DESC'], ['exam_session', 'ASC']],
      distinct: true
    });
  } catch (err) {
    console.error('[revaluation] showSessionPicker error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load result sessions.'));
  }
  const list = sessions.filter(s => (s.Results && s.Results.length > 0)).map(s => ({
    sessionId: s.session_id,
    semester: s.semester,
    exam_session: s.exam_session,
    exam_year: s.exam_year,
    display: [s.semester, s.exam_session, s.exam_year].filter(Boolean).join(' | ')
  }));
  return res.render('revaluation/result-session-picker', {
    title: 'Revaluation — Step 1: Select Result Session',
    breadcrumbItems: [{ label: 'Result Management' }, { label: 'Upload Revaluation', href: '/revaluation/start', active: true }],
    sessions: list,
    error: req.query.error || null
  });
};

/**
 * Step 2 — students that have Results in the selected Result Session.
 * Restricted server-side to the session (inner join on Result.session_id).
 */
exports.showSessionStudents = async (req, res) => {
  const sessionId = Number(req.params.sessionId || req.query.session) || 0;
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.redirect('/revaluation/start?error=' + encodeURIComponent('Invalid result session.'));
  }
  const session = await ResultSession.findByPk(sessionId);
  if (!session) {
    return res.redirect('/revaluation/start?error=' + encodeURIComponent('Result session not found.'));
  }
  const q = (req.query.q || '').trim();
  const studentWhere = q
    ? { [Op.or]: [{ usn: { [Op.like]: `%${q}%` } }, { student_name: { [Op.like]: `%${q}%` } }] }
    : undefined;
  let students = [];
  try {
    students = await Student.findAll({
      attributes: ['student_id', 'usn', 'student_name'],
      where: studentWhere,
      include: [{ model: Result, attributes: ['result_id'], where: { session_id: sessionId }, required: true }],
      distinct: true,
      order: [['student_name', 'ASC']]
    });
  } catch (err) {
    console.error('[revaluation] showSessionStudents error:', err);
    return res.redirect('/revaluation/start?error=' + encodeURIComponent('Could not load students.'));
  }
  return res.render('revaluation/result-session-students', {
    title: 'Revaluation — Step 2: Select Student',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/start' },
      { label: 'Step 1: Session', href: '/revaluation/start' },
      { label: 'Select Student', active: true }
    ],
    session: { id: sessionId, display: [session.semester, session.exam_session, session.exam_year].filter(Boolean).join(' | ') },
    query: q,
    students: students.map(st => ({ student_id: st.student_id, usn: st.usn, student_name: st.student_name })),
    error: req.query.error || null
  });
};
/**
 * Step 3 — the selected student's Results/attempts for the selected session.
 * Restricted server-side to BOTH session_id AND student_id.
 */
exports.resolveShowAttempts = async (req, res) => {
  const sessionId = Number(req.params.sessionId || req.query.session) || 0;
  const studentId = Number(req.params.studentId || req.query.student) || 0;
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !Number.isInteger(studentId) || studentId <= 0) {
    return res.redirect('/revaluation/start?error=' + encodeURIComponent('Invalid selection.'));
  }
  const session = await ResultSession.findByPk(sessionId);
  const student = await Student.findByPk(studentId, { attributes: ['student_id', 'usn', 'student_name'] });
  if (!session || !student) {
    return res.redirect('/revaluation/start?error=' + encodeURIComponent('Unknown session or student.'));
  }
  const results = await Result.findAll({
    where: { session_id: sessionId, student_id: studentId },
    attributes: ['result_id', 'attempt_no', 'exam_type', 'result_status', 'sgpa', 'cgpa'],
    order: [['attempt_no', 'ASC']]
  });
  if (!results.length) {
    return res.redirect(`/revaluation/start/students?session=${sessionId}&error=` +
      encodeURIComponent('No Results/attempts found for this student in this session.'));
  }

  // PROMPT 19 — per-attempt revaluation submission state for the UI
  // (AVAILABLE / APPROVED / IN_PROGRESS / RETRY). Server-authoritative only.
  let revalStates = {};
  try {
    const st = await getRevaluationStatesForResults(results.map(r => r.result_id));
    if (st && st.ok) revalStates = st.states || {};
  } catch (err) {
    console.error('[revaluation] resolveShowAttempts state lookup error:', err);
    revalStates = {};
  }

  return res.render('revaluation/result-attempt-picker', {
    title: 'Revaluation — Step 3: Select Attempt',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/start' },
      { label: 'Select Student', href: `/revaluation/start/students?session=${sessionId}` },
      { label: 'Select Attempt', active: true }
    ],
    sessionId,
    studentId,
    sessionDisplay: [session.semester, session.exam_session, session.exam_year].filter(Boolean).join(' | '),
    studentName: student.student_name + ' (' + student.usn + ')',
    attempts: results.map(r => {
      const st = revalStates[r.result_id] || { state: 'AVAILABLE', importId: null };
      return {
        result_id: r.result_id,
        attempt_no: r.attempt_no,
        exam_type: r.exam_type,
        result_status: r.result_status,
        sgpa: r.sgpa,
        cgpa: r.cgpa,
        reval_state: st.state,
        reval_import_id: st.importId || null
      };
    }),
    error: req.query.error || null
  });
};

/**
 * Step 4 — POST selecting an attempt. Browser ids are hints only. The
 * authoritative Result is resolved server-side, the full chain is re-verified
 * (Result exists; session_id matches; student_id matches; attempt_no/exam_type
 * come from the DB row), the Prompt-12 open-submission guard runs, then the
 * server-authoritative draft (incl. the Result's full SubjectResult scope) is
 * stashed and the existing upload page is opened.
 */
exports.confirmAttemptSelection = async (req, res) => {
  const sessionId = Number(req.body.session || req.body.sessionId || 0);
  const studentId = Number(req.body.student || req.body.studentId || 0);
  const resultId = Number(req.body.result || req.body.resultId || 0);
  if (!Number.isInteger(sessionId) || sessionId <= 0 ||
      !Number.isInteger(studentId) || studentId <= 0 ||
      !Number.isInteger(resultId) || resultId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid selection.'));
  }

  let result;
  try { result = await loadResultContext(resultId); }
  catch (err) {
    console.error('[revaluation] confirmAttemptSelection load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load result.'));
  }
  if (!result) return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));

  // Server-authoritative chain verification (browser ids were hints only).
  if (Number(result.session_id) !== sessionId) {
    return res.redirect('/revaluation/upload?error=' +
      encodeURIComponent('Result does not belong to the selected Result Session. Please re-select.'));
  }
  if (Number(result.student_id) !== studentId) {
    return res.redirect('/revaluation/upload?error=' +
      encodeURIComponent('Result does not belong to the selected student. Please re-select.'));
  }

  // Prompt-12 open-submission guard — unchanged, must run before proceeding.
  let opr;
  try { opr = await findOpenRevaluationImportForResult(result.result_id); }
  catch (err) {
    console.error('[revaluation] confirmAttemptSelection open-guard error:', err);
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
  }
  if (!opr.ok) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
  }
  if (opr.importId) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('An active revaluation upload already exists for this Result/Attempt (Import #' +
        opr.importId + '). Complete or retry that submission before starting another.'));
  }

  // PROMPT 19 — Case A: an official revaluation submission was already
  // approved for this Student + ResultSession + Attempt. Block immediately.
  let appr;
  try { appr = await hasApprovedRevaluationForResult(result.result_id); }
  catch (err) { appr = { ok: false, approved: false }; }
  if (!appr.ok) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
  }
  if (appr.approved) {
    return res.redirect(`/revaluation/${result.result_id}?error=` +
      encodeURIComponent('A revaluation result has already been approved for this student for this examination session.'));
  }

  // Server-authoritative draft — scoped to the chosen Result.
  // The wizard's upload page re-resolves the FULL subject scope via
  // loadResultContext(resultId), so caching it in the draft is redundant.
  req.session.revaluationDraft = {
    resultId: Number(result.result_id),
    studentId: Number(result.student_id),
    sessionId: Number(result.session_id),
    attempt_no: Number(result.attempt_no),
    exam_type: result.exam_type,
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
  // Phase 13B: The draft tracks Result context; subjects are resolved server-side.
  const draft = req.session && req.session.revaluationDraft;

  if (!draft || Number(draft.resultId) !== resultId) {
    // Not an error about subject selection — the wizard flow provides scope.
    return res.redirect('/revaluation/start?error=' +
      encodeURIComponent('No revaluation in progress.'));
  }
  if (Date.now() - (draft.startedAt || 0) > REVAL_PENDING_SECONDS * 1000) {
    delete req.session.revaluationDraft;
    return res.redirect('/revaluation/start?error=' +
      encodeURIComponent('Your draft has expired. Please re-select the attempt.'));
  }

  const result = await loadResultContext(resultId);
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  // Phase 13B: subjects are the full scope of the selected Result, loaded
  // server-authoritatively. Never use browser-supplied IDs to change scope.
  const owned = result.SubjectResults || [];

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
      { label: 'Upload Revaluation', href: '/revaluation/start' },
      { label: 'Upload Document', active: true }
    ],
    resultId: result.result_id,
    sessionId: Number(result.session_id),
    studentId: Number(result.student_id),
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
    // Phase 13B: use server-authoritative loadResultContext to also load SubjectResults
    result = await loadResultContext(resultId);
  } catch (err) {
    console.error('[revaluation] processUpload lookup error:', err);
    return res.redirect(`/revaluation/${Number.isFinite(resultId) ? resultId : ''}/upload?error=` +
      encodeURIComponent('Could not load result.'));
  }
  if (!result) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Result not found.'));
  }

  // Phase 13B: subjects are the full scope of the selected Result, loaded
  // server-authoritatively. Browser-supplied subjectResultIds are never used
  // to define, expand, reduce, or replace the Result scope.
  const owned = result.SubjectResults || [];

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

  // Prompt (11/12) defense-in-depth: refuse the upload if an open submission
  // already exists for this Result/Attempt (identity from server-stored OCR
  // JSON only). Clean up the just-staged temp file before redirecting.
  let guardEarly;
  try {
    guardEarly = await findOpenRevaluationImportForResult(result.result_id);
  } catch (err) {
    console.error('[revaluation] processUpload open-guard error:', err);
    guardEarly = { ok: false, importId: null };
  }
  if (!guardEarly.ok) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
  }
  if (guardEarly.importId) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('An active revaluation upload already exists for this Result/Attempt (Import #' +
        guardEarly.importId + '). Complete or retry that submission before starting another.'));
  }

  // PROMPT 19 — Case A: an approved revaluation already exists for this
  // Student + ResultSession + Attempt. Reject the new submission BEFORE the
  // document is stored. Fail closed when the lookup itself errors.
  let apprEarly;
  try {
    apprEarly = await hasApprovedRevaluationForResult(result.result_id);
  } catch (err) {
    console.error('[revaluation] processUpload approved-guard error:', err);
    apprEarly = { ok: false, approved: false };
  }
  if (!apprEarly.ok) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
  }
  if (apprEarly.approved) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
      encodeURIComponent('A revaluation result has already been approved for this student for this examination session.'));
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
    // PROMPT 19 — race protection: lock the Result row (FOR UPDATE) so two
    // concurrent submissions for the same Round/Attempt serialize. The lock is
    // the SAME lock TX-B approval takes on the Result (loadResultContextFull
    // with t.LOCK.UPDATE), so an upload racing an approval either sees the
    // pending import (open-guard) or the already-approved event and aborts.
    const locked = await Result.findByPk(result.result_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      attributes: ['result_id']
    });
    if (!locked) {
      throw Object.assign(new Error('RESULT_MISSING'), { resultMissing: true, storedPath });
    }

    // Defense-in-depth (in-transaction): a concurrent open submission may have
    // landed in the brief window since the outer check — abort cleanly.
    const recheck = await findOpenRevaluationImportForResult(result.result_id, t);
    if (!recheck.ok) {
      throw Object.assign(new Error('OPEN_GUARD_UNAVAILABLE'), { openGuardUnavailable: true, storedPath });
    }
    if (recheck.importId) {
      throw Object.assign(new Error('OPEN_SUBMISSION_' + recheck.importId), { openImportId: recheck.importId, storedPath });
    }

    // PROMPT 19 — in-transaction Case A recheck under the Result row lock.
    const apprInTx = await hasApprovedRevaluationForResult(result.result_id, t);
    if (!apprInTx.ok) {
      throw Object.assign(new Error('APPROVED_GUARD_UNAVAILABLE'), { openGuardUnavailable: true, storedPath });
    }
    if (apprInTx.approved) {
      throw Object.assign(new Error('ALREADY_APPROVED'), { alreadyApproved: true, storedPath });
    }

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
    if (err && err.openImportId) {
      return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
        encodeURIComponent('An active revaluation upload already exists for this Result/Attempt (Import #' +
          err.openImportId + '). Complete or retry that submission before starting another.'));
    }
    if (err && err.alreadyApproved) {
      return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
        encodeURIComponent('A revaluation result has already been approved for this student for this examination session.'));
    }
    if (err && err.resultMissing) {
      return res.redirect('/revaluation/start?error=' + encodeURIComponent('The selected Result no longer exists.'));
    }
    if (err && err.openGuardUnavailable) {
      return res.redirect(`/revaluation/${result.result_id}/upload?error=` +
        encodeURIComponent('Could not verify existing revaluation submissions. Please try again.'));
    }
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
      { label: 'Upload Revaluation', href: '/revaluation/start' },
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
    sessionId: (saved && saved.session_id) || null,
    error: req.query.error || null
  });
};

// ============================================================
// PROMPT 4 — REVALUATION OCR EXTRACTION STAGE
// OCR output is CANDIDATE data only. The selected Result remains
// the authoritative identity; academic tables are never written.
// ============================================================
const revaluationExtractor = require('../services/revaluationExtractor');

/**
 * POST /pending/:importId/extract — trigger (or retry) OCR extraction.
 * Always redirects to GET /extraction/:importId.
 */
exports.runExtraction = async (req, res) => {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId) || importId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid revaluation record.'));
  }

  let log;
  try {
    log = await ImportLog.findByPk(importId, { include: [{ model: OcrExtraction }] });
  } catch (err) {
    console.error('[revaluation] runExtraction load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log || log.import_type !== 'REVALUATION') {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }
  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  if (!ocrRow) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('No OCR processing record is attached to this import.'));
  }
  const saved = safeJson(ocrRow.extracted_json);
  if (!stored_guardHasContext(saved)) {
    return res.redirect(`/revaluation/pending/${importId}?error=` +
      encodeURIComponent('Stored extraction context is incomplete.'));
  }

  let result;
  try { result = await loadResultContextFull(saved.result_id); }
  catch (err) {
    console.error('[revaluation] runExtraction context error:', err);
    result = null;
  }
  if (!result) {
    return res.redirect(`/revaluation/pending/${importId}?error=` +
      encodeURIComponent('The selected Result no longer exists.'));
  }

  const serverCtx = {
    studentUsn: result.Student ? result.Student.usn : '',
    studentName: result.Student ? result.Student.student_name : '',
    selectedSubjects: (saved.subjects || []).map(s => ({
      subject_result_id: s.subject_result_id,
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      original_marks: s.original_marks
    }))
  };

  const savedDoc = ((saved.documents || [])[0] || {});
  const filePath = savedDoc.path || savedDoc.file_path || null;
  if (!filePath) {
    return res.redirect(`/revaluation/pending/${importId}?error=` +
      encodeURIComponent('No uploaded document path found. Please re-upload the marks card.'));
  }

  let extractionResult;
  try {
    extractionResult = await revaluationExtractor.extractAndBuild(filePath, serverCtx);
  } catch (err) {
    console.error('[revaluation] runExtraction engine error:', err);
    extractionResult = {
      ok: false,
      reason: 'EXTRACTION_ERROR',
      ocr: {
        extraction_status: 'failed',
        failed_reason: 'EXTRACTION_ERROR',
        error: err.message || 'OCR extraction failed.',
        warnings: []
      }
    };
  }

  const nextJson = Object.assign({}, saved, {
    ocr: extractionResult.ocr,
    student: { name: result.Student ? result.Student.student_name : '', usn: result.Student ? result.Student.usn : '' }
  });
  delete nextJson.review;

  const t = await sequelize.transaction();
  try {
    await ocrRow.update({ extracted_json: nextJson, validation_status: 'pending' }, { transaction: t });
    await log.update({ status: 'extracted' }, { transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    console.error('[revaluation] runExtraction DB error:', err);
    return res.redirect(`/revaluation/pending/${importId}?error=` +
      encodeURIComponent('Failed to save extraction result. Please try again.'));
  }

  return res.redirect('/revaluation/extraction/' + importId);
};

/**
 * Normalise a string for safe comparison:
 * lowercase, trim whitespace, collapse repeated spaces.
 */
function normText(v) {
  if (!v || typeof v !== 'string') return '';
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * PROMPT (Revaluation Identity Check) — compare OCR-extracted
 * student identity with the authoritative selected student.
 *
 * @param {object} ocrCandidates  — ocr.student_candidates { name, usn }
 * @param {object} serverStudent   — { student_name, usn }
 * @returns {{severity:string, nameMatch:boolean, usnMatch:boolean,
 *            bothMissing:boolean, requiresConfirmation:boolean, message:string}}
 *
 * severity values:
 *   'match'       — both name and USN match (or both missing)
 *   'warning'     — one matches, one differs/missing (warning, allow continue)
 *   'mismatch'    — both differ or both missing (requires explicit confirmation)
 */
function checkOcrIdentity(ocrCandidates, serverStudent) {
  const serverName = serverStudent && (serverStudent.student_name || serverStudent.name) || '';
  const serverUsn  = serverStudent && (serverStudent.usn || '') || '';
  const ocrName    = ocrCandidates && ocrCandidates.name || '';
  const ocrUsn     = ocrCandidates && ocrCandidates.usn  || '';

  const serverNameOk = !!serverName;
  const serverUsnOk  = !!serverUsn;
  const ocrNameOk    = !!ocrName;
  const ocrUsnOk     = !!ocrUsn;

  const bothMissing = !ocrNameOk && !ocrUsnOk && !serverNameOk && !serverUsnOk;

  const nameMatch = serverNameOk && ocrNameOk && normText(serverName) === normText(ocrName);
  const usnMatch  = serverUsnOk  && ocrUsnOk  && normText(serverUsn)  === normText(ocrUsn);

  const bothMatch    = nameMatch && usnMatch;
  const bothMismatch = !nameMatch && !usnMatch;

  let severity = 'match';
  let requiresConfirmation = false;
  let message = 'Student identity on the marks card matches the selected student.';

  if (bothMatch) {
    severity = 'match';
    message = 'Student identity on the marks card matches the selected student.';
  } else if (bothMissing) {
    severity = 'mismatch';
    requiresConfirmation = true;
    message = 'Both student name and USN could not be extracted from the marks card. Please confirm this marks card belongs to the selected student.';
  } else if (bothMismatch) {
    severity = 'mismatch';
    requiresConfirmation = true;
    message = 'Both student name and USN on the marks card differ from the selected student. Please confirm this marks card belongs to the selected student.';
  } else if (nameMatch && !usnMatch) {
    severity = 'warning';
    message = 'Student name matches but USN differs (' + (ocrUsnOk ? '"' + ocrUsn + '"' : 'not extracted') + ' vs "' + serverUsn + '"). You may continue.';
  } else if (!nameMatch && usnMatch) {
    severity = 'warning';
    message = 'USN matches but student name differs ("' + (ocrNameOk ? ocrName : '(not extracted)') + '" vs "' + serverName + '"). You may continue.';
  } else {
    severity = 'warning';
    message = 'Student identity may differ from the selected student. Review carefully before proceeding.';
  }

  return { severity, nameMatch, usnMatch, bothMissing, requiresConfirmation, message };
}

/**
 * GET /extraction/:importId — render the OCR extraction review page.
 * Reads the stored candidates (no new OCR pass here), derives the
 * server-authoritative student identity, runs the identity check, and
 * passes everything needed by views/revaluation/extraction.ejs.
 */
exports.showExtraction = async (req, res) => {
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
    console.error('[revaluation] showExtraction load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log || log.import_type !== 'REVALUATION') {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }

  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  if (!ocrRow) {
    return res.redirect(`/revaluation/pending/${importId}?error=` + encodeURIComponent('No OCR processing record is attached.'));
  }

  const saved = safeJson(ocrRow.extracted_json);
  if (!stored_guardHasContext(saved)) {
    return res.redirect(`/revaluation/pending/${importId}?error=` + encodeURIComponent('Stored extraction context is incomplete.'));
  }

  const ocr = saved.ocr || {};
  const ocrCandidates = ocr.student_candidates || {};

  let serverStudent = null;
  let sessionId = (saved && saved.session_id) || null;
  let sessionDisplayVal = sessionDisplay(log.ResultSession);

  if (saved && saved.result_id) {
    try {
      const full = await loadResultContext(saved.result_id);
      if (full && full.Student) {
        serverStudent = { student_name: full.Student.student_name, usn: full.Student.usn };
        if (!sessionId) sessionId = full.session_id;
        if (!sessionDisplayVal) sessionDisplayVal = sessionDisplay(full.ResultSession);
      }
    } catch (_) {}
  }

  const identityCheck = checkOcrIdentity(ocrCandidates, serverStudent || {});
  const identityConfirmed = !!(saved && saved.identity_confirmed === true);
  const identityBlocking = identityCheck.requiresConfirmation && !identityConfirmed;

  const serverName = serverStudent ? (serverStudent.student_name || '') : '';
  const serverUsn  = serverStudent ? (serverStudent.usn || '') : '';
  const ocrName    = ocrCandidates.name || '';
  const ocrUsn     = ocrCandidates.usn || '';
  const usnMatch   = serverUsn  && ocrUsn  && normText(serverUsn)  === normText(ocrUsn);
  const nameMatch  = serverName && ocrName && normText(serverName) === normText(ocrName);

  const savedDocs = (saved && saved.documents) || [];
  const doc0 = savedDocs[0] || {};
  const docName = log.file_name || doc0.original_name || doc0.name || '';
  const docLink = doc0.url || doc0.path || null;

  return res.render('revaluation/extraction', {
    title: 'Revaluation — OCR Extraction',
    breadcrumbItems: [
      { label: 'Result Management' },
      { label: 'Upload Revaluation', href: '/revaluation/start' },
      { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
      { label: 'OCR Extraction', active: true }
    ],
    importId: log.import_id,
    logStatus: log.status,
    resultId: saved.result_id || null,
    serverStudent: serverStudent || {},
    sessionDisplay: sessionDisplayVal,
    attempt: (saved && saved.attempt) || {},
    identityCheck: identityCheck,
    identityConfirmed: identityConfirmed,
    identityBlocking: identityBlocking,
    ocrStudent: {
      usn: ocrCandidates.usn || null,
      name: ocrCandidates.name || null,
      usn_matches_server: usnMatch,
      name_matches_server: nameMatch
    },
    semesterCandidate: (ocr.semester_candidate !== undefined && ocr.semester_candidate !== null) ? ocr.semester_candidate : null,
    extractionMethod: ocr.extraction_method || null,
    confidenceScore: ocr.confidence_score || null,
    extractedAt: ocr.extracted_at || null,
    subjects: (ocr.subjects && Array.isArray(ocr.subjects)) ? ocr.subjects : [],
    unmatched: (ocr.unmatched_ocr_details && Array.isArray(ocr.unmatched_ocr_details))
      ? ocr.unmatched_ocr_details
      : (ocr.unmatched_ocr_codes || []).map(c => ({ ocr_subject_code: c })),
    warnings: (ocr.warnings && Array.isArray(ocr.warnings)) ? ocr.warnings : [],
    docName: docName,
    docLink: docLink,
    rawText: ocr.raw_text || '',
    extractionStatus: ocr.extraction_status || log.status || 'pending',
    failedReason: ocr.failed_reason || null,
    errorMsg: ocr.error || null,
    sessionId: sessionId,
    error: req.query.error ? decodeURIComponent(req.query.error) : null
  });
};

/** Shared loader for the extraction stage (ImportLog + session + extractions). */
async function loadRevalImport(importId) {
  return ImportLog.findByPk(importId, {
    include: [
      { model: ResultSession, attributes: ['semester', 'exam_session', 'exam_year'] },
      { model: OcrExtraction }
    ]
  });
}

/**
 * Open-submission guard (Prompt 11/12).
 * A Result/Attempt may have AT MOST ONE open (pending|extracted) REVALUATION
 * submission at a time. The Result identity is resolved ONLY from the
 * server-stored ocr_extractions.extracted_json.result_id — never from request
 * data. Failed / success / unrelated imports never block a future round.
 *
 * @param {number} resultId server-authoritative Result id
 * @param {object} [t] optional Sequelize transaction (used inside upload guard)
 * @returns {Promise<{ok:boolean, importId:number|null}>} ok=false only when the
 *   lookup itself failed (callers should fail closed). importId is the earliest
 *   open REVALUATION import bound to the Result/Attempt, or null.
 */
async function findOpenRevaluationImportForResult(resultId, t) {
  const rn = Number(resultId);
  if (!Number.isInteger(rn) || rn <= 0) return { ok: true, importId: null };
  const { QueryTypes } = require('sequelize');
  let rows;
  try {
    rows = await sequelize.query(
      `SELECT i.import_id AS import_id, x.extracted_json AS extracted_json
         FROM import_logs i
         JOIN ocr_extractions x ON x.import_id = i.import_id
        WHERE i.import_type = 'REVALUATION'
          AND i.status IN ('pending','extracted')
        ORDER BY i.import_id ASC`,
      { type: QueryTypes.SELECT, transaction: t || undefined }
    );
  } catch (err) {
    console.error('[revaluation] findOpenRevaluationImportForResult query error:', err);
    return { ok: false, importId: null };
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    let j = row && row.extracted_json;
    if (j === null || j === undefined) continue;
    try {
      if (typeof j !== 'string') {
        j = JSON.stringify(j);
      }
      const parsed = JSON.parse(j);
      if (Number(parsed && parsed.result_id) === rn) {
        return { ok: true, importId: Number(row.import_id) };
      }
    } catch (_) {
      /* not attributable, not a conflict */
    }
  }
  return { ok: true, importId: null };
}

/**
 * PROMPT 19 — check if any revaluation for the given Result has already been
 * approved (revaluation_status='approved'). Scans via SubjectResult → RevaluationResult
 * because RevaluationResult links to subject_result_id, not result_id directly.
 *
 * @param {number} resultId
 * @param {object} [t] optional transaction
 * @returns {Promise<{ok:boolean, approved:boolean}>}
 */
async function hasApprovedRevaluationForResult(resultId, t) {
  const rn = Number(resultId);
  if (!Number.isInteger(rn) || rn <= 0) return { ok: true, approved: false };
  try {
    const count = await RevaluationResult.count({
      include: [{
        model: SubjectResult,
        as: 'SubjectResult',
        where: { result_id: rn },
        required: true
      }],
      where: { revaluation_status: 'approved' },
      transaction: t || undefined
    });
    return { ok: true, approved: count > 0 };
  } catch (err) {
    console.error('[revaluation] hasApprovedRevaluationForResult error:', err);
    return { ok: false, approved: false };
  }
}

/**
 * PROMPT 19 — derive the per-Result revaluation submission state for the
 * attempt picker. Server-authoritative ONLY; never trust the browser.
 *
 *   APPROVED     — a RevaluationResult joined to one of the Result's
 *                  SubjectResults is revaluation_status='approved'.
 *   IN_PROGRESS  — an ImportLog (import_type='REVALUATION') in
 *                  status IN ('pending','extracted') references this result_id
 *                  via its OcrExtraction.extracted_json (latest wins).
 *   RETRY        — the latest import for this Result has status='failed'.
 *   AVAILABLE    — otherwise.
 *
 * Returns { ok: true, states: { [result_id]: { state, importId } } }.
 * On lookup failure returns { ok: false, states: {} } (caller treats as
 * fail-soft "no state" but logs the error).
 */
async function getRevaluationStatesForResults(resultIds) {
  const ids = (Array.isArray(resultIds) ? resultIds : [resultIds])
    .map(Number)
    .filter(Number.isInteger)
    .filter(n => n > 0);
  if (!ids.length) return { ok: true, states: {} };
  const states = {};
  for (const id of ids) states[id] = { state: 'AVAILABLE', importId: null };

  try {
    // 1) APPROVED check — any approved RevaluationResult for any SR of this Result?
    const approvedRows = await RevaluationResult.findAll({
      attributes: ['revaluation_id', 'subject_result_id'],
      include: [{
        model: SubjectResult,
        as: 'SubjectResult',
        attributes: ['subject_result_id', 'result_id'],
        where: { result_id: ids },
        required: true
      }],
      where: { revaluation_status: 'approved' }
    });
    const approvedByResult = new Set();
    for (const r of approvedRows) {
      const rid = r.SubjectResult && Number(r.SubjectResult.result_id);
      if (rid) approvedByResult.add(rid);
    }
    for (const rid of approvedByResult) {
      states[rid] = { state: 'APPROVED', importId: null };
    }
  } catch (err) {
    console.error('[revaluation] getRevaluationStatesForResults approved-lookup error:', err);
    return { ok: false, states };
  }

  // For non-APPROVED results, look up the latest REVALUATION import.
  const remaining = ids.filter(id => states[id].state !== 'APPROVED');
  if (!remaining.length) return { ok: true, states };

  try {
    // Pull every REVALUATION import joined to its OcrExtraction once,
    // then attribute by parsing extracted_json.result_id. Latest import
    // (highest import_id) per Result wins.
    const { QueryTypes } = require('sequelize');
    const placeholders = remaining.map(() => '?').join(',');
    const rows = await sequelize.query(
      `SELECT i.import_id AS import_id, i.status AS status, x.extracted_json AS extracted_json
         FROM import_logs i
         JOIN ocr_extractions x ON x.import_id = i.import_id
        WHERE i.import_type = 'REVALUATION'
          AND i.import_id IN (
            SELECT MAX(i2.import_id)
              FROM import_logs i2
              JOIN ocr_extractions x2 ON x2.import_id = i2.import_id
             WHERE i2.import_type = 'REVALUATION'
               AND x2.extracted_json IS NOT NULL
               AND JSON_EXTRACT(x2.extracted_json, '$.result_id') IN (${placeholders})
             GROUP BY JSON_EXTRACT(x2.extracted_json, '$.result_id')
          )
        ORDER BY i.import_id DESC`,
      { type: QueryTypes.SELECT, replacements: remaining }
    );

    const latest = new Map();
    for (const row of rows) {
      let saved = row && row.extracted_json;
      if (saved === null || saved === undefined) continue;
      let parsed = null;
      try {
        parsed = (typeof saved === 'string') ? JSON.parse(saved) : saved;
      } catch (_) { continue; }
      const rid = Number(parsed && parsed.result_id);
      if (!rid || !remaining.includes(rid)) continue;
      if (!latest.has(rid)) latest.set(rid, row);
    }

    for (const [rid, row] of latest.entries()) {
      const status = String(row.status || '').toLowerCase();
      const importId = Number(row.import_id);
      if (status === 'pending' || status === 'extracted') {
        states[rid] = { state: 'IN_PROGRESS', importId: importId };
      } else if (status === 'failed') {
        states[rid] = { state: 'RETRY', importId: importId };
      } else {
        // success / other — leave AVAILABLE (or APPROVED if we already set it)
        if (states[rid].state !== 'APPROVED') {
          states[rid] = { state: 'AVAILABLE', importId: importId };
        }
      }
    }
  } catch (err) {
    console.error('[revaluation] getRevaluationStatesForResults import-lookup error:', err);
    return { ok: false, states };
  }

  return { ok: true, states };
}

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
 * POST /revaluation/pending/:importId/confirm-identity
 * Admin explicitly confirms a both-mismatch/both-missing identity situation.
 * Stores the flag on the OcrExtraction row so submitReview can verify it
 * server-side. Applies only to the CURRENT extraction for this import.
 */
exports.confirmIdentity = async (req, res) => {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId) || importId <= 0) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Invalid revaluation record.'));
  }
  let log;
  try { log = await loadRevalImport(importId); }
  catch (err) {
    console.error('[revaluation] confirmIdentity load error:', err);
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Could not load revaluation record.'));
  }
  if (!log || log.import_type !== 'REVALUATION') {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('Revaluation record not found.'));
  }
  const ocrRow = log.OcrExtractions && log.OcrExtractions[0];
  if (!ocrRow) {
    return res.redirect('/revaluation/upload?error=' + encodeURIComponent('No OCR record found.'));
  }
  const saved = safeJson(ocrRow.extracted_json);
  const ocr = (saved && saved.ocr) || {};
  const ocrCandidates = ocr.student_candidates || {};
  let serverStudent = null;
  let sessionId = (saved && saved.session_id) || null;
  if (saved && saved.result_id) {
    try {
      const full = await loadResultContext(saved.result_id);
      if (full && full.Student) {
        serverStudent = { student_name: full.Student.student_name, usn: full.Student.usn };
        if (!sessionId) sessionId = full.session_id;
      }
    } catch (_) {}
  }
  const identityCheck = checkOcrIdentity(ocrCandidates, serverStudent || {});
  if (!identityCheck.requiresConfirmation) {
    return res.redirect('/revaluation/extraction/' + importId);
  }
  const t = await sequelize.transaction();
  try {
    const lockedOcr = await OcrExtraction.findOne(
      { where: { import_id: importId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!lockedOcr) throw new Error('OcrExtraction row not found.');
    const liveSaved = safeJson(lockedOcr.extracted_json);
    liveSaved.identity_confirmed = true;
    await lockedOcr.update({ extracted_json: liveSaved }, { transaction: t });
    await t.commit();
    return res.redirect('/revaluation/extraction/' + importId);
  } catch (err) {
    await t.rollback();
    console.error('[revaluation] confirmIdentity error:', err);
    return res.redirect('/revaluation/extraction/' + importId + '?error=' +
      encodeURIComponent('Could not save confirmation.'));
  }
};

/**
 * Guard: does the stored extracted_json contain a complete, runnable
 * server-side context (result_id / student_id / session_id / attempt
 * block / subjects array)? Used by every revaluation handler that
 * re-derives from the stored row before touching the DB.
 */
function stored_guardHasContext(saved) {
  if (!saved || typeof saved !== 'object') return false;
  if (!Number.isInteger(Number(saved.result_id)) || Number(saved.result_id) <= 0) return false;
  if (!Number.isInteger(Number(saved.student_id)) || Number(saved.student_id) <= 0) return false;
  if (!Number.isInteger(Number(saved.session_id)) || Number(saved.session_id) <= 0) return false;
  if (!saved.attempt || typeof saved.attempt !== 'object') return false;
  if (!Array.isArray(saved.subjects)) return false;
  return true;
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

  // Frozen-proposal lookup. PROMPT 14: when the admin re-opens the form to
  // edit a previously-validated import, the inputs must pre-fill with the
  // admin's LAST CONFIRMED marks (not the raw OCR marks). Identity-keyed by
  // bound_to_srid (target) so AMBIGUOUS rebinds round-trip correctly.
  const priorReview = saved.review || null;
  const priorPropByTgt = new Map();
  if (priorReview && Array.isArray(priorReview.proposal)) {
    for (const p of priorReview.proposal) {
      const key = String(p.bound_to_srid != null ? p.bound_to_srid : p.subject_result_id);
      priorPropByTgt.set(key, p);
    }
  }

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
    // PROMPT 14: server-side preference for the pre-fill mark values.
    // 1. The admin's prior frozen-proposal marks (subject of this edit).
    // 2. OCR-derived marks when the row was MATCHED and no prior edit exists.
    // 3. null (no fallback invented by us).
    const prior = priorPropByTgt.get(String(srid));
    const priorInt = prior && prior.proposed_revised_internal_marks != null
      ? Number(prior.proposed_revised_internal_marks) : null;
    const priorExt = prior && prior.proposed_revised_external_marks != null
      ? Number(prior.proposed_revised_external_marks) : null;
    const ocrInt = ev ? ev.revised_internal_marks : null;
    const ocrExt = ev ? ev.revised_external_marks : null;
    const revInt = (priorInt != null) ? priorInt : ((ocrInt !== null && ocrInt !== undefined) ? Number(ocrInt) : null);
    const revExt = (priorExt != null) ? priorExt : ((ocrExt !== null && ocrExt !== undefined) ? Number(ocrExt) : null);
    const revTotal = (revInt !== null && revExt !== null) ? (revInt + revExt) : null;
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
        // PROMPT 14: revised_int/ext/total now follow the edit-time preference
        // (prior proposal > OCR); OCR evidence is preserved in OCR-only fields.
        revised_int: revInt,
        revised_ext: revExt,
        revised_total: revTotal,
        status_candidate: ev ? ev.revised_status_candidate : null,
        raw_letter: ev ? ev.raw_status : null,
        confidence: ev ? ev.confidence : null,
        raw_line: ev ? ev.raw_line : null,
        ambiguous
      },
      // Edit-time defaults derived from a prior frozen proposal (used by the
      // template for radio defaults and pre-fill of the number inputs).
      priorDecision: prior ? (prior.decision || 'accept') : null,
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
    meta: Object.assign({}, st.meta, { sessionId: (st.saved && st.saved.session_id) || null }),
    errors: {},
    enteredVals: {},
    notice: req.query.notice ? decodeURIComponent(req.query.notice) : null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null
  });
};

/**
 * Parse all unmatched_attach_<index> fields from the request body and return
 * a list of validated attachment descriptors. Throws on any forged target.
 */
function collectUnmatchedAttachments(body, unmatched, srById) {
  const items = [];
  for (let i = 0; i < unmatched.length; i++) {
    const rawTarget = body['unmatched_attach_' + i];
    if (rawTarget === undefined || rawTarget === '' || rawTarget === null) continue;
    const target = Number(rawTarget);
    if (!Number.isInteger(target) || target <= 0 || !srById.has(target)) {
      // Forged/garbage binding identifier — reject entire submission.
      throw Object.assign(new Error('FORGED_ATTACHMENT_TARGET'), { code: 'FORGED_ATTACHMENT_TARGET' });
    }
    const u = unmatched[i];
    items.push({
      unmatched_index: i,
      target_subject_result_id: target,
      ocr_subject_code: u.ocr_subject_code || null,
      ocr_raw_text: (u.raw_line || u.raw_text || ''),
      proposed_revised_internal_marks: body['attach_internal_' + i],
      proposed_revised_external_marks: body['attach_external_' + i]
    });
  }
  return items;
}

/**
 * Validate marks for an attached unmatched OCR row and build a frozen proposal
 * entry. The entry has source='UNMATCHED_OCR' so approveReview can treat it
 * like any other proposal when creating RevaluationResult events.
 */
function validateAndComputeAttachedUnmatched(att, targetRow) {
  const errors = [];
  const warnings = [];
  if (!targetRow) {
    errors.push('Attached target SubjectResult no longer exists.');
    return { ok: false, errors, warnings, entry: null };
  }
  // targetRow comes from srById and is the full SubjectResult row (with Subject
  // association). Pass it through to validateAndComputeRevised so that mark
  // limits and original-marks comparison are honoured.
  const out = validateAndComputeRevised({
    decision: 'accept',
    internalRaw: att.proposed_revised_internal_marks,
    externalRaw: att.proposed_revised_external_marks,
    sr: targetRow,
    subject: targetRow.Subject || null,
    ocrRow: null  // unmatched rows have no OCR evidence
  });
  if (!out.ok || !out.proposal) {
    return { ok: false, errors: out.errors, warnings: out.warnings, entry: null };
  }
  const p = out.proposal;
  // Override the result srid with the TARGET (the user picked this to bind to).
  const srid = Number(targetRow.subject_result_id);
  const entry = Object.assign({}, p, {
    subject_result_id: srid,
    source: 'UNMATCHED_OCR',
    bound_to_srid: srid,
    decision: 'accept',
    ocr_subject_code: att.ocr_subject_code,
    unmatched_index: att.unmatched_index
  });
  return { ok: true, errors, warnings, entry };
}

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

  // ---- Identity gate: both-mismatch/both-missing requires explicit confirmation ----
  // Authority: server-side student from the Result row (not browser-supplied values).
  // identity_confirmed is set only by confirmIdentity (admin POST on /confirm-identity).
  if (st.saved && st.saved.ocr) {
    const ocrCandidates = st.saved.ocr.student_candidates || {};
    const resultStudent = (st.result && st.result.Student)
      ? { student_name: st.result.Student.student_name, usn: st.result.Student.usn }
      : {};
    const idCheck = checkOcrIdentity(ocrCandidates, resultStudent);
    if (idCheck.requiresConfirmation && !(st.saved.identity_confirmed === true)) {
      return res.redirect('/revaluation/extraction/' + importId + '?error=' +
        enc('Student identity on the marks card does not match the selected student. Please confirm the mismatch on the extraction page before proceeding.'));
    }
  }

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
  // (deferred; merged with unmatched-OCR below)
  // ---- PROMPT 15: unmatched OCR attachments (bind raw OCR row to existing SR) ----
  // Server-authoritative: target must belong to the active Result.
  // The whole submission is rejected (no partial save) on any forged target.
  let unmatchedAttempts = [];
  try {
    const attachments = collectUnmatchedAttachments(body, st.saved.ocr.unmatched_ocr_details || [], st.srById);
    for (const att of attachments) {
      const targetRow = st.srById.get(att.target_subject_result_id);
      const r = validateAndComputeAttachedUnmatched(att, targetRow);
      if (!r.ok) {
        // Reject whole submission; preserve current 'edit' state.
        return res.redirect(`/revaluation/review/${importId}?error=` +
          enc('Unmatched attachment rejected: ' + r.errors.join(' ')));
      }
      unmatchedAttempts.push({ sourceSrid: null, targetSrid: att.target_subject_result_id,
        unmatchedIndex: att.unmatched_index, proposal: r.entry });
    }
  } catch (err) {
    if (err && err.code === 'FORGED_ATTACHMENT_TARGET') {
      console.warn('[revaluation] submitReview rejected forged unmatched attachment on import', importId);
      return res.redirect(`/revaluation/extraction/${importId}?error=` +
        enc('Unmatched attachment target is invalid. Decision saved nothing.'));
    }
    throw err;
  }

  // Duplicate effective-target guard across ALL accepted rows (regular +
  // unmatched-OCR attachments). The first wins; later duplicates are flagged.
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
  for (const a of unmatchedAttempts) {
    if (ownerOfTarget.has(a.targetSrid)) {
      const firstSrid = ownerOfTarget.get(a.targetSrid);
      const msg = 'Unmatched attachment target duplicates an existing subject decision.';
      (fieldErrors[firstSrid] = fieldErrors[firstSrid] || []).push(msg);
      a.dup = true;
    } else {
      ownerOfTarget.set(a.targetSrid, '__unmatched_' + a.unmatchedIndex);
    }
  }
  // Re-filter after the second pass (unmatched may have been marked dup).
  const parsed = attempts.filter(a => !a.dup);
  // PROMPT 15: merge regular subject decisions with unmatched-OCR attachments.
  const accepts = parsed.filter(a => a.proposal.decision === 'accept')
    .concat(unmatchedAttempts.filter(a => !a.dup));

  function failRender(message) {
    return res.status(422).render('revaluation/review', {
      title: 'Revaluation — Review & Validate',
      breadcrumbItems: [
        { label: 'Result Management' },
        { label: 'Upload Revaluation', href: '/revaluation/start' },
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
        proposal: parsed.map(a => Object.assign({}, a.proposal))
          .concat(unmatchedAttempts.filter(a => !a.dup).map(a => Object.assign({}, a.proposal))),
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
const { AdminUser } = require('../database/models');

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
      { label: 'Upload Revaluation', href: '/revaluation/start' },
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

    // PROMPT 18 — Concurrency hardening.
    //
    // Acquire a row-level write lock on every target SubjectResult BEFORE the
    // demote+insert critical section. This serializes concurrent approvals
    // that share one or more targets so that the second approver waits until
    // the first transaction commits, then re-reads the updated state and
    // observes the demoted previous effective row.
    //
    // Accepts is already sorted by ascending target id (see line ~1909), so
    // every TX-B iteration locks the same deterministic order. That is the
    // standard fix for multi-target deadlocks.
    //
    // SubjectResult is already imported at the top of this module.
    const sortedTargets = accepts.map(a => a.tgt).sort((x, y) => x - y);
    const lockedSRs = await SubjectResult.findAll({
      where: { subject_result_id: sortedTargets },
      transaction: t,
      lock: t.LOCK.UPDATE,
      attributes: ['subject_result_id', 'result_id', 'subject_id', 'marks', 'grade', 'result_status']
    });
    const lockedByTgt = new Map(lockedSRs.map(sr => [Number(sr.subject_result_id), sr]));
    // Any target missing from the locked set either belongs to a different
    // Result (ownership drift) or was deleted. Reject.
    for (const tgt of sortedTargets) {
      if (!lockedByTgt.has(tgt)) {
        throw new BadState('Accepted subject no longer exists for locking.');
      }
      const sr = lockedByTgt.get(tgt);
      if (Number(sr.result_id) !== Number(result.result_id)) {
        throw new BadState('Accepted subject no longer belongs to this Result.');
      }
    }
    // Refresh srById with the freshly-locked, freshest snapshot so the loop
    // below sees the absolute latest marks/status under the row lock.
    for (const sr of lockedSRs) {
      const existing = result.SubjectResults.find(x => Number(x.subject_result_id) === Number(sr.subject_result_id));
      if (existing) {
        existing.marks = sr.marks;
        existing.grade = sr.grade;
        existing.result_status = sr.result_status;
      }
    }

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
    // PROMPT 18: detect InnoDB deadlock / lock-wait-timeout so the caller
    // sees a deterministic "please retry" message instead of a generic
    // approval failure. The transaction has already been rolled back above.
    const deadlock = err && (err.code === 'ER_LOCK_DEADLOCK' ||
                             err.code === 'ER_LOCK_WAIT_TIMEOUT' ||
                             err.parent && (err.parent.code === 'ER_LOCK_DEADLOCK' ||
                                            err.parent.code === 'ER_LOCK_WAIT_TIMEOUT') ||
                             err.original && (err.original.code === 'ER_LOCK_DEADLOCK' ||
                                              err.original.code === 'ER_LOCK_WAIT_TIMEOUT'));
    if (deadlock) {
      return res.redirect(`/revaluation/extraction/${importId}?error=` +
        enc('Approval could not acquire the necessary locks. Please retry.'));
    }
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
      { label: 'Upload Revaluation', href: '/revaluation/start' },
      { label: 'Pending OCR', href: `/revaluation/pending/${importId}` },
      { label: 'OCR Extraction', href: `/revaluation/extraction/${importId}` },
      { label: 'Review & Validate', href: `/revaluation/review/${importId}` },
      { label: 'Outcome', active: true }
    ],
    meta: Object.assign({}, st.meta, { sessionId: (st.saved && st.saved.session_id) || null }),
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







