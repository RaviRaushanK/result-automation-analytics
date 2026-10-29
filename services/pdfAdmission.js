'use strict';

// Upload admission policy, independent of the renderer's configurable limits.
const MAX_SCANNED_PDF_PAGES = 3;
const CODE = 'LONG_SCANNED_PDF_REQUIRES_TEXT_LAYER';
const TITLE = 'Selectable/OCR text required';
const SCOPE_CODE = 'PDF_SUBJECT_SCOPE_MISMATCH';
const SCOPE_TITLE = 'Check the selected exam session';
const MESSAGE = [
  'This PDF has more than 3 pages, but a usable selectable/OCR result-table text layer could not be read.',
  'For PDFs longer than 3 pages, please upload a PDF with selectable/OCR text.',
  'Image-only scanned PDFs are currently supported up to 3 pages.'
].join('\n\n');

class LongPdfTextRequiredError extends Error {
  constructor(pageCount) {
    super(MESSAGE);
    this.name = 'LongPdfTextRequiredError';
    this.code = CODE;
    this.pageCount = pageCount;
  }
}

const isTextRequiredError = error => error?.code === CODE;

class PdfSubjectScopeError extends Error {
  constructor(pageCount, missingSubjectCodes = [], noMatchingRows = false) {
    const details = [
      'This PDF has a readable selectable/OCR result table, but its subjects do not satisfy the selected exam session or original result requirements.'
    ];
    if (missingSubjectCodes.length) details.push('Required subjects not found in the PDF: ' + missingSubjectCodes.join(', ') + '.');
    if (noMatchingRows) details.push('No extracted subject rows match the selected exam session or original result.');
    details.push('Check the selected semester, examination period and exam type. For a partial backlog card, select Backlog and the corresponding exam session. For revaluation, select the matching original result.');
    super(details.join('\n\n'));
    this.name = 'PdfSubjectScopeError';
    this.code = SCOPE_CODE;
    this.pageCount = pageCount;
    this.missingSubjectCodes = missingSubjectCodes;
    this.noMatchingRows = noMatchingRows;
  }
}

function errorTitle(code) {
  return code === CODE ? TITLE : code === SCOPE_CODE ? SCOPE_TITLE : null;
}

// Only expose known admission errors; unrelated provider errors stay generic.
function publicError(error) {
  if (isTextRequiredError(error)) return {code:CODE, title:TITLE, message:MESSAGE};
  if (error?.code === SCOPE_CODE) return {code:SCOPE_CODE, title:SCOPE_TITLE,
    message:new PdfSubjectScopeError(error.pageCount, error.missingSubjectCodes, error.noMatchingRows).message};
  return null;
}

module.exports = { MAX_SCANNED_PDF_PAGES, CODE, TITLE, MESSAGE, LongPdfTextRequiredError, isTextRequiredError,
  SCOPE_CODE, SCOPE_TITLE, PdfSubjectScopeError, errorTitle, publicError };
