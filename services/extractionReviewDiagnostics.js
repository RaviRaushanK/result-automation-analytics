'use strict';

const integrity = require('./academicIntegrity');

// Only these known, intermediate-stage messages can be downgraded. Unknown
// warnings and disagreements always remain prominent, even with filled marks.
const stageWarning = /^(Text OCR|Vision reading) was incomplete or unavailable on some pages\. (?:Verify the extracted rows against the card\.|Other extraction stages may still have recovered usable data; this warning does not mean the displayed values are incorrect\. Compare the extracted subject rows and marks with the original card\.)$/;
const hasValue = value => value !== '' && value !== null && value !== undefined;
const isIntermediateWarning = warning => typeof warning === 'string' && stageWarning.test(warning);

function classify({ saved, subjects, warnings = [], retake = false, hasUnresolvedFields = false, documentChecks = [] }) {
  warnings = [...new Set([...warnings, ...(saved.extraction_diagnostics?.intermediate_warnings || [])])];
  const savedRows = new Map((saved.subjects || []).map(row => [String(row.subject_id), row]));
  const selected = retake ? subjects.filter(row => {
    const original = savedRows.get(String(row.subject_id));
    return original?.found_on_card || hasValue(row.internalMarks) || hasValue(row.externalMarks);
  }) : subjects;
  const complete = selected.length > 0 && selected.every(row => {
    const original = savedRows.get(String(row.subject_id));
    const internal = integrity.mark(row.internalMarks), external = integrity.mark(row.externalMarks);
    return original?.found_on_card === true && original.confidence === 'high'
      && internal.present && !internal.invalid && external.present && !external.invalid
      && internal.value <= Number(row.max_internal) && external.value <= Number(row.max_external)
      && internal.value + external.value <= Number(row.max_marks);
  });
  const source = saved.extraction_diagnostics;
  const recovered = complete && !hasUnresolvedFields
    && !(saved.integrity_conflicts || []).length && !(saved.excluded_subjects || []).length
    && !documentChecks.some(check => check.status === 'MISMATCH')
    && (!source || (!source.unresolved_subject_data && source.source_subject_count === selected.length))
    // A retake has no full roster requirement. Without source coverage evidence,
    // an old partial draft cannot prove that every attempted row was recovered.
    && (!retake || !!source)
    && warnings.every(warning => typeof warning === 'string' && stageWarning.test(warning));
  const diagnostics = [], prominent = [];
  for (const warning of warnings) {
    const match = typeof warning === 'string' && warning.match(stageWarning);
    if (recovered && match) diagnostics.push({ severity: 'info', status: 'recovered', stage: match[1],
      message: 'One extraction stage was incomplete, but the final subject data was recovered successfully using another extraction stage.',
      original_message: warning });
    else prominent.push(warning);
  }
  return { warnings: prominent, diagnostics };
}

function capture(extraction) {
  return {
    stages: extraction.stages || null,
    intermediate_warnings: (extraction.warnings || []).filter(isIntermediateWarning),
    source_subject_count: (extraction.subjects || []).length,
    unresolved_subject_data: (extraction.subjects || []).some(row =>
      [row.internalMarks, row.externalMarks].some(value => {
        const mark = integrity.mark(value);
        return !mark.present || mark.invalid;
      }) || !row.result || row.marksValidated === false)
  };
}

module.exports = { classify, capture, isIntermediateWarning };
