/**
 * Revaluation OCR adapter (PROMPT 4) — THIN ADAPTER over documentExtractor.
 *
 * Responsibilities (and nothing more):
 *  - invoke the EXISTING engine: documentExtractor.extract(filePath, 'revaluation')
 *    (pdfjs digital-text path with automatic Tesseract fallback for scans)
 *  - interpret its output as revaluation CANDIDATES — never authoritative data
 *  - normalize subject codes FOR COMPARISON ONLY (raw OCR strings are preserved)
 *  - map the official result letters printed on the documents
 *    (P/F/A/W/X/NE) to canonical statuses; unknown values stay raw + warning
 *  - flag mismatches (USN / name / subjects / marks quality) as warnings
 *
 * This module NEVER touches the database and NEVER modifies academic data.
 * Server-authoritative identity (student/session/attempt/subject_result_ids)
 * flows IN via serverCtx; callers echo the returned candidate block into
 * OcrExtraction.extracted_json.ocr without altering the stored context keys.
 */
const documentExtractor = require('./documentExtractor');

// Documented aggregate mapping (Prompt 4 spec): high=0.9, medium=0.7, low=0.4
const CONFIDENCE_SCORES = { high: 0.9, medium: 0.7, low: 0.4 };

// Official VTU nomenclature printed on the inspected revaluation sheets:
// P -> PASS, F -> FAIL, A -> ABSENT, W -> WITHHELD, X / NE -> NOT ELIGIBLE.
// Keys cover BOTH the single letters printed on cards and the words the
// shared extractor may hand through after its own normalization.
const STATUS_MAP = {
  P: 'PASS',
  F: 'FAIL',
  A: 'ABSENT',
  W: 'WITHHELD',
  PASS: 'PASS',
  FAIL: 'FAIL',
  ABSENT: 'ABSENT',
  WITHHELD: 'WITHHELD',
  X: 'NOT_ELIGIBLE',
  NE: 'NOT_ELIGIBLE'
};

// Normalization is FOR COMPARISON ONLY. We deliberately do NOT fold O->0 or
// I/L->1 look-alikes: a document reading MMCL1O6 must stay visibly unmatched
// against configured MMCL106 so the review stage can adjudicate it.
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Run the shared engine and hand back just the pieces this adapter needs. */
async function runEngine(filePath) {
  const result = await documentExtractor.extract(filePath, 'revaluation');
  const ex = (result && result.extraction) || {};
  return {
    extraction_method: ex.extractionMethod || null,
    raw_text: ex.rawText || '',
    // Raw OCR USN (preserved as-OCR, e.g. "IMV25MCO074")
    usn: (ex.student && ex.student.usn) || null,
    usn_raw: (ex.student && ex.student.usnRaw) || null,
    // Normalized USN for COMPARISON ONLY (I→1, O→0). NEVER written back
    // to the authoritative Student record.
    usn_normalized: (ex.student && ex.student.usnNormalized) || null,
    name: (ex.student && ex.student.name) || null,
    semester: (ex.semester === null || ex.semester === undefined) ? null : ex.semester,
    subjects: Array.isArray(ex.subjects) ? ex.subjects : [],
    lines: Array.isArray(ex.lines) ? ex.lines : [],
    parser_warnings: Array.isArray(ex.warnings) ? ex.warnings : []
  };
}

/**
 * Normalize a USN for SAFE comparison: I→1, O→0, then uppercase + strip
 * non-alphanumerics. Used ONLY for matching OCR USN against the server-
 * authoritative Student.usn. Never used to mutate either value.
 */
function normalizeUsnForCompare(usn) {
  return String(usn || '')
    .toUpperCase()
    .replace(/I/g, '1')
    .replace(/O/g, '0')
    .replace(/[^A-Z0-9]/g, '');
}

function eqFold(a, b) {
  return String(a || '').replace(/\s+/g, ' ').trim().toUpperCase() ===
         String(b || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function findRawLine(lines, code) {
  for (const l of lines) {
    const t = (typeof l === 'string') ? l : (l && l.text);
    if (t && t.indexOf(code) !== -1) return t;
  }
  return null;
}

/**
 * Interpret engine output as revaluation candidates against SERVER context.
 *
 * WORKFLOW (corrected): there is NO subject selection before uploading the
 * revaluation marks card. The uploaded card is the only source of initial
 * detected rows.
 *
 *  - Initial detected rows are created ONLY for subjects detected on the
 *    revaluation card (output of `looksLikeRevaluationRow` + `parseRevaluationDetails`).
 *  - Each detected row is matched against the student's authoritative
 *    SubjectResults (`serverCtx.allSubjectResults`) by normalized subject code.
 *  - Subject codes detected on the card but not in the student's result
 *    receive match_state `UNMATCHED_NOT_IN_RESULT` (likely noise / wrong card).
 *  - Subject codes in the student's result that are not on the card are NOT
 *    automatically turned into "missing revaluation subjects" on the
 *    extraction page. That message would be wrong under the current workflow.
 *  - The review/edit page already has an "Add Subject" feature that lets
 *    the admin manually add a subject row when OCR didn't detect one. This
 *    adapter does not redesign that flow; it just stops generating missing
 *    rows from a "selected subjects" list.
 *  - `allSubjectResults` is also surfaced (lightly) as `missing_subjects` so
 *    the review page's existing "Add Subject" feature continues to function.
 *
 * @param {Object} engineOut  output of runEngine()
 * @param {Object} serverCtx  SERVER-authoritative context:
 *   { studentUsn, studentName,
 *     allSubjectResults: [{ subject_result_id, subject_code, subject_name,
 *                           credits, marks, result_status }] }
 * @returns {{ok:true, ocr:Object, confidenceScore:number}
 *          |{ok:false, reason:string, ocr:Object}}
 */
function buildCandidates(engineOut, serverCtx) {
  const warnings = [];

  // ---- student evidence (candidates only; never authoritative) ----
  //
  // USN comparison is I/O-tolerant: the OCR may emit "IMV25MCO074" while
  // the server has "1MV25MC074". We compare the *normalized* form on both
  // sides, but we never mutate either value. Raw OCR USN is preserved
  // separately as engineOut.usn_raw for display and audit.
  const ocrUsnForCompare = engineOut.usn_normalized
    ? normalizeUsnForCompare(engineOut.usn_normalized)
    : normalizeUsnForCompare(engineOut.usn);
  const serverUsnForCompare = normalizeUsnForCompare(serverCtx.studentUsn);
  const usnMatch = !!(ocrUsnForCompare && serverUsnForCompare && ocrUsnForCompare === serverUsnForCompare);
  const nameMatch = !!(engineOut.name && serverCtx.studentName && eqFold(engineOut.name, serverCtx.studentName));
  if (!engineOut.usn) {
    warnings.push('OCR could not identify a University Seat Number on the document.');
  } else if (!usnMatch) {
    warnings.push(`USN mismatch: OCR shows '${engineOut.usn}' (normalized '${ocrUsnForCompare}') but the selected Result belongs to '${serverCtx.studentUsn}' (normalized '${serverUsnForCompare}'). The authoritative student was NOT changed.`);
  }
  if (engineOut.name && !nameMatch) {
    warnings.push(`Student name differs: OCR '${engineOut.name}' vs Result '${serverCtx.studentName}'. Review required.`);
  }

  // ---- Build lookup of normalized code -> student's full SubjectResults ----
  // No "pre-upload selection" exists; the matching universe is the student's
  // authoritative SubjectResults set.
  const selByNorm = {};
  for (const s of (serverCtx.allSubjectResults || [])) {
    const key = normalizeCode(s.subject_code);
    if (!key) continue;
    if (!selByNorm[key]) selByNorm[key] = [];
    selByNorm[key].push(s);
  }

  // ---- Build normalized OCR candidates from Phase 1 parser output ----
  // Phase 1 fields: subjectCode, subjectName, internalMarks, oldMarks, oldResult,
  //                 rvMarks, rvResult, finalMarks, finalResult, marksConfidence, marksValidated, rawLine
  const candidates = [];
  const seenNormalized = new Set();
  for (const s of engineOut.subjects) {
    const rawCode = s.subjectCode || '';
    const nc = normalizeCode(rawCode);
    if (!nc) continue;
    if (seenNormalized.has(nc)) {
      warnings.push(`Duplicate OCR entry detected for normalized code '${nc}'. Skipping additional occurrence.`);
      continue;
    }
    seenNormalized.add(nc);

    const conf = ['high', 'medium', 'low'].indexOf(s.marksConfidence) !== -1 ? s.marksConfidence : 'low';
    if (conf !== 'high') {
      warnings.push(`Marks for ${rawCode} are incomplete or inconsistent on the document (confidence: ${conf}); candidates preserved for manual verification.`);
    }

    // Map status (prefer finalResult, fall back to rvResult, then oldResult)
    const rawStatus = s.finalResult || s.rvResult || s.oldResult || null;
    let statusCanon = null;
    if (rawStatus) {
      statusCanon = STATUS_MAP[String(rawStatus).trim().toUpperCase()] || null;
      if (!statusCanon) {
        warnings.push(`Unknown result/status value '${rawStatus}' for ${rawCode}; kept as raw_status only.`);
      }
    }

    candidates.push({
      // Phase 1 primary fields (independent, no math)
      subjectCode: rawCode,
      normalizedCode: nc,
      subjectName: s.subjectName || '',
      internalMarks: (s.internalMarks === undefined ? null : s.internalMarks),
      oldMarks: (s.oldMarks === undefined ? null : s.oldMarks),
      oldResult: s.oldResult || null,
      rvMarks: (s.rvMarks === undefined ? null : s.rvMarks),
      rvResult: s.rvResult || null,
      finalMarks: (s.finalMarks === undefined ? null : s.finalMarks),
      finalResult: s.finalResult || null,
      // OCR metadata
      marksConfidence: conf,
      marksValidated: s.marksValidated || false,
      rawLine: s.rawLine || '',
      // Legacy compatibility aliases (for downstream review flow that still references old field names)
      ocr_subject_code: rawCode,
      normalized_code: nc,
      subject_name_candidate: s.subjectName || '',
      // Legacy "revised_*" mappings: oldMarks → revised_external_marks, finalMarks → revised_marks
      // These are PRESERVED FOR BACKWARD COMPATIBILITY ONLY, not calculated from other fields.
      revised_internal_marks: (s.internalMarks === undefined ? null : s.internalMarks),
      revised_external_marks: (s.oldMarks === undefined ? null : s.oldMarks),
      revised_marks: (s.finalMarks === undefined ? null : s.finalMarks),
      revised_status_candidate: statusCanon,
      raw_status: rawStatus,
      confidence: conf,
      _line: s.rawLine || findRawLine(engineOut.lines, rawCode) || ''
    });
  }

  // ---- PHASE 2: OCR-first row generation ----
  // Step 1: Create detected rows for EACH OCR candidate (only subjects on the card)
  const detectedRows = [];
  const matchedSrid = new Set(); // Track which SubjectResult ids were matched

  for (const c of candidates) {
    const selEntries = selByNorm[c.normalizedCode] || [];

    if (selEntries.length === 1) {
      // Exactly one SubjectResult matches this OCR candidate → MATCHED
      const sel = selEntries[0];
      matchedSrid.add(Number(sel.subject_result_id));

      detectedRows.push({
        // Identity from server-selected subject (authoritative)
        subject_result_id: sel.subject_result_id,
        subject_code: sel.subject_code,
        subject_name: sel.subject_name || sel.subject_code,
        original_marks: (sel.original_marks === undefined ? null : sel.original_marks),
        // Phase 1 card fields (as extracted, independent values - NO math applied)
        subjectCode: c.subjectCode,
        subjectName: c.subjectName,
        internalMarks: c.internalMarks,
        oldMarks: c.oldMarks,
        oldResult: c.oldResult,
        rvMarks: c.rvMarks,
        rvResult: c.rvResult,
        finalMarks: c.finalMarks,
        finalResult: c.finalResult,
        // Legacy compatibility fields (same data, old names)
        ocr_subject_code: c.ocr_subject_code,
        subject_name_candidate: c.subject_name_candidate,
        revised_internal_marks: c.revised_internal_marks,
        revised_external_marks: c.revised_external_marks,
        revised_marks: c.revised_marks,
        revised_status_candidate: c.revised_status_candidate,
        raw_status: c.raw_status,
        // Match metadata
        match_state: 'MATCHED',
        matched: true,
        confidence: c.confidence,
        marksConfidence: c.marksConfidence,
        marksValidated: c.marksValidated,
        rawLine: c.rawLine,
        raw_line: c._line,
        // Legacy compatibility
        found_on_card: true,
        normalized_code: c.normalizedCode
      });
    } else if (selEntries.length === 0) {
      // OCR candidate is NOT in the student's SubjectResults → UNMATCHED_NOT_IN_RESULT
      // (e.g. false positive from PDF noise, or wrong card for this student.)
      detectedRows.push({
        // No server subject identity - this is UNMATCHED
        subject_result_id: null,
        subject_code: null,
        subject_name: null,
        original_marks: null,
        // Phase 1 card fields
        subjectCode: c.subjectCode,
        subjectName: c.subjectName,
        internalMarks: c.internalMarks,
        oldMarks: c.oldMarks,
        oldResult: c.oldResult,
        rvMarks: c.rvMarks,
        rvResult: c.rvResult,
        finalMarks: c.finalMarks,
        finalResult: c.finalResult,
        // Legacy compatibility fields
        ocr_subject_code: c.ocr_subject_code,
        subject_name_candidate: c.subject_name_candidate,
        revised_internal_marks: c.revised_internal_marks,
        revised_external_marks: c.revised_external_marks,
        revised_marks: c.revised_marks,
        revised_status_candidate: c.revised_status_candidate,
        raw_status: c.raw_status,
        // Match metadata - UNMATCHED
        match_state: 'UNMATCHED_NOT_IN_RESULT',
        matched: false,
        confidence: c.confidence,
        marksConfidence: c.marksConfidence,
        marksValidated: c.marksValidated,
        rawLine: c.rawLine,
        raw_line: c._line,
        // Legacy compatibility
        found_on_card: false,
        normalized_code: c.normalizedCode
      });
    } else {
      // Multiple selected subjects share the same normalized code → AMBIGUOUS
      detectedRows.push({
        subject_result_id: null,
        subject_code: null,
        subject_name: null,
        original_marks: null,
        // Phase 1 card fields
        subjectCode: c.subjectCode,
        subjectName: c.subjectName,
        internalMarks: c.internalMarks,
        oldMarks: c.oldMarks,
        oldResult: c.oldResult,
        rvMarks: c.rvMarks,
        rvResult: c.rvResult,
        finalMarks: c.finalMarks,
        finalResult: c.finalResult,
        // Legacy compatibility fields
        ocr_subject_code: c.ocr_subject_code,
        subject_name_candidate: c.subject_name_candidate,
        revised_internal_marks: c.revised_internal_marks,
        revised_external_marks: c.revised_external_marks,
        revised_marks: c.revised_marks,
        revised_status_candidate: c.revised_status_candidate,
        raw_status: c.raw_status,
        // Match metadata - AMBIGUOUS
        match_state: 'AMBIGUOUS',
        matched: false,
        confidence: c.confidence,
        marksConfidence: c.marksConfidence,
        marksValidated: c.marksValidated,
        rawLine: c.rawLine,
        raw_line: c._line,
        // Legacy compatibility
        found_on_card: false,
        normalized_code: c.normalizedCode
      });
    }
  }

  // Step 2: Identify the student's authoritative subjects that were NOT
  // detected on the revaluation card. These are surfaced as
  // `missing_subjects` ONLY for the review page's "Add Subject" feature.
  //
  // IMPORTANT: this list is NOT shown on the OCR Extraction page. The
  // current workflow has no pre-upload subject selection, so showing
  // "selected subjects that were not found on the card" would be wrong.
  // The Extraction page only shows what was actually detected on the card.
  const missingSubjects = [];
  for (const sr of (serverCtx.allSubjectResults || [])) {
    if (!matchedSrid.has(Number(sr.subject_result_id))) {
      missingSubjects.push({
        subject_result_id: sr.subject_result_id,
        subject_code: sr.subject_code,
        subject_name: sr.subject_name || sr.subject_code,
        credits: (sr.credits === undefined ? null : sr.credits),
        original_marks: (sr.marks === undefined ? null : sr.marks),
        original_status: sr.result_status || null,
        // The student owns this subject, OCR just didn't see it on the card.
        detection_state: 'NOT_DETECTED_ON_CARD',
        match_state: 'NOT_DETECTED_ON_CARD'
      });
      // We deliberately do NOT add a top-level warning here. The review
      // page exposes the full missing list as Add-Subject candidates; the
      // Extraction page must not show a "missing" section.
    }
  }

  warnings.push(...engineOut.parser_warnings.filter(w => typeof w === 'string' && w));

  // Calculate confidence score from matched rows only
  const matchedRows = detectedRows.filter(r => r.match_state === 'MATCHED');
  const scores = matchedRows.map(r => CONFIDENCE_SCORES[r.confidence] || CONFIDENCE_SCORES.low);
  const confidenceScore = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : 0; // No matched subjects = 0 confidence

  // Build the OCR output structure
  const ocr = {
    extraction_method: engineOut.extraction_method,
    extracted_at: new Date().toISOString(),
    raw_text: engineOut.raw_text,
    student_candidates: {
      // Raw OCR USN as captured (e.g. "IMV25MCO074"). Preserved exactly.
      usn: engineOut.usn,
      // Normalized USN for COMPARISON ONLY (I→1, O→0). Never written back
      // to the authoritative Student record.
      usn_normalized: engineOut.usn_normalized || null,
      name: engineOut.name,
      usn_matches_server: usnMatch,
      name_matches_server: nameMatch
    },
    semester_candidate: engineOut.semester,
    // OCR-detected subjects from the uploaded card (the ONLY source of
    // initial revaluation rows in the current workflow).
    subjects: detectedRows,
    // The student's other SubjectResults that were NOT detected on the
    // card. Surfaced ONLY for the review page's "Add Subject" feature —
    // the Extraction page does not render a Missing list.
    missing_subjects: missingSubjects,
    // Unmatched OCR codes (backward compatibility)
    unmatched_ocr_codes: detectedRows
      .filter(r => r.match_state === 'UNMATCHED_NOT_IN_RESULT')
      .map(r => r.ocr_subject_code),
    unmatched_ocr_details: detectedRows
      .filter(r => r.match_state === 'UNMATCHED_NOT_IN_RESULT')
      .map(r => ({
        ocr_subject_code: r.ocr_subject_code,
        normalized_code: r.normalizedCode,
        subject_name_candidate: r.subject_name_candidate,
        revised_internal_marks: r.revised_internal_marks,
        revised_external_marks: r.revised_external_marks,
        revised_marks: r.revised_marks,
        revised_status_candidate: r.revised_status_candidate,
        raw_status: r.raw_status,
        confidence: r.confidence,
        raw_line: r.raw_line
      })),
    warnings: warnings,
    extraction_status: 'extracted'
  };

  // Empty-document guard: nothing usable at all → retryable failure state.
  if (!engineOut.usn && candidates.length === 0) {
    ocr.extraction_status = 'failed';
    ocr.failed_reason = 'EMPTY_EXTRACTION';
    ocr.error = 'No usable content could be extracted (no USN and no subject rows).';
    ocr.warnings = warnings.concat([ocr.error]);
    return { ok: false, reason: 'EMPTY_EXTRACTION', ocr: ocr };
  }

  return { ok: true, ocr: ocr, confidenceScore: confidenceScore };
}

/** One-call adapter used by the controller's runExtraction handler. */
async function extractAndBuild(filePath, serverCtx) {
  const engineOut = await runEngine(filePath);
  return buildCandidates(engineOut, serverCtx);
}

module.exports = {
  extractAndBuild,
  buildCandidates,
  runEngine,
  normalizeCode,
  STATUS_MAP,
  CONFIDENCE_SCORES
};



