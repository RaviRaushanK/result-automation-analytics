/**
 * services/revaluationValidator.js
 *
 * Phase 5 — Server-Side Validation (Revaluation Nine-Column Semantics)
 *
 * Provides reusable, stateless validation helpers for revaluation card fields.
 * Each of the nine canonical fields is validated independently:
 *   internalMarks, oldMarks, oldResult, rvMarks, rvResult, finalMarks, finalResult
 *
 * Design principles:
 * - Marks are validated for numeric type and range (0–subject.max_marks or component limit).
 * - Result codes are validated against the ENUM('pass','fail') domain.
 * - Cross-field consistency is checked (finalResult ↔ finalMarks, oldResult ↔ oldMarks).
 * - No totals are computed from dependent fields — internal + oldMarks ≠ finalMarks.
 */
'use strict';

function normalizeMark(raw) {
  return require('./academicIntegrity').mark(raw);
}

function passThreshold(maxTotal) {
  const m = Number(maxTotal) || 100;
  return Math.ceil(m * 0.4);
}

function validateCardMarks(fieldName, rawValue, maxValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return { ok: true, error: null };
  const n = normalizeMark(rawValue);
  if (!n.present) return { ok: true, error: null };
  if (n.invalid) return { ok: false, error: fieldName + ' must be a whole number.' };
  if (n.value < 0) return { ok: false, error: fieldName + ' cannot be negative.' };
  if (n.value > maxValue) return { ok: false, error: fieldName + ' must not exceed ' + maxValue + '.' };
  return { ok: true, error: null };
}

function validateCardResult(fieldName, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return { ok: true, error: null };
  const v = String(rawValue).trim().toLowerCase();
  if (v !== 'pass' && v !== 'fail') return { ok: false, error: fieldName + ' must be "pass" or "fail".' };
  return { ok: true, error: null };
}

function validateFinalConsistency(finalMarks, finalResult, maxTotal, components) {
  const errors = [], warnings = [];
  const threshold = Math.ceil((Number(maxTotal) || 100) * 0.5);
  if (finalMarks !== null && finalResult) {
    if (finalResult === 'pass' && finalMarks < threshold)
      errors.push('Final Result is "pass" but Final Marks (' + finalMarks + ') are below the pass threshold (' + threshold + ' for max ' + maxTotal + ').');
    // A total above 50% can still FAIL a component. Never infer PASS from it.
    if (components) {
      const policy = require('./academicPolicy');
      const outcome = policy.gradeFromComponents(components.internal, components.external, components.subject);
      if (outcome.status !== finalResult) errors.push('Final Result does not match the MCA CIE, SEE and combined passing requirements. Verify the component marks and document result.');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validateOldConsistency(oldMarks, oldResult, maxExt, subjectType) {
  const errors = [], warnings = [];
  const threshold = require('./academicPolicy').passRules.thresholds({ subject_type: subjectType, max_external: maxExt || 100 }).external;
  if (oldMarks !== null && oldResult) {
    if (oldResult === 'pass' && oldMarks < threshold)
      warnings.push('Old Result is "pass" but Old Marks (' + oldMarks + ') are below the pass threshold (' + threshold + ' for max ' + maxExt + '). Verify the document.');
    else if (oldResult === 'fail' && oldMarks >= threshold)
      warnings.push('Old Result is "fail" but Old Marks (' + oldMarks + ') meet the pass threshold (' + threshold + '). Verify the document.');
  }
  return { ok: true, errors, warnings };
}

/**
 * Validate all nine canonical card fields for a single subject.
 * @param {Object} card   Form/body fields:
 *   card_internal_marks, card_old_marks, card_old_result,
 *   card_rv_marks, card_rv_result,
 *   card_final_marks, card_final_result
 * @param {Object} subject  Subject row with mark ceilings:
 *   { max_marks, max_internal_marks, max_external_marks }
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validateNineCardFields(card, subject) {
  card = card || {};
  subject = subject || {};
  const maxTotal = Number(subject.max_marks) || 100;
  const maxInt   = Number(subject.max_internal ?? subject.max_internal_marks ?? Math.ceil(maxTotal * 0.5));
  const maxExt   = Number(subject.max_external ?? subject.max_external_marks ?? maxTotal);
  const errors = [], warnings = [];

  // internalMarks (optional)
  const im = normalizeMark(card.card_internal_marks);
  if (im.present) {
    if (im.invalid) errors.push('Internal Marks must be a whole number.');
    else if (im.value < 0) errors.push('Internal Marks cannot be negative.');
    else if (im.value > maxInt) errors.push('Internal Marks must not exceed ' + maxInt + '.');
  }

  // oldMarks (optional)
  const om = normalizeMark(card.card_old_marks);
  if (om.present) {
    if (om.invalid) errors.push('Old Marks must be a whole number.');
    else if (om.value < 0) errors.push('Old Marks cannot be negative.');
    else if (om.value > maxExt) errors.push('Old Marks must not exceed ' + maxExt + '.');
  }

  // oldResult (optional)
  const orR = validateCardResult('Old Result', card.card_old_result);
  if (!orR.ok) errors.push(orR.error);

  const oldConsistency = validateOldConsistency(
    om.present ? om.value : null,
    card.card_old_result ? String(card.card_old_result).trim().toLowerCase() : null,
    maxExt, subject.subject_type
  );
  warnings.push(...oldConsistency.warnings);

  // rvMarks (optional)
  const rm = normalizeMark(card.card_rv_marks);
  if (rm.present) {
    if (rm.invalid) errors.push('RV Marks must be a whole number.');
    else if (rm.value < 0) errors.push('RV Marks cannot be negative.');
    else if (rm.value > maxExt) errors.push('RV Marks must not exceed ' + maxExt + '.');
  }

  // rvResult (optional)
  const rrR = validateCardResult('RV Result', card.card_rv_result);
  if (!rrR.ok) errors.push(rrR.error);

  // finalMarks (REQUIRED)
  const fm = normalizeMark(card.card_final_marks);
  if (!fm.present) errors.push('Final Marks are required.');
  else if (fm.invalid) errors.push('Final Marks must be a whole number.');
  else if (fm.value < 0) errors.push('Final Marks cannot be negative.');
  else if (fm.value > maxTotal) errors.push('Final Marks must not exceed ' + maxTotal + '.');

  // finalResult (REQUIRED)
  const frR = validateCardResult('Final Result', card.card_final_result);
  if (!card.card_final_result) errors.push('Final Result is required.');
  if (!frR.ok) errors.push(frR.error);

  if (fm.present && !fm.invalid && fm.value >= 0 && card.card_final_result) {
    const finConsistency = validateFinalConsistency(
      fm.value,
      String(card.card_final_result).trim().toLowerCase(),
      maxTotal,
      im.present && !im.invalid && rm.present && !rm.invalid ? { internal: im.value, external: rm.value,
        subject: { subject_type: subject.subject_type, max_internal: maxInt, max_external: maxExt, max_marks: maxTotal } } : null
    );
    errors.push(...finConsistency.errors);
    warnings.push(...finConsistency.warnings);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate nine card fields sourced from an OCR-extracted row.
 * Used in submitReview / approveReview to re-validate OCR data server-side.
 * Handles both Phase 1 names (internalMarks, oldMarks, …) and legacy extractor names
 * (revised_internal_marks, original_marks, revised_marks, revised_status_candidate).
 * @param {Object} ocrRow  extracted_json.ocr.subjects or ocr.missing_subjects entry
 * @param {Object} subject Subject row with mark ceilings
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validateOcrCardFields(row = {}, subject = {}) {
  return validateNineCardFields({
    card_internal_marks: row.internalMarks ?? row.revised_internal_marks,
    card_old_marks: row.oldMarks,
    card_old_result: row.oldResult,
    card_rv_marks: row.rvMarks ?? row.revised_external_marks,
    card_rv_result: row.rvResult,
    card_final_marks: row.finalMarks ?? row.revised_marks,
    card_final_result: row.finalResult ?? row.revised_status_candidate
  }, subject);
}

module.exports = {
  validateNineCardFields,
  validateOcrCardFields,
  validateCardMarks,
  validateCardResult,
  validateFinalConsistency,
  validateOldConsistency,
  passThreshold,
  normalizeMark
};
