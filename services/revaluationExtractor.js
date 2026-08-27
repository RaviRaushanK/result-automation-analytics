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
    usn: (ex.student && ex.student.usn) || null,
    name: (ex.student && ex.student.name) || null,
    semester: (ex.semester === null || ex.semester === undefined) ? null : ex.semester,
    subjects: Array.isArray(ex.subjects) ? ex.subjects : [],
    lines: Array.isArray(ex.lines) ? ex.lines : [],
    parser_warnings: Array.isArray(ex.warnings) ? ex.warnings : []
  };
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
 * @param {Object} engineOut  output of runEngine()
 * @param {Object} serverCtx  SERVER-authoritative context:
 *   { studentUsn, studentName,
 *     selectedSubjects: [{ subject_result_id, subject_code, subject_name, original_marks }] }
 * @returns {{ok:true, ocr:Object, confidenceScore:number}
 *          |{ok:false, reason:string, ocr:Object}}
 */
function buildCandidates(engineOut, serverCtx) {
  const warnings = [];

  // ---- student evidence (candidates only; never authoritative) ----
  const usnMatch = !!(engineOut.usn && serverCtx.studentUsn && eqFold(engineOut.usn, serverCtx.studentUsn));
  const nameMatch = !!(engineOut.name && serverCtx.studentName && eqFold(engineOut.name, serverCtx.studentName));
  if (!engineOut.usn) {
    warnings.push('OCR could not identify a University Seat Number on the document.');
  } else if (!usnMatch) {
    warnings.push(`USN mismatch: OCR shows '${engineOut.usn}' but the selected Result belongs to '${serverCtx.studentUsn}'. The authoritative student was NOT changed.`);
  }
  if (engineOut.name && !nameMatch) {
    warnings.push(`Student name differs: OCR '${engineOut.name}' vs Result '${serverCtx.studentName}'. Review required.`);
  }

  // ---- OCR subject candidates (raw OCR strings preserved verbatim) ----
  const candidates = engineOut.subjects.map(s => {
    const rawCode = s.subjectCode || '';
    const rawStatus = s.result || null;
    let statusCanon = null;
    if (rawStatus) {
      statusCanon = STATUS_MAP[String(rawStatus).trim().toUpperCase()] || null;
      if (!statusCanon) {
        warnings.push(`Unknown result/status value '${rawStatus}' for ${rawCode}; kept as raw_status only.`);
      }
    }
    const conf = ['high', 'medium', 'low'].indexOf(s.marksConfidence) !== -1 ? s.marksConfidence : 'low';
    if (conf !== 'high') {
      warnings.push(`Marks for ${rawCode} are incomplete or inconsistent on the document (confidence: ${conf}); candidates preserved for manual verification.`);
    }
    return {
      ocr_subject_code: rawCode,
      normalized_code: normalizeCode(rawCode),
      subject_name_candidate: s.subjectName || null,
      revised_internal_marks: (s.internalMarks === undefined ? null : s.internalMarks),
      revised_external_marks: (s.externalMarks === undefined ? null : s.externalMarks),
      revised_marks: (s.totalMarks === undefined ? null : s.totalMarks),
      revised_status_candidate: statusCanon,
      raw_status: rawStatus,
      confidence: conf,
      found_on_card: true,
      _line: findRawLine(engineOut.lines, rawCode)
    };
  });

  const byNorm = new Map();
  for (const c of candidates) {
    if (!c.normalized_code) continue;
    if (!byNorm.has(c.normalized_code)) byNorm.set(c.normalized_code, []);
    byNorm.get(c.normalized_code).push(c);
  }

  // ---- compare ONLY against the selected SubjectResults ----
  const used = new Set();
  const subjectsOut = [];
  for (const sel of (serverCtx.selectedSubjects || [])) {
    const key = normalizeCode(sel.subject_code);
    const hits = byNorm.get(key) || [];
    const row = {
      subject_result_id: sel.subject_result_id,
      original_subject_code: sel.subject_code,
      original_subject_name: sel.subject_name || null,
      original_marks: (sel.original_marks === undefined ? null : sel.original_marks),
      ocr_subject_code: null,
      normalized_code: key,
      match_state: 'SELECTED_BUT_NOT_FOUND',
      matched: false,
      subject_name_candidate: null,
      revised_internal_marks: null,
      revised_external_marks: null,
      revised_marks: null,
      revised_status_candidate: null,
      raw_status: null,
      confidence: null,
      found_on_card: false,
      raw_line: null
    };
    if (hits.length === 1) {
      const c = hits[0];
      used.add(c);
      row.match_state = 'MATCHED';
      row.matched = true;
      row.ocr_subject_code = c.ocr_subject_code;
      row.subject_name_candidate = c.subject_name_candidate;
      row.revised_internal_marks = c.revised_internal_marks;
      row.revised_external_marks = c.revised_external_marks;
      row.revised_marks = c.revised_marks;
      row.revised_status_candidate = c.revised_status_candidate;
      row.raw_status = c.raw_status;
      row.confidence = c.confidence;
      row.found_on_card = true;
      row.raw_line = c._line;
    } else if (hits.length > 1) {
      row.match_state = 'AMBIGUOUS';
      warnings.push(`Ambiguous OCR match for ${sel.subject_code}: ${hits.length} document rows share normalized code '${key}'. Left unmatched for review.`);
    } else {
      warnings.push(`Selected subject ${sel.subject_code} was not found on the document.`);
    }
    subjectsOut.push(row);
  }

  const unmatchedDetails = candidates.filter(c => !used.has(c)).map(c => ({
    ocr_subject_code: c.ocr_subject_code,
    normalized_code: c.normalized_code,
    subject_name_candidate: c.subject_name_candidate,
    revised_internal_marks: c.revised_internal_marks,
    revised_external_marks: c.revised_external_marks,
    revised_marks: c.revised_marks,
    revised_status_candidate: c.revised_status_candidate,
    raw_status: c.raw_status,
    confidence: c.confidence,
    raw_line: c._line
  }));
  for (const u of unmatchedDetails) {
    warnings.push(`Document contains subject '${u.ocr_subject_code}' which is not among the selected revaluation subjects.`);
  }

  warnings.push(...engineOut.parser_warnings.filter(w => typeof w === 'string' && w));

  const scores = subjectsOut.filter(r => r.matched).map(r => CONFIDENCE_SCORES[r.confidence] || CONFIDENCE_SCORES.low);
  const confidenceScore = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : CONFIDENCE_SCORES.low;

  const ocr = {
    extraction_method: engineOut.extraction_method,
    extracted_at: new Date().toISOString(),
    raw_text: engineOut.raw_text,
    student_candidates: {
      usn: engineOut.usn,
      name: engineOut.name,
      usn_matches_server: usnMatch,
      name_matches_server: nameMatch
    },
    semester_candidate: engineOut.semester,
    subjects: subjectsOut,
    unmatched_ocr_codes: unmatchedDetails.map(u => u.ocr_subject_code),
    unmatched_ocr_details: unmatchedDetails,
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



