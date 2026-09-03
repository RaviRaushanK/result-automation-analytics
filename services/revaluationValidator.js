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
  if (raw === null || raw === undefined || raw === '') return { present: false, invalid: false, value: null };
  const n = Number(raw);
  if (isNaN(n) || !Number.isFinite(n)) return { present: true, invalid: true, value: null };
  return { present: true, invalid: false, value: Math.floor(n) };
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

function validateFinalConsistency(finalMarks, finalResult, maxTotal) {
  const errors = [], warnings = [];
  const threshold = passThreshold(maxTotal);
  if (finalMarks !== null && finalResult) {
    if (finalResult === 'pass' && finalMarks < threshold)
      errors.push('Final Result is "pass" but Final Marks (' + finalMarks + ') are below the pass threshold (' + threshold + ' for max ' + maxTotal + ').');
    else if (finalResult === 'fail' && finalMarks >= threshold)
      warnings.push('Final Result is "fail" but Final Marks (' + finalMarks + ') meet the pass threshold (' + threshold + '). Verify the result on the document.');
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validateOldConsistency(oldMarks, oldResult, maxExt) {
  const errors = [], warnings = [];
  const threshold = passThreshold(maxExt || 100);
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
  const maxInt   = Number(subject.max_internal_marks) || Math.ceil(maxTotal * 0.5);
  const maxExt   = Number(subject.max_external_marks) || maxTotal;
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
    maxExt
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
  if (!frR.ok) errors.push(frR.error);

  if (fm.present && !fm.invalid && fm.value >= 0 && card.card_final_result) {
    const finConsistency = validateFinalConsistency(
      fm.value,
      String(card.card_final_result).trim().toLowerCase(),
      maxTotal
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
function validateOcrCardFields(ocrRow, subject) {
  ocrRow = ocrRow || {};
  subject = subject || {};
  const maxTotal = Number(subject.max_marks) || 100;
  const maxInt   = Number(subject.max_internal_marks) || Math.ceil(maxTotal * 0.5);
  const maxExt   = Number(subject.max_external_marks) || maxTotal;
  const errors = [], warnings = [];

  const getNum = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return isNaN(n) ? null : Math.floor(n);
  };

  // internalMarks
  const im = getNum(
    ocrRow.internalMarks !== undefined ? ocrRow.internalMarks : ocrRow.revised_internal_marks
  );
  if (im !== null) {
    if (im < 0) errors.push('Internal Marks cannot be negative.');
    else if (im > maxInt) errors.push('Internal Marks must not exceed ' + maxInt + '.');
  }

  // oldMarks
  const om = getNum(
    ocrRow.oldMarks !== undefined ? ocrRow.oldMarks : ocrRow.original_marks
  );
  if (om !== null) {
    if (om < 0) errors.push('Old Marks cannot be negative.');
    else if (om > maxExt) errors.push('Old Marks must not exceed ' + maxExt + '.');
  }

  // oldResult
  const or = ocrRow.oldResult || ocrRow.original_status || null;
  if (or) {
    const r = validateCardResult('Old Result', or);
    if (!r.ok) errors.push(r.error);
    const oldConsistency = validateOldConsistency(om, or, maxExt);
    warnings.push(...oldConsistency.warnings);
  }

  // rvMarks (optional)
  const rm = getNum(ocrRow.rvMarks);
  if (rm !== null) {
    if (rm < 0) errors.push('RV Marks cannot be negative.');
    else if (rm > maxExt) errors.push('RV Marks must not exceed ' + maxExt + '.');
  }

  // rvResult (optional)
  const rr = ocrRow.rvResult || null;
  if (rr) {
    const r = validateCardResult('RV Result', rr);
    if (!r.ok) errors.push(r.error);
  }

  // finalMarks (REQUIRED)
  const fm = getNum(
    ocrRow.finalMarks !== undefined ? ocrRow.finalMarks : ocrRow.revised_marks
  );
  if (fm === null) errors.push('Final Marks are required.');
  else {
    if (fm < 0) errors.push('Final Marks cannot be negative.');
    else if (fm > maxTotal) errors.push('Final Marks must not exceed ' + maxTotal + '.');
  }

  // finalResult (REQUIRED)
  const fr = ocrRow.finalResult || ocrRow.revised_status_candidate || null;
  if (!fr) errors.push('Final Result is required.');
  else {
    const r = validateCardResult('Final Result', fr);
    if (!r.ok) errors.push(r.error);
    if (fm !== null && !errors.some(e => e.indexOf('Final Marks') !== -1)) {
      const finConsistency = validateFinalConsistency(fm, fr, maxTotal);
      errors.push(...finConsistency.errors);
      warnings.push(...finConsistency.warnings);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
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
