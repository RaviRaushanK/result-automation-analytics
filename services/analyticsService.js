/**
 * Analytics Service — Phase 2.
 *
 * Sits between the future Analytics controller and the read-only analytics
 * repository. Responsibilities:
 *   - centralized filter/option normalization (typed, allowlisted)
 *   - numeric / percentage normalization (DB DECIMALs arrive as strings)
 *   - derived presentation metrics (pass %, grade buckets)
 *   - neutral terminology and clear original-vs-effective distinction
 *   - tolerant revaluation remarks parsing (TEXT column, may be NULL /
 *     valid JSON / legacy text / malformed)
 *
 * Non-goals (deliberately NOT decided here):
 *   - topper ranking policy (candidate rows stay neutral)
 *   - post-revaluation GPA (never computed)
 *   - "current/unresolved backlog" semantics
 *   - default reporting basis (original vs effective)
 *
 * All SQL lives in repositories/analyticsRepository.js. This module never
 * touches Sequelize or the database directly and performs no writes.
 */

const analyticsRepository = require('../repositories/analyticsRepository');

const MODES = ['original', 'effective'];
const ATTEMPTS = ['all', 'latest'];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// Numeric fields commonly returned by the repository as DB strings.
const NUMERIC_FIELDS = new Set([
  'students', 'results', 'subjectsAttempted', 'passed', 'failed',
  'avgMarks', 'maxMarks', 'minMarks',
  'resultTotal', 'resultPassCount', 'resultFailCount', 'avgSgpa', 'avgCgpa',
  'attempted', 'resultCount', 'subjectAttempts', 'subjectPassed',
  'subjectFailed', 'count', 'attemptNo', 'sgpa', 'cgpa', 'rank',
  'cases', 'subjectsWithRevaluation', 'statusChanges', 'failToPass',
  'passToFail', 'positiveDelta', 'unchanged', 'negativeDelta',
  'averageDelta', 'maxDelta', 'minDelta', 'rowCount',
  'effectiveOverlaySubjects', 'effectiveAnomalies',
  'originalMarks', 'revisedMarks', 'delta'
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toInt(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function toStr(value) {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function toNum(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Centralized filter normalization. Invalid values are dropped rather than
 * forwarded (never NaN into SQL); mode/attempt are allowlisted with safe
 * defaults (mode=original, attempt=latest). Zero remains a valid value.
 */
function normalizeFilters(filters) {
  const f = filters || {};
  const mode = MODES.includes(f.mode) ? f.mode : 'original';
  const attempt = ATTEMPTS.includes(f.attempt) ? f.attempt : 'latest';

  const normalized = {
    mode,
    attempt,
    exam_year: toInt(f.exam_year),
    semester: toStr(f.semester),
    exam_session: toStr(f.exam_session),
    department_id: toInt(f.department_id),
    batch_id: toInt(f.batch_id),
    session_id: toInt(f.session_id),
    subject_id: toInt(f.subject_id),
    subject_code: toStr(f.subject_code),
    student_id: toInt(f.student_id),
    usn: toStr(f.usn),
    result_status: normalizeStatus(f.result_status),
    grade: toStr(f.grade),
    exam_type: toStr(f.exam_type),
    attempt_no: toInt(f.attempt_no),
    revaluation_status: normalizeRevalStatus(f.revaluation_status)
  };

  // Drop undefined keys so the repository only sees values actually provided.
  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === undefined) delete normalized[key];
  });
  return normalized;
}

function normalizeStatus(value) {
  const s = toStr(value);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'pass' || lower === 'p') return 'pass';
  if (lower === 'fail' || lower === 'f') return 'fail';
  return undefined; // never invent unsupported statuses
}


function normalizeRevalStatus(value) {
  const s = toStr(value);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  return ['pending', 'approved', 'rejected'].includes(lower) ? lower : undefined;
}

/**
 * Percentage helper. Zero/absent denominators yield 0 — never NaN/Infinity.
 * Rounded to 2 decimals for presentation.
 */
function calculatePercentage(part, total) {
  const p = toNum(part);
  const t = toNum(total);
  if (!t || t <= 0 || p === null || p === undefined) return 0;
  return Math.round((p / t) * 100 * 100) / 100;
}

/** Normalize pagination: limit capped at 100, offset never negative. */
function normalizeOptions(options) {
  const o = options || {};
  let limit = toInt(o.limit);
  if (limit === undefined || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  let offset = toInt(o.offset);
  if (offset === undefined || offset < 0) offset = 0;
  return { limit, offset };
}

/** Convert known-numeric DB string values to numbers in a single row. */
function normalizeRow(row, fields) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (fields.has(key)) {
      out[key] = toNum(value);
    } else if (key === 'grade' && value === 'null') {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Tolerant remarks parser. remarks is a TEXT column that may be NULL, valid
 * JSON, legacy plain text, or malformed. Never throws; never assumes schema.
 */
function parseRevaluationRemarks(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch (err) {
      // Malformed JSON: keep raw text, never crash analytics.
      return { raw: s };
    }
  }
  return { raw: s };
}



// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

/**
 * 1. getOverview(filters)
 * Summary metrics (subject-level, mode-aware) plus grade distribution.
 * Parent GPA/status fields are preserved as STORED values — never relabeled
 * as post-revaluation values.
 */
async function getOverview(filters) {
  const normalized = normalizeFilters(filters);
  const [summary, grades] = await Promise.all([
    analyticsRepository.getSummary(normalized),
    analyticsRepository.getGradeDistribution(normalized)
  ]);

  const subject = normalizeRow(summary.subject, NUMERIC_FIELDS) || {};
  if (subject.attempted !== undefined) {
    subject.passPercentage = calculatePercentage(subject.passed, subject.attempted);
  }
  const parent = normalizeRow(summary.parent, NUMERIC_FIELDS) || {};

  const gradeDistribution = (grades || []).map((g) => ({
    grade: g.grade === null || g.grade === undefined ? 'Unknown' : g.grade,
    count: toNum(g.count) || 0
  }));
  const totalGrades = gradeDistribution.reduce((sum, g) => sum + g.count, 0);
  for (const g of gradeDistribution) {
    g.percentage = calculatePercentage(g.count, totalGrades);
  }

  return {
    filters: normalized,
    mode: summary.mode || normalized.mode,
    subject,
    parent,
    gradeDistribution,
    ...(summary.effectiveAnomalies !== undefined
      ? { effectiveIntegrity: { anomalies: summary.effectiveAnomalies } }
      : {})
  };
}

/**
 * 2. getToppers(filters, options)
 * Eligible topper rows only: stored passing results with a stored CGPA.
 * The repository assigns the fixed CGPA rank before applying pagination.
 */
async function getToppers(filters, options) {
  const normalized = normalizeFilters(filters);
  const page = normalizeOptions(options);
  const rows = await analyticsRepository.getTopStudents(normalized, page);

  const data = (rows || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS);
    r.subjectPassPercentage = calculatePercentage(r.passed, r.subjectsAttempted);
    return r;
  });

  return {
    filters: normalized,
    pagination: { limit: page.limit, offset: page.offset },
    notice: 'Only passed results with a stored CGPA are listed; ranks are assigned by CGPA, highest first, numbered 1 to n.',
    data
  };
}

/**
 * 3. getFailedStudents(filters, options)
 * Subject-level failures as represented by the repository query. In effective
 * mode the original marks/grade/status are preserved alongside the revised
 * values plus hadEffectiveRevaluation provenance. No "current/unresolved
 * backlog" semantics are invented.
 */
async function getFailedStudents(filters, options) {
  const normalized = normalizeFilters(filters);
  const page = normalizeOptions(options);
  const rows = await analyticsRepository.getFailedStudents(normalized, page);

  const data = (rows || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS);
    if (normalized.mode === 'effective') {
      // Keep original failure information visible alongside revised values.
      r.hadEffectiveRevaluation = !!r.hadEffectiveRevaluation;
    }
    return r;
  });

  return {
    filters: normalized,
    mode: normalized.mode,
    pagination: { limit: page.limit, offset: page.offset },
    data
  };
}

/**
 * 4. getSubjectAnalytics(filters)
 * Subject rows normalized for frontend use; pass % derived only from
 * returned counts; NULL grades become "Unknown".
 */
async function getSubjectAnalytics(filters) {
  const normalized = normalizeFilters(filters);
  const rows = await analyticsRepository.getSubjectAnalytics(normalized);

  const data = (rows || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS);
    r.passPercentage = calculatePercentage(r.passed, r.attempted);
    if (r.gradeCounts) {
      const counts = {};
      for (const [grade, count] of Object.entries(r.gradeCounts)) {
        counts[grade === 'null' ? 'Unknown' : grade] = toNum(count) || 0;
      }
      r.gradeCounts = counts;
    }
    return r;
  });

  return { filters: normalized, mode: normalized.mode, data };
}

/**
 * 5. getSemesterAnalytics(filters)
 * Session-level rows. SGPA/CGPA and parent pass/fail remain STORED parent
 * values, clearly separate from mode-aware subject-level metrics.
 */
async function getSemesterAnalytics(filters) {
  const normalized = normalizeFilters(filters);
  const rows = await analyticsRepository.getSemesterAnalytics(normalized);

  const data = (rows || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS);
    r.subjectPassPercentage = calculatePercentage(r.subjectPassed, r.subjectAttempts);
    r.resultPassPercentage = calculatePercentage(r.resultPassCount, r.resultCount);
    return r;
  });

  return {
    filters: normalized,
    mode: normalized.mode,
    // Explicit reminder for consumers: these GPA fields are STORED values.
    storedGpaNotice: 'avgSgpa/avgCgpa are stored parent Result values, not post-revaluation values.',
    data
  };
}

/**
 * 6. getStudentAnalytics(filters, options)
 * Per-result student rows with mode-aware subject aggregates. Stored
 * sgpa/cgpa/parentStatus are returned unaltered.
 */
async function getStudentAnalytics(filters, options) {
  const normalized = normalizeFilters(filters);
  const page = normalizeOptions(options);
  const rows = await analyticsRepository.getStudentAnalytics(normalized, page);

  const data = (rows || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS);
    r.subjectPassPercentage = calculatePercentage(r.passed, r.subjectsAttempted);
    return r;
  });

  return {
    filters: normalized,
    mode: normalized.mode,
    pagination: { limit: page.limit, offset: page.offset },
    data
  };
}

/**
 * 7. getGradeDistribution(filters)
 * NULL/absent grades become "Unknown"; real grades untouched; safe
 * percentages derived from returned counts.
 */
async function getGradeDistribution(filters) {
  const normalized = normalizeFilters(filters);
  const rows = await analyticsRepository.getGradeDistribution(normalized);

  const data = (rows || []).map((g) => ({
    grade: g.grade === null || g.grade === undefined ? 'Unknown' : g.grade,
    count: toNum(g.count) || 0
  }));
  const total = data.reduce((sum, g) => sum + g.count, 0);
  for (const g of data) {
    g.percentage = calculatePercentage(g.count, total);
  }

  return { filters: normalized, mode: normalized.mode, data };
}

/**
 * 8. getRevaluationAnalytics(filters)
 * Repository outcome/pipeline/integrity metrics preserved verbatim with
 * neutral terminology (positive delta, fail → pass, etc.). Pipeline counts
 * remain explicitly raw ledger row counts.
 */
async function getRevaluationAnalytics(filters) {
  const normalized = normalizeFilters(filters);
  const result = await analyticsRepository.getRevaluationAnalytics(normalized);

  const outcomes = normalizeRow(result.outcomes, NUMERIC_FIELDS) || {};
  const pipeline = (result.pipeline || []).map((p) => ({
    revaluationStatus: p.revaluationStatus,
    rowCount: toNum(p.rowCount) || 0
  }));

  return {
    filters: normalized,
    outcomes,
    pipeline,
    pipelineNotice: 'Pipeline counts are persisted RevaluationResult ledger rows, not real-world application counts.',
    effectiveIntegrity: {
      effectiveOverlaySubjects: toNum((result.integrity || {}).effectiveOverlaySubjects) || 0,
      anomalies: toNum((result.integrity || {}).effectiveAnomalies) || 0
    }
  };
}

/**
 * Per-subject revaluation outcome rollup for the detail table grouping.
 * Effective outcomes use only approved+effective events; pipeline counts
 * remain raw ledger rows (not recomputed here).
 */
async function getRevaluationBySubject(filters) {
  const normalized = normalizeFilters(filters);
  const result = await analyticsRepository.getRevaluationBySubject(normalized);

  const bySubject = (result.bySubject || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS) || {};
    r.subjectLabel = r.subjectName || r.subjectCode || '';
    return r;
  });

  return {
    filters: normalized,
    bySubject
  };
}

/**
 * Per-effective-revaluation-event detail rows. Only approved+effective events
 * are returned; pending/rejected rows are excluded from the detail view.
 */
async function getRevaluationDetail(filters) {
  const normalized = normalizeFilters(filters);
  const result = await analyticsRepository.getRevaluationDetail(normalized);

  const detail = (result.detail || []).map((row) => {
    const r = normalizeRow(row, NUMERIC_FIELDS) || {};
    r.subjectLabel = r.subjectName || r.subjectCode || '';
    r.studentLabel = r.usn || '';
    r.studentName = r.studentName || '';
    r.caseId = r.caseId || '';
    r.caseDescription = r.caseDescription || '';
    r.originalMarks = toNum(row.originalMarks) != null ? toNum(row.originalMarks) : null;
    r.revisedMarks = toNum(row.revisedMarks) != null ? toNum(row.revisedMarks) : null;
    r.delta = toNum(row.delta) != null ? toNum(row.delta) : null;
    r.originalStatus = row.originalStatus || '';
    r.revisedStatus = row.revisedStatus || '';
    r.validationStatus = r.validationStatus || '';
    r.remarkType = r.remarkType || '';
    r.remarkSummary = r.remarkSummary || '';
    r.eventProvenance = r.eventProvenance || '';
    r.sourceFile = row.sourceFile || '';
    return r;
  });

  return {
    filters: normalized,
    detail
  };
}

/**
 * 9. getFilterOptions(scope, parentFilters)
 * Cascading options; scope allowlisting and parent scoping remain in the
 * repository. Returns { data: [] } for invalid scopes (never throws).
 */
async function getFilterOptions(scope, parentFilters) {
  const normalized = normalizeFilters(parentFilters);
  const rows = await analyticsRepository.getFilterOptions(scope, normalized);
  return { scope, filters: normalized, data: rows || [] };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getOverview,
  getToppers,
  getFailedStudents,
  getSubjectAnalytics,
  getSemesterAnalytics,
  getStudentAnalytics,
  getGradeDistribution,
  getRevaluationAnalytics,
  getRevaluationBySubject,
  getRevaluationDetail,
  getFilterOptions,
  // Exposed for later phases (unit tests / future per-event enrichment).
  parseRevaluationRemarks,
  calculatePercentage,
  normalizeFilters,
  normalizeOptions
};

