'use strict';

/**
 * repositories/analyticsRepository.js
 *
 * READ-ONLY analytics query layer (PHASE 1).
 *
 * Rules honoured here:
 *   - SELECT only. No INSERT/UPDATE/DELETE anywhere.
 *   - No OCR / import tables are ever queried for academic analytics.
 *   - Effective subject analytics NEVER rely on the effective_student_results
 *     view (its result_status/sgpa/cgpa are PARENT Result values and it
 *     exposes no effective subject status). Effective overlays are computed at
 *     SUBJECT level from SubjectResult LEFT JOIN RevaluationResult with
 *       rv.is_effective = 1 AND rv.revaluation_status = 'approved'
 *     falling back to original SubjectResult values via COALESCE.
 *   - Pending / rejected revaluation rows never contribute to effective
 *     outcomes; they are only counted as raw ledger rows in
 *     getRevaluationAnalytics().
 *   - Parent Result.result_status/sgpa/cgpa are returned verbatim as STORED
 *     parent values, never relabeled as post-revaluation values. No GPA
 *     recomputation happens in this layer.
 *   - No topper ranking policy is decided here; getTopStudents() only returns
 *     candidate rows for the service layer.
 *
 * Query safety:
 *   - All filter values are passed via Sequelize `replacements` (named bind
 *     parameters). No user value is ever string-interpolated into SQL.
 *   - Enumerated fields (result_status, grade sentinel, exam_type, mode,
 *     attempt, scope) are allowlisted before use; free strings (semester,
 *     exam_session, usn, subject_code, grade) are bound string parameters.
 *   - ORDER BY / GROUP BY use only hardcoded column literals.
 *
 * Raw SQL rationale (instead of ORM include-based aggregation):
 *   The effective overlay requires a DEDUPLICATED derived table (exactly one
 *   approved effective event per subject_result_id) because the schema has NO
 *   database uniqueness guarantee on one effective row; an ORM hasMany include
 *   would silently multiply joined rows and corrupt aggregates. Latest-attempt
 *   filtering similarly needs a per (student_id, session_id) MAX(attempt_no)
 *   join. Both are parameterized SELECTs against the shared Sequelize instance
 *   exported by database/models (no new connection).
 *
 * Conventions respected (database/models/index.js):
 *   underscored = true, freezeTableName = true, timestamps = false.
 *   Table/column names below are the literal snake_case names.
 */

const { QueryTypes } = require('sequelize');
const db = require('../database/models');

const {
  sequelize,
  Department,
  Batch,
  ResultSession,
  Student,
  Result,
  Subject,
  SubjectResult,
  RevaluationResult
} = db;

// ---------------------------------------------------------------------------
// Constants / allowlists
// ---------------------------------------------------------------------------

const MODES = ['original', 'effective'];
const ATTEMPTS = ['all', 'latest'];
const SUBJECT_STATUSES = ['pass', 'fail'];
const EXAM_TYPES = ['REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT'];
const FILTER_SCOPES = ['years', 'semesters', 'departments', 'batches', 'sessions', 'subjects'];

/** Hard cap on row-returning queries (defensive; callers should paginate). */
const MAX_LIMIT = 1000;

/**
 * Deduplicated approved+effective revaluation event per subject_result.
 * Exactly one row per subject_result_id even when data contains multiple
 * effective rows (anomaly), chosen by MAX(revaluation_no) which is unique per
 * subject_result. Used ONLY as a LEFT JOIN overlay; original values remain
 * the fallback via COALESCE.
 */
const EFFECTIVE_EVENT_JOIN = `
  LEFT JOIN (
    SELECT e.revaluation_id, e.subject_result_id, e.original_marks,
           e.revised_marks, e.original_status, e.revised_status, e.revised_grade
    FROM revaluation_results e
    INNER JOIN (
      SELECT subject_result_id, MAX(revaluation_no) AS max_no
      FROM revaluation_results
      WHERE is_effective = 1 AND revaluation_status = 'approved'
      GROUP BY subject_result_id
    ) pick ON pick.subject_result_id = e.subject_result_id
          AND pick.max_no = e.revaluation_no
    WHERE e.is_effective = 1 AND e.revaluation_status = 'approved'
  ) eff ON eff.subject_result_id = sr.subject_result_id
`;

/** FROM/WHERE skeleton shared by subject-level analytics queries. */
const SUBJECT_FROM = `
  FROM subject_results sr
  INNER JOIN results r          ON r.result_id    = sr.result_id
  INNER JOIN result_sessions rs ON rs.session_id  = r.session_id
  INNER JOIN batches b          ON b.batch_id     = rs.batch_id
  INNER JOIN students st        ON st.student_id  = r.student_id
  INNER JOIN subjects sub       ON sub.subject_id = sr.subject_id
`;

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** Parse an integer filter value; undefined for null/empty/invalid. */
function toInt(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

/** Allowlisted string; undefined when not in the list. */
function allowlisted(value, allowed) {
  if (value === null || value === undefined) return undefined;
  const s = String(value);
  return allowed.includes(s) ? s : undefined;
}

/** Plain string filter; undefined for empty values. */
function toStr(value) {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

/**
 * Normalize raw filters into typed, allowlisted values.
 * Unknown / invalid values are dropped (never injected into SQL).
 */
function normalizeFilters(filters) {
  const f = filters || {};
  const normalized = {
    mode: allowlisted(f.mode, MODES) || 'original',
    attempt: allowlisted(f.attempt, ATTEMPTS) || 'all',
    session_id: toInt(f.session_id),
    exam_year: toInt(f.exam_year),
    semester: toStr(f.semester),
    exam_session: toStr(f.exam_session),
    department_id: toInt(f.department_id),
    batch_id: toInt(f.batch_id),
    subject_id: toInt(f.subject_id),
    subject_code: toStr(f.subject_code),
    student_id: toInt(f.student_id),
    usn: toStr(f.usn),
    grade: toStr(f.grade),
    attempt_no: toInt(f.attempt_no),
    exam_type: allowlisted(f.exam_type, EXAM_TYPES),
    // 'UNKNOWN' is an explicit grade sentinel selecting NULL grades
    gradeIsNull: String(f.grade || '').toUpperCase() === 'UNKNOWN',
    // Subject-level status filter (effective/original subject status, NOT the
    // parent Result status).
    result_status: allowlisted(f.result_status, SUBJECT_STATUSES)
  };
  normalized.hasSessionScope = normalized.session_id !== undefined
    || normalized.exam_year !== undefined
    || normalized.semester !== undefined
    || normalized.exam_session !== undefined
    || normalized.department_id !== undefined
    || normalized.batch_id !== undefined;
  return normalized;
}

/**
 * Resolve the session filter set.
 * Returns:
 *   { scoped: false }                       -> no session-scope filters
 *   { scoped: true, ids: [...], empty: false }
 *   { scoped: true, ids: [],  empty: true } -> callers MUST short-circuit
 * Never falls back to an unrestricted query when a filter matched zero
 * sessions (the dashboard defect this layer deliberately avoids).
 */
async function resolveSessionsInternal(filters) {
  const f = normalizeFilters(filters);
  if (!f.hasSessionScope) return { scoped: false, ids: [], empty: false };

  const where = {};
  if (f.session_id !== undefined) where.session_id = f.session_id;
  if (f.exam_year !== undefined) where.exam_year = f.exam_year;
  if (f.semester !== undefined) where.semester = f.semester;
  if (f.exam_session !== undefined) where.exam_session = f.exam_session;
  if (f.batch_id !== undefined) where.batch_id = f.batch_id;
  if (f.department_id !== undefined) {
    // Department -> Batch -> ResultSession (batch_name is NOT a program)
    where['$batch.department_id$'] = f.department_id;
  }

  const rows = await ResultSession.findAll({
    attributes: ['session_id'],
    where,
    include: f.department_id !== undefined
      ? [{ model: Batch, attributes: [], required: true }]
      : [],
    raw: true
  });

  const ids = rows.map((r) => r.session_id);
  return { scoped: true, ids, empty: ids.length === 0 };
}

/**
 * Build the SQL session-scope fragment + replacements.
 * Returns null when the caller must short-circuit to an empty result.
 */
function buildSessionFragment(resolved, params) {
  if (!resolved.scoped) return '';
  if (resolved.empty) return null;
  params.sessionIds = resolved.ids;
  return ' AND rs.session_id IN (:sessionIds)';
}

/** Row-level filter fragments applying to per-mode status/grade expressions. */
function buildRowFilterFragment(f, params) {
  let sql = '';
  const add = (fragment, key, value) => {
    sql += ` AND ${fragment}`;
    params[key] = value;
  };

  if (f.student_id !== undefined) add('r.student_id = :studentId', 'studentId', f.student_id);
  if (f.usn !== undefined) add('st.usn = :usn', 'usn', f.usn);
  if (f.subject_id !== undefined) add('sr.subject_id = :subjectId', 'subjectId', f.subject_id);
  if (f.subject_code !== undefined) add('sub.subject_code = :subjectCode', 'subjectCode', f.subject_code);
  if (f.attempt_no !== undefined) add('r.attempt_no = :attemptNo', 'attemptNo', f.attempt_no);
  if (f.exam_type !== undefined) add('r.exam_type = :examType', 'examType', f.exam_type);
  if (f.result_status !== undefined) add('{statusExpr} = :rowStatus', 'rowStatus', f.result_status);
  if (f.gradeIsNull) sql += ' AND {gradeExpr} IS NULL';
  else if (f.grade !== undefined) add('{gradeExpr} = :rowGrade', 'rowGrade', f.grade);

  return sql;
}

/** Latest-attempt join + fragment for attempt = 'latest'. */
function buildAttemptFragment(f) {
  if (f.attempt !== 'latest') return { join: '', fragment: '' };
  return {
    join: `
  INNER JOIN (
    SELECT student_id, session_id, MAX(attempt_no) AS max_attempt_no
    FROM results
    GROUP BY student_id, session_id
  ) la ON la.student_id = r.student_id
      AND la.session_id = r.session_id
      AND r.attempt_no  = la.max_attempt_no
`,
    fragment: ' AND r.attempt_no = la.max_attempt_no'
  };
}

/**
 * Compose the subject-level query skeleton for the requested mode.
 * Returns null when the caller must short-circuit to an empty result.
 */
function buildSubjectQueryBase(f, resolved, params) {
  const attempt = buildAttemptFragment(f);

  let sql = SUBJECT_FROM + attempt.join;
  const sessionFragment = buildSessionFragment(resolved, params);
  if (sessionFragment === null) return null;

  // Joins must precede the WHERE clause.
  if (f.mode === 'effective') sql += EFFECTIVE_EVENT_JOIN;
  sql += ' WHERE 1 = 1' + sessionFragment + attempt.fragment;

  const rowFragment = buildRowFilterFragment(f, params);
  const statusExpr = f.mode === 'effective'
    ? 'COALESCE(eff.revised_status, sr.result_status)'
    : 'sr.result_status';
  const gradeExpr = f.mode === 'effective'
    ? 'COALESCE(eff.revised_grade, sr.grade)'
    : 'sr.grade';
  const marksExpr = f.mode === 'effective'
    ? 'COALESCE(eff.revised_marks, sr.marks)'
    : 'sr.marks';

  return {
    rowFragment,
    statusExpr,
    gradeExpr,
    marksExpr,
    // Completed WHERE clause with row filters folded in.
    whereSql: (sql + rowFragment)
      .replace(/\{statusExpr\}/g, `(${statusExpr})`)
      .replace(/\{gradeExpr\}/g, `(${gradeExpr})`)
  };
}

/** Validate and clamp pagination options. */
function pagination(options) {
  const o = options || {};
  const limit = toInt(o.limit);
  const offset = toInt(o.offset);
  return {
    limitSql: limit !== undefined ? ' LIMIT :limitValue' : '',
    offsetSql: offset !== undefined ? ' OFFSET :offsetValue' : '',
    params: {
      ...(limit !== undefined ? { limitValue: Math.min(limit, MAX_LIMIT) } : {}),
      ...(offset !== undefined ? { offsetValue: Math.max(offset, 0) } : {})
    }
  };
}

/** Execute a parameterized read-only SELECT. */
async function select(sql, params) {
  return sequelize.query(sql, { replacements: params || {}, type: QueryTypes.SELECT });
}

// ===========================================================================
// PUBLIC READ-ONLY REPOSITORY API
// ===========================================================================

/**
 * 1. resolveSessions(filters)
 * Exposed for the service layer so it can distinguish:
 *   - { scoped: false }          : no session filters -> unrestricted scope
 *   - { scoped, ids, empty:false}: use ids as the session scope
 *   - { scoped, ids: [], empty } : zero matching sessions -> NEVER unfilter
 */
async function resolveSessions(filters) {
  return resolveSessionsInternal(filters);
}

/**
 * 2. getSummary(filters)
 * Subject-level metrics use the ORIGINAL or EFFECTIVE subject values per
 * filters.mode. Parent-Result metrics are ALWAYS stored header values and are
 * returned under `parent` so the service never labels them as post-revaluation.
 * Effective mode additionally reports the count of subjects carrying more than
 * one approved+effective revaluation row (data anomaly detection; aggregates
 * themselves remain correct because the overlay is deduplicated).
 */
async function getSummary(filters) {
  const f = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(filters);
  const params = {};
  const base = buildSubjectQueryBase(f, resolved, params);
  if (base === null) {
    return {
      mode: f.mode,
      subject: emptySummarySubject(),
      parent: emptySummaryParent(),
      ...(f.mode === 'effective' ? { effectiveAnomalies: 0 } : {})
    };
  }

  const subjectRows = await select(`
    SELECT
      COUNT(DISTINCT r.student_id)                AS students,
      COUNT(DISTINCT r.result_id)                 AS results,
      COUNT(*)                                    AS subjectsAttempted,
      SUM(CASE WHEN ${base.statusExpr} = 'pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN ${base.statusExpr} = 'fail' THEN 1 ELSE 0 END) AS failed,
      AVG(${base.marksExpr})                      AS avgMarks,
      MAX(${base.marksExpr})                      AS maxMarks,
      MIN(${base.marksExpr})                      AS minMarks
    ${base.whereSql}
  `, params);

  // Stored parent Result header values (NOT effective/post-revaluation).
  const parentParams = {};
  let parentSql = `
    SELECT
      COUNT(*)                                                    AS resultTotal,
      SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END)   AS resultPassCount,
      SUM(CASE WHEN r.result_status = 'fail' THEN 1 ELSE 0 END)   AS resultFailCount,
      AVG(r.sgpa)                                                 AS avgSgpa,
      AVG(r.cgpa)                                                 AS avgCgpa
    FROM results r
    INNER JOIN result_sessions rs ON rs.session_id = r.session_id
  `;
  const sessionFragment = buildSessionFragment(resolved, parentParams);
  if (sessionFragment === null) return { mode: f.mode, subject: emptySummarySubject(), parent: emptySummaryParent(), ...(f.mode === 'effective' ? { effectiveAnomalies: 0 } : {}) };

  let whereParent = sessionFragment ? ' WHERE 1 = 1' + sessionFragment : ' WHERE 1 = 1';
  if (f.attempt === 'latest') {
    const attempt = buildAttemptFragment(f);
    parentSql += attempt.join;
    whereParent += attempt.fragment;
  }
  if (f.student_id !== undefined) {
    whereParent += ' AND r.student_id = :pStudentId';
    parentParams.pStudentId = f.student_id;
  }
  if (f.usn !== undefined) {
    parentSql += ' INNER JOIN students st ON st.student_id = r.student_id';
    whereParent += ' AND st.usn = :pUsn';
    parentParams.pUsn = f.usn;
  }
  if (f.attempt_no !== undefined) {
    whereParent += ' AND r.attempt_no = :pAttemptNo';
    parentParams.pAttemptNo = f.attempt_no;
  }
  if (f.exam_type !== undefined) {
    whereParent += ' AND r.exam_type = :pExamType';
    parentParams.pExamType = f.exam_type;
  }

  const parentRows = await select(parentSql + whereParent, parentParams);
  const summary = {
    mode: f.mode,
    subject: subjectRows[0] || emptySummarySubject(),
    parent: parentRows[0] || emptySummaryParent()
  };
  if (f.mode === 'effective') {
    summary.effectiveAnomalies = await countEffectiveAnomalies();
  }
  return summary;
}

function emptySummarySubject() {
  return {
    students: 0, results: 0, subjectsAttempted: 0,
    passed: 0, failed: 0, avgMarks: null, maxMarks: null, minMarks: null
  };
}

function emptySummaryParent() {
  return { resultTotal: 0, resultPassCount: 0, resultFailCount: 0, avgSgpa: null, avgCgpa: null };
}

/**
 * Data-quality check: subjects with MORE THAN ONE approved+effective
 * revaluation row. The schema does not enforce single-effective uniqueness;
 * the application maintains it. Aggregate queries remain safe (deduplicated
 * overlay) but the service should surface this count rather than hide it.
 */
async function countEffectiveAnomalies() {
  const rows = await select(`
    SELECT COUNT(*) AS anomalies
    FROM (
      SELECT rv.subject_result_id
      FROM revaluation_results rv
      WHERE rv.is_effective = 1 AND rv.revaluation_status = 'approved'
      GROUP BY rv.subject_result_id
      HAVING COUNT(*) > 1
    ) a
  `, {});
  return rows[0] ? Number(rows[0].anomalies) : 0;
}

/**
 * 3. getSubjectAnalytics(filters)
 * Grouped by subject. Subject-level values honor filters.mode (original vs
 * effective overlay). Returns raw aggregates plus per-subject grade counts
 * (NULL grades are preserved and reported as grade 'null' rows for the
 * service to label "Unknown" — no grade is ever inferred from marks).
 */
async function getSubjectAnalytics(filters) {
  const f = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(filters);
  const params = {};
  const base = buildSubjectQueryBase(f, resolved, params);
  if (base === null) return [];

  const rows = await select(`
    SELECT
      sub.subject_id                              AS subjectId,
      sub.subject_code                            AS subjectCode,
      sub.subject_name                            AS subjectName,
      COUNT(*)                                    AS attempted,
      SUM(CASE WHEN ${base.statusExpr} = 'pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN ${base.statusExpr} = 'fail' THEN 1 ELSE 0 END) AS failed,
      AVG(${base.marksExpr})                      AS avgMarks,
      MAX(${base.marksExpr})                      AS maxMarks,
      MIN(${base.marksExpr})                      AS minMarks
    ${base.whereSql}
    GROUP BY sub.subject_id, sub.subject_code, sub.subject_name
    ORDER BY sub.subject_code ASC, sub.subject_name ASC
  `, params);

  // Per-subject grade distribution over the SAME filtered row set, stitched
  // by subjectId in JS (bounded by subject count, not row count).
  const gradeRows = await select(`
    SELECT
      sub.subject_id AS subjectId,
      ${base.gradeExpr} AS grade,
      COUNT(*)      AS count
    ${base.whereSql}
    GROUP BY sub.subject_id, ${base.gradeExpr}
  `, params);

  const bySubject = new Map(rows.map((r) => [Number(r.subjectId), r]));
  for (const g of gradeRows) {
    const target = bySubject.get(Number(g.subjectId));
    if (target) {
      if (!target.gradeCounts) target.gradeCounts = {};
      const key = g.grade === null || g.grade === undefined ? 'null' : String(g.grade);
      target.gradeCounts[key] = Number(g.count);
    }
  }
  return rows;
}

/**
 * 4. getGradeDistribution(filters)
 * Global grade distribution over stored/effective subject grades.
 * NULL grade rows are returned with grade: null (service maps to "Unknown").
 */
async function getGradeDistribution(filters) {
  const f = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(filters);
  const params = {};
  const base = buildSubjectQueryBase(f, resolved, params);
  if (base === null) return [];

  const rows = await select(`
    SELECT
      ${base.gradeExpr} AS grade,
      COUNT(*)          AS count
    ${base.whereSql}
    GROUP BY ${base.gradeExpr}
  `, params);
  // only_full_group_by-safe ordering done in JS: NULL grades first, then ASC.
  // Row count is bounded by distinct grades, not by result rows.
  rows.sort((a, b) => {
    if (a.grade === null && b.grade === null) return 0;
    if (a.grade === null) return -1;
    if (b.grade === null) return 1;
    return String(a.grade).localeCompare(String(b.grade));
  });
  return rows;
}

/**
 * 5. getSemesterAnalytics(filters)
 * Grouped by ResultSession. Subject-level pass/fail honor filters.mode;
 * sgpa/cgpa/result pass-fail are STORED parent header values (clearly separate
 * fields, never post-revaluation values).
 */
async function getSemesterAnalytics(filters) {
  const f = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(filters);
  const params = {};
  const base = buildSubjectQueryBase(f, resolved, params);
  if (base === null) return [];

  return select(`
    SELECT
      rs.session_id        AS sessionId,
      rs.exam_year         AS examYear,
      rs.semester          AS semester,
      rs.exam_session      AS examSession,
      rs.batch_id          AS batchId,
      b.batch_name         AS batchName,
      COUNT(DISTINCT r.result_id)  AS resultCount,
      SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END) AS resultPassCount,
      SUM(CASE WHEN r.result_status = 'fail' THEN 1 ELSE 0 END) AS resultFailCount,
      AVG(r.sgpa)          AS avgSgpa,
      AVG(r.cgpa)          AS avgCgpa,
      COUNT(*)             AS subjectAttempts,
      SUM(CASE WHEN ${base.statusExpr} = 'pass' THEN 1 ELSE 0 END) AS subjectPassed,
      SUM(CASE WHEN ${base.statusExpr} = 'fail' THEN 1 ELSE 0 END) AS subjectFailed,
      AVG(${base.marksExpr}) AS avgMarks
    ${base.whereSql}
    GROUP BY rs.session_id, rs.exam_year, rs.semester, rs.exam_session, rs.batch_id,
             b.batch_name
    ORDER BY rs.exam_year ASC, rs.semester ASC, rs.exam_session ASC
  `, params);
}

/**
 * 6. getStudentAnalytics(filters, options)
 * One row per stored Result (student x session x attempt) with subject-level
 * aggregates honoring filters.mode. sgpa/cgpa/parentStatus are STORED values.
 * Supports limit/offset pagination options.
 */
async function getStudentAnalytics(filters, options) {
  const f = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(filters);
  const params = {};
  const base = buildSubjectQueryBase(f, resolved, params);
  if (base === null) return [];
  const page = pagination(options);

  return select(`
    SELECT
      st.student_id       AS studentId,
      st.usn              AS usn,
      st.student_name     AS studentName,
      r.result_id         AS resultId,
      r.session_id        AS sessionId,
      rs.exam_year        AS examYear,
      rs.semester         AS semester,
      r.attempt_no        AS attemptNo,
      r.exam_type         AS examType,
      r.sgpa              AS sgpa,
      r.cgpa              AS cgpa,
      r.result_status     AS parentStatus,
      COUNT(*)            AS subjectsAttempted,
      SUM(CASE WHEN ${base.statusExpr} = 'pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN ${base.statusExpr} = 'fail' THEN 1 ELSE 0 END) AS failed,
      AVG(${base.marksExpr}) AS avgMarks
    ${base.whereSql}
    GROUP BY st.student_id, st.usn, st.student_name, r.result_id, r.session_id,
             rs.exam_year, rs.semester, r.attempt_no, r.exam_type, r.sgpa,
             r.cgpa, r.result_status
    ORDER BY st.usn ASC, rs.exam_year ASC, rs.semester ASC, r.attempt_no ASC
    ${page.limitSql}${page.offsetSql}
  `, { ...params, ...page.params });
}

/**
 * 7. getTopStudents(filters, options)
 * Candidate rows for topper analytics. NO ranking policy is applied here:
 * the repository deliberately returns every aggregate the service may need
 * (stored SGPA, stored CGPA, subject aggregates, attempts, exam type) so a
 * business-approved topper policy can be applied later. Callers must paginate
 * with limit/offset; nothing is silently deduplicated across attempts.
 */
async function getTopStudents(filters, options) {
  return getStudentAnalytics(filters, options);
}

/**
 * 8. getFailedStudents(filters, options)
 * Finalized SUBJECT-LEVEL failures. Original mode filters
 * sr.result_status='fail'; effective mode filters the effective subject
 * status expression. When an approved+effective overlay exists, original vs
 * revised marks/status are returned alongside so provenance is auditable.
 * "Currently failed / unresolved backlog" semantics are NOT defined here.
 */
async function getFailedStudents(filters, options) {
  const f = normalizeFilters(filters);
  const fFail = { ...filters, result_status: 'fail' };
  const fNorm = normalizeFilters(fFail);
  const resolved = await resolveSessionsInternal(fFail);
  const params = {};
  const base = buildSubjectQueryBase(fNorm, resolved, params);
  if (base === null) return [];
  const page = pagination(options);

  const overlaySelect = f.mode === 'effective'
    ? `sr.marks        AS originalMarks,
       sr.grade        AS originalGrade,
       sr.result_status AS originalStatus,
       eff.revised_marks  AS revisedMarks,
       eff.revised_grade  AS revisedGrade,
       eff.revised_status AS revisedStatus,
       (eff.revaluation_id IS NOT NULL) AS hadEffectiveRevaluation,`
    : '';

  return select(`
    SELECT
      st.student_id       AS studentId,
      st.usn              AS usn,
      st.student_name     AS studentName,
      sr.subject_result_id AS subjectResultId,
      sub.subject_id      AS subjectId,
      sub.subject_code    AS subjectCode,
      sub.subject_name    AS subjectName,
      ${base.marksExpr}   AS marks,
      ${base.gradeExpr}   AS grade,
      ${base.statusExpr}  AS resultStatus,
      ${overlaySelect}
      r.result_id         AS resultId,
      r.session_id        AS sessionId,
      rs.exam_year        AS examYear,
      rs.semester         AS semester,
      r.attempt_no        AS attemptNo,
      r.exam_type         AS examType
    ${base.whereSql}
    ORDER BY st.usn ASC, rs.exam_year ASC, rs.semester ASC, sub.subject_code ASC
    ${page.limitSql}${page.offsetSql}
  `, { ...params, ...page.params });
}

/**
 * 9. getRevaluationAnalytics(filters)
 * Raw revaluation ledger analytics.
 *
 * OUTCOME metrics use ONLY approved + effective rows:
 *   cases, subjectsWithRevaluation, statusChanges, failToPass, passToFail,
 *   positiveDelta, unchanged, negativeDelta, averageDelta, maxDelta, minDelta
 * delta = revised_marks - original_marks, reported with NEUTRAL semantics
 * (never labeled "improvement").
 *
 * PIPELINE counts are RAW LEDGER ROW COUNTS grouped by revaluation_status.
 * They count persisted RevaluationResult rows only and do NOT claim to
 * represent real-world revaluation applications.
 *
 * Also reports effectiveOverlaySubjects / effectiveAnomalies for integrity.
 */
async function getRevaluationAnalytics(filters) {
  const resolved = await resolveSessionsInternal(filters);

  // Outcome metrics always require the effective overlay, regardless of the
  // requested reporting mode: they describe the approved+effective events.
  // The filtered subject-row scope matches every other subject analytics query.
  const outcomeFilters = { ...filters, mode: 'effective' };
  const outcomeParams = {};
  const outcomeBase = buildSubjectQueryBase(normalizeFilters(outcomeFilters), resolved, outcomeParams);
  if (outcomeBase === null) {
    return {
      outcomes: emptyRevalOutcomes(),
      pipeline: [],
      integrity: { effectiveOverlaySubjects: 0, effectiveAnomalies: 0 }
    };
  }

  const outcomeRows = await select(`
    SELECT
      COUNT(*)                                                    AS cases,
      COUNT(DISTINCT sr.subject_result_id)                        AS subjectsWithRevaluation,
      SUM(CASE WHEN eff.original_status <> eff.revised_status THEN 1 ELSE 0 END) AS statusChanges,
      SUM(CASE WHEN eff.original_status = 'fail' AND eff.revised_status = 'pass' THEN 1 ELSE 0 END) AS failToPass,
      SUM(CASE WHEN eff.original_status = 'pass' AND eff.revised_status = 'fail' THEN 1 ELSE 0 END) AS passToFail,
      SUM(CASE WHEN eff.revised_marks > eff.original_marks THEN 1 ELSE 0 END)  AS positiveDelta,
      SUM(CASE WHEN eff.revised_marks = eff.original_marks THEN 1 ELSE 0 END)  AS unchanged,
      SUM(CASE WHEN eff.revised_marks < eff.original_marks THEN 1 ELSE 0 END)  AS negativeDelta,
      AVG(eff.revised_marks - eff.original_marks)                 AS averageDelta,
      MAX(eff.revised_marks - eff.original_marks)                 AS maxDelta,
      MIN(eff.revised_marks - eff.original_marks)                 AS minDelta
    ${outcomeBase.whereSql}
      AND eff.revaluation_id IS NOT NULL
  `, outcomeParams);

  // Raw pipeline/ledger counts (per persisted row, any status).
  const pipelineParams = {};
  let pipelineSql = `
    SELECT rv.revaluation_status AS revaluationStatus, COUNT(*) AS rowCount
    FROM revaluation_results rv
  `;
  const sessionFragment = buildSessionFragment(resolved, pipelineParams);
  if (sessionFragment === null) {
    return {
      outcomes: emptyRevalOutcomes(),
      pipeline: [],
      integrity: { effectiveOverlaySubjects: 0, effectiveAnomalies: 0 }
    };
  }
  pipelineSql += `
    INNER JOIN subject_results sr2 ON sr2.subject_result_id = rv.subject_result_id
    INNER JOIN results r2          ON r2.result_id = sr2.result_id
    INNER JOIN result_sessions rs  ON rs.session_id = r2.session_id
    WHERE 1 = 1${sessionFragment}
    GROUP BY rv.revaluation_status
    ORDER BY rv.revaluation_status ASC
  `;

  const pipelineRows = await select(pipelineSql, pipelineParams);
  const integrity = await getEffectiveIntegrity();

  return {
    outcomes: outcomeRows[0] || emptyRevalOutcomes(),
    pipeline: pipelineRows.map((p) => ({
      revaluationStatus: p.revaluationStatus,
      rowCount: Number(p.rowCount)
    })),
    integrity
  };
}

function emptyRevalOutcomes() {
  return {
    cases: 0, subjectsWithRevaluation: 0, statusChanges: 0,
    failToPass: 0, passToFail: 0,
    positiveDelta: 0, unchanged: 0, negativeDelta: 0,
    averageDelta: null, maxDelta: null, minDelta: null
  };
}

/**
 * Effective-overlay integrity snapshot (safe for scheduled/audit use):
 *   - effectiveOverlaySubjects: subjects with >= 1 approved+effective row
 *   - effectiveAnomalies: subjects with > 1 approved+effective row
 */
async function getEffectiveIntegrity() {
  const rows = await select(`
    SELECT
      COUNT(*) AS effectiveOverlaySubjects,
      SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) AS effectiveAnomalies
    FROM (
      SELECT subject_result_id, COUNT(*) AS cnt
      FROM revaluation_results
      WHERE is_effective = 1 AND revaluation_status = 'approved'
      GROUP BY subject_result_id
    ) t
  `, {});
  const r = rows[0] || {};
  return {
    effectiveOverlaySubjects: Number(r.effectiveOverlaySubjects || 0),
    effectiveAnomalies: Number(r.effectiveAnomalies || 0)
  };
}

/**
 * 10. getFilterOptions(scope, parentFilters)
 * Cascading filter options. Every scope respects the parent filters via the
 * SAME resolveSessions pipeline, so options never include unrelated records:
 *   years      -> distinct exam_year in scope
 *   semesters  -> distinct semester in scope (year/dept/batch applied)
 *   departments-> departments having scoped sessions
 *   batches    -> batches having scoped sessions (dept applied)
 *   sessions   -> session rows (id + labels) in scope
 *   subjects   -> subjects within scoped sessions
 * Returns [] for unknown scopes (allowlisted).
 */
async function getFilterOptions(scope, parentFilters) {
  const scopeKey = allowlisted(scope, FILTER_SCOPES);
  if (!scopeKey) return [];

  const resolved = await resolveSessionsInternal(parentFilters);
  const params = {};
  const sessionFragment = buildSessionFragment(resolved, params);
  if (sessionFragment === null) return [];
  const whereSessions = sessionFragment ? ' WHERE 1 = 1' + sessionFragment : ' WHERE 1 = 1';

  switch (scopeKey) {
    case 'years':
      return select(`
        SELECT DISTINCT rs.exam_year AS examYear
        FROM result_sessions rs
        ${whereSessions}
        ORDER BY rs.exam_year DESC
      `, params);

    case 'semesters':
      return select(`
        SELECT DISTINCT rs.semester AS semester
        FROM result_sessions rs
        ${whereSessions}
        ORDER BY rs.semester ASC
      `, params);

    case 'departments':
      return select(`
        SELECT DISTINCT d.department_id AS departmentId, d.department_code AS code,
               d.department_name AS name
        FROM result_sessions rs
        INNER JOIN batches b      ON b.batch_id      = rs.batch_id
        INNER JOIN departments d  ON d.department_id = b.department_id
        ${whereSessions}
        ORDER BY d.department_code ASC
      `, params);

    case 'batches':
      return select(`
        SELECT DISTINCT b.batch_id AS batchId, b.batch_name AS batchName,
               b.start_year AS startYear, b.end_year AS endYear,
               b.department_id AS departmentId
        FROM result_sessions rs
        INNER JOIN batches b ON b.batch_id = rs.batch_id
        ${whereSessions}
        ORDER BY b.start_year DESC, b.batch_name ASC
      `, params);

    case 'sessions':
      return select(`
        SELECT rs.session_id AS sessionId, rs.exam_year AS examYear,
               rs.semester AS semester, rs.exam_session AS examSession,
               rs.batch_id AS batchId, b.batch_name AS batchName,
               d.department_id AS departmentId, d.department_code AS departmentCode
        FROM result_sessions rs
        INNER JOIN batches b     ON b.batch_id      = rs.batch_id
        INNER JOIN departments d ON d.department_id = b.department_id
        ${whereSessions}
        ORDER BY rs.exam_year DESC, rs.semester ASC, rs.exam_session ASC
      `, params);

    case 'subjects':
      return select(`
        SELECT sub.subject_id AS subjectId, sub.subject_code AS subjectCode,
               sub.subject_name AS subjectName, sub.credits AS credits,
               sub.max_marks AS maxMarks, sub.session_id AS sessionId
        FROM subjects sub
        INNER JOIN result_sessions rs ON rs.session_id = sub.session_id
        ${whereSessions}
        ORDER BY sub.subject_code ASC
      `, params);

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Revaluation by-subject outcomes (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Per-subject effective revaluation outcome rollup.
 * Uses the same approved+effective deduplicated overlay as
 * getRevaluationAnalytics, grouped by subject.
 */
async function getRevaluationBySubject(filters) {
  const normalized = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(normalized);
  const params = {};
  const sessionFragment = buildSessionFragment(resolved, params);

  if (sessionFragment === null) {
    return { bySubject: [] };
  }

  const sql = `
    SELECT
      sub.subject_name   AS subjectName,
      sub.subject_code   AS subjectCode,
      COUNT(DISTINCT sr.subject_result_id) AS cases,
      COUNT(DISTINCT sr.subject_result_id) AS subjectsWithRevaluation,
      SUM(CASE WHEN eff.revised_status != eff.original_status THEN 1 ELSE 0 END) AS statusChanges,
      SUM(CASE WHEN eff.original_status = 'fail' AND eff.revised_status = 'pass' THEN 1 ELSE 0 END) AS failToPass,
      SUM(CASE WHEN eff.original_status = 'pass' AND eff.revised_status = 'fail' THEN 1 ELSE 0 END) AS passToFail,
      SUM(CASE WHEN eff.revised_marks > eff.original_marks THEN 1 ELSE 0 END) AS positiveDelta,
      SUM(CASE WHEN eff.revised_marks = eff.original_marks THEN 1 ELSE 0 END) AS unchanged,
      SUM(CASE WHEN eff.revised_marks < eff.original_marks THEN 1 ELSE 0 END) AS negativeDelta,
      AVG(eff.revised_marks - eff.original_marks) AS averageDelta,
      MAX(eff.revised_marks - eff.original_marks) AS maxDelta,
      MIN(eff.revised_marks - eff.original_marks) AS minDelta
    ${SUBJECT_FROM}
    ${EFFECTIVE_EVENT_JOIN}
    WHERE 1 = 1
      ${sessionFragment}
      AND eff.revaluation_id IS NOT NULL
    GROUP BY sub.subject_id, sub.subject_name, sub.subject_code
    ORDER BY sub.subject_code ASC
  `;

  const rows = await select(sql, params);
  return { bySubject: rows };
}

// ---------------------------------------------------------------------------
// Revaluation event detail (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Individual approved+effective revaluation event rows with student/subject
 * context. Pending/rejected rows are excluded; only the deduplicated latest
 * effective event per subject_result is returned (same rule as the aggregate).
 */
async function getRevaluationDetail(filters) {
  const normalized = normalizeFilters(filters);
  const resolved = await resolveSessionsInternal(normalized);
  const params = {};
  const sessionFragment = buildSessionFragment(resolved, params);

  if (sessionFragment === null) {
    return { detail: [] };
  }

  const sql = `
    SELECT
      sub.subject_name         AS subjectName,
      sub.subject_code         AS subjectCode,
      st.usn                   AS usn,
      st.student_name          AS studentName,
      rv.revaluation_id        AS caseId,
      rv.remarks               AS caseDescription,
      rv.original_marks        AS originalMarks,
      rv.revised_marks        AS revisedMarks,
      (rv.revised_marks - rv.original_marks) AS delta,
      rv.original_status       AS originalStatus,
      rv.revised_status       AS revisedStatus,
      rv.revaluation_status    AS validationStatus,
      rv.file_name             AS sourceFile,
      rv.remarks               AS remarkSummary,
      'revaluation'            AS eventProvenance
    FROM revaluation_results rv
    INNER JOIN (
      SELECT subject_result_id, MAX(revaluation_no) AS max_no
      FROM revaluation_results
      WHERE is_effective = 1 AND revaluation_status = 'approved'
      GROUP BY subject_result_id
    ) pick ON pick.subject_result_id = rv.subject_result_id
           AND pick.max_no = rv.revaluation_no
    INNER JOIN subject_results sr ON sr.subject_result_id = rv.subject_result_id
    INNER JOIN results r          ON r.result_id         = sr.result_id
    INNER JOIN result_sessions rs ON rs.session_id       = r.session_id
    INNER JOIN students st        ON st.student_id       = r.student_id
    INNER JOIN subjects sub       ON sub.subject_id      = sr.subject_id
    WHERE rv.is_effective = 1 AND rv.revaluation_status = 'approved'
      ${sessionFragment}
    ORDER BY sub.subject_code ASC, st.usn ASC
  `;

  const rows = await select(sql, params);
  return { detail: rows };
}

// ---------------------------------------------------------------------------
// Exports (READ-ONLY API)
// ---------------------------------------------------------------------------

module.exports = {
  resolveSessions,
  getSummary,
  getSubjectAnalytics,
  getSemesterAnalytics,
  getStudentAnalytics,
  getGradeDistribution,
  getTopStudents,
  getFailedStudents,
  getRevaluationAnalytics,
  getRevaluationBySubject,
  getRevaluationDetail,
  getFilterOptions,
  getEffectiveIntegrity
};
