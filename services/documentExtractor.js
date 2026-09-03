const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

let pdfjsLib = null;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
} catch (err) {
  console.warn('pdfjs-dist could not be loaded:', err.message);
}

const documentExtractor = {
  supportedImageTypes: ['.jpg', '.jpeg', '.png'],
  supportedPdfTypes: ['.pdf'],

  async extract(filePath, resultType = 'original') {
    try {
      if (!fs.existsSync(filePath)) throw new Error('File not found');

      const fileExt = path.extname(filePath).toLowerCase();
      let textItems = []; // Contains spatial text objects: { text, x, y, width, height }
      let rawText = '';
      let extractionMethod = '';

      if (this.supportedImageTypes.includes(fileExt)) {
        const ocrResult = await this.ocrImage(filePath);
        rawText = ocrResult.text;
        textItems = ocrResult.words;
        extractionMethod = 'tesseract-ocr';
      } else if (this.supportedPdfTypes.includes(fileExt)) {
        const pdfResult = await this.extractPdfTextWithCoordinates(filePath);
        if (pdfResult.text && pdfResult.text.length > 50) {
          rawText = pdfResult.text;
          textItems = pdfResult.words;
          extractionMethod = 'pdfjs-text';
        } else {
          // Scanned PDF fallback: render/OCR page
          const ocrResult = await this.ocrImage(filePath);
          rawText = ocrResult.text;
          textItems = ocrResult.words;
          extractionMethod = 'tesseract-ocr-pdf';
        }
      } else {
        throw new Error(`Unsupported file type: ${fileExt}`);
      }

      const structuredData = this.parseProductionData(rawText, textItems, resultType);

      return {
        success: true,
        message: 'Result document uploaded and extracted successfully',
        file: path.basename(filePath),
        extraction: {
          documentType: fileExt.replace('.', ''),
          extractionMethod,
          rawText,
          ...structuredData
        }
      };
    } catch (error) {
      console.error('Document extraction error:', error);
      throw new Error(`Extraction failed: ${error.message}`);
    }
  },

  // =====================================================
  // 1. EXTRACT PDF WITH SPATIAL LAYOUT DATA
  // =====================================================
  async extractPdfTextWithCoordinates(filePath) {
    if (!pdfjsLib) return { text: '', words: [] };

    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const words = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      for (const item of textContent.items) {
        if (!item.str.trim()) continue;
        fullText += item.str + ' ';
        words.push({
          text: item.str.trim(),
          x: item.transform[4],
          // Invert PDF Y-coordinates to align with standard image top-down rendering
          y: 1000 - item.transform[5],
          width: item.width || 20,
          height: item.height || 10
        });
      }
      fullText += '\n';
    }

    return { text: fullText.trim(), words };
  },

  // =====================================================
  // 2. IMAGE OCR PREPROCESSING
  // =====================================================
  async ocrImage(filePath) {
    const processedPath = path.join(path.dirname(filePath), `ocr_${Date.now()}.png`);
    try {
      await sharp(filePath)
        .rotate()
        .resize({ width: 2400, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toFile(processedPath);

      const result = await Tesseract.recognize(processedPath, 'eng', {
        config: { tessedit_pageseg_mode: '6' }
      });

      const words = (result.data.words || []).map(w => ({
        text: w.text.trim(),
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: w.bbox.x1 - w.bbox.x0,
        height: w.bbox.y1 - w.bbox.y0
      }));

      return { text: result.data.text || '', words };
    } finally {
      if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);
    }
  },

  // =====================================================
  // 3. CORE PARSER (DYNAMIC & HEURISTIC-BASED)
  // =====================================================

  /**
   * Generic identity extraction for VTU result documents.
   *
   * TIER 1 — Label-driven (primary, most robust):
   *   Look for explicit labels on the document and extract the value adjacent
   *   to them. Handles all formatting variants:
   *     "Label : Value" / "Label: Value" / "Label\nValue" / "Label  Value"
   *
   * TIER 2 — Generic VTU pattern fallback:
   *   If no labeled value was found, use the canonical VTU USN pattern
   *   (10-char: 1MV25MC074). NOT tied to any individual student.
   *
   * USN candidates are stored with two forms:
   *   usnRaw       — as captured from OCR (uppercased), e.g. "IMV25MCO074"
   *   usnNormalized — I→1, O→0 mapping, e.g. "1MV25MC074"
   * The authoritative DB Student.usn is NEVER modified.
   */

  // ── TIER 1: Label-driven USN extraction ────────────────────────────────
  _extractLabeledUsn(rawText) {
    const labelVariants = [
      'University Seat Number',
      'University Seat No',
      'Seat Number',
      'Seat No',
      'USN'
    ];
    for (const label of labelVariants) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Same-line: "Label : VALUE" / "Label:VALUE" / "Label   VALUE"
      const sameLineRe = new RegExp(
        escaped + '\\s*[:\\-]*\\s*([A-Za-z0-9]{5,20})\\b', 'i'
      );
      let m = rawText.match(sameLineRe);
      if (m) return m[1].toUpperCase();
      // Next-line: "Label\nVALUE"
      const nextLineRe = new RegExp(
        '(?:^|\\n)' + escaped + '\\s*[:\\-]*\\s*(?:\\n|\\r\\n)?([A-Za-z0-9]{5,20})\\b', 'i'
      );
      m = rawText.match(nextLineRe);
      if (m) return m[1].toUpperCase();
    }
    return null;
  },

  // ── USN normalization (for comparison only) ────────────────────────────
  // Strips non-alphanumerics and applies I→1, O→0. Used symmetrically
  // on BOTH server and OCR sides in comparison functions, so:
  //   - An OCR USN "IMV25MCO76" and a server USN "1MV25MC076" both
  //     normalize to "1MV25MC076" and match.
  //   - The authoritative `Student.usn` is NEVER mutated — only the
  //     comparison sees the normalized form.
  // Length handling: the VTU 2025 USN canonical form is 10 characters
  // (1 digit + 2 letters + 2 digits + 2 letters + 3 digits, e.g.
  // "1MV25MC074"). The OCR frequently inflates the trailing student
  // number to 4 digits when the leading digit of a 3-digit roll is '0'
  // (e.g. reading "1MV25MC007" as "1MV25MC0074" or "IMV25MC074" as
  // "IMV25MCO074"). We therefore:
  //   1. Apply I→1, O→0 substitutions
  //   2. Strip non-alphanumeric noise
  //   3. If longer than 10 chars: keep first 7 + last 3 characters.
  //      This removes the middle artifact (the OCR-read extra 0 in the
  //      4-digit roll while preserving the canonical 3-digit suffix).
  //      e.g. 1MV25MC0074 (11) → 1MV25MC + 074 = 1MV25MC074 (10)
  //   4. Leave 10-char-or-shorter values untouched.
  // The raw OCR USN is preserved in `student.usnRaw` for audit/display.
  _normalizeUsn(usn) {
    const s = String(usn || '')
      .toUpperCase()
      .replace(/I/g, '1')
      .replace(/O/g, '0')
      .replace(/[^A-Z0-9]/g, '');
    if (s.length > 10) return s.slice(0, 7) + s.slice(-3);
    return s;
  },

  // ── TIER 2: Generic VTU pattern fallback ───────────────────────────────
  _extractPatternUsn(rawText) {
    // Strict VTU 10-char: "1MV25MC074" / "1IV22CS061"
    // Also accepts OCR confusion: 'I' in place of digit '1', 'O' in place of '0'.
    // The [A-Z]{2,3} branch/scheme part must NOT include digits, so
    // MC074 (where MC074[1]='C') does NOT match [A-Z]{2,3}.
    const strictRe = /\b([1I][A-Z]{2}\d{2}[A-Z]{2,3}[\dO]{3})\b/i;
    const strictHit = rawText.match(strictRe);
    if (strictHit) return strictHit[1].toUpperCase();
    // Old 8-char format: "18CS51", "21MCA11", "15EC41"
    // Structure: 2 digits (admission year) + 2-4 letters (branch) + 1-2 digits (semester).
    // The 2 leading digits are required to avoid matching the 10-char USN
    // (which starts with 1 letter-or-digit at pos 0, not 2 digits).
    const oldRe = /\b(\d{2}[A-Z]{2,4}\d{1,2})\b/g;
    const oldAll = rawText.match(oldRe);
    if (oldAll) {
      const oldHit = oldAll.find(t => /^\d{2}[A-Z]{2,4}\d{1,2}$/.test(t.toUpperCase()));
      if (oldHit) return oldHit.toUpperCase();
    }
    return null;
  },

  // ── TIER 1: Label-driven Student Name ──────────────────────────────────
  _extractLabeledName(rawText) {
    const labelVariants = [
      'Student Name', 'StudentName',
      'Candidate Name', 'CandidateName',
      'Name of Student', 'Name'
    ];
    // Boundary: name ends at the next known field label (or end-of-line).
    // This stops the name capture from running into "Semester" / "USN" / etc.
    const boundary = '(?=\\s*(?:\\n|\\r\\n|\\s+(?:Semester|Sem|USN|University|Seat|Father|Mother|College|Result|Exam|Date|Roll|Subject|Code|Page|Year)\\b|$))';

    // PART C FIX: Table-header guard.
    // If a PDF's raw text has "Name" as a bare label at the top of the
    // document (e.g. "Name  Internal  Old  Result  ..." — a table header)
    // the next-line pattern can accidentally capture the header columns as
    // the name (e.g. "Internal  Old  Result"). This guard rejects any value
    // that contains table-column keywords.
    const tableHeaderKeywords = [
      'internal', 'external', 'total', 'obtained', 'result',
      'status', 'marks', 'theory', 'practical', 'lab',
      'subject', 'code', 'sessional', 'semester'
    ];
    function isTableHeader(val) {
      const lower = val.toLowerCase();
      return tableHeaderKeywords.some(k => lower.indexOf(k) !== -1);
    }

    /**
     * PHASE 3 FIX (PART H): Stepwise name extraction.
     *
     * The original regex-based approach fails on PDFs where OCR noise
     * separates the name from the next label with characters not in the
     * regex character class (e.g. em-dash "——" in
     * "SINDHUKUMAR S 4 G EEE—— Semester"). The non-greedy capture cannot
     * cross the em-dash boundary, and the lookahead `\s+Semester` cannot
     * match because em-dash is not whitespace.
     *
     * Stepwise scan:
     *   1. Find the label in the text.
     *   2. Skip colon/space/dash separators.
     *   3. Collect name chars (letters, spaces, dots, apostrophes, hyphens).
     *   4. Stop at: digit, em-dash, or a known next-field label.
     *   5. Validate: no digits, no consecutive spaces, not a table header.
     */
    function extractNameStepwise(text) {
      for (const label of labelVariants) {
        const labelIdx = text.indexOf(label);
        if (labelIdx === -1) continue;
        let pos = labelIdx + label.length;
        // Skip separators: ":", "-", whitespace
        while (pos < text.length && /[:\-\s]/.test(text[pos])) pos++;
        const start = pos;
        // Known next-field labels to stop at
        const nextLabels = [
          'semester', 'sem', 'subject', 'usn', 'university', 'seat',
          'father', 'mother', 'college', 'result', 'exam', 'date',
          'roll', 'code', 'page', 'year', 'internal', 'external',
          'total', 'obtained', 'status', 'marks', 'theory',
          'practical', 'lab', 'sessional'
        ];
        while (pos < text.length) {
          const ch = text[pos];
          // Stop on digit or em-dash (OCR noise)
          if (/[0-9\u2014\u2013]/.test(ch)) break;
          // Stop at whitespace followed by a known label keyword.
          // The whitespace may be any whitespace (\n, \r, \t, ' ').
          if (/\s/.test(ch)) {
            // Skip consecutive whitespace, then check for a known label
            // starting at the next non-whitespace position.
            let probe = pos;
            while (probe < text.length && /\s/.test(text[probe])) probe++;
            const rest = text.substring(probe, probe + 15).toLowerCase();
            if (nextLabels.some(l =>
              rest === l ||
              rest.startsWith(l + ' ') ||
              rest.startsWith(l + ':') ||
              rest.startsWith(l + '/') ||
              rest.startsWith(l + '|')
            )) break;
          }
          pos++;
        }
        const name = text.substring(start, pos).replace(/\s+/g, ' ').trim();
        if (!name) continue;
        if (/[0-9]/.test(name)) continue;
        if (/\s{2,}/.test(name)) continue;
        if (isTableHeader(name)) continue;
        return name;
      }
      return null;
    }

    // Try stepwise extraction first (handles noisy OCR with em-dash etc.)
    const stepwiseName = extractNameStepwise(rawText);
    if (stepwiseName) return stepwiseName;

    // Fall back to the original regex-based approach for clean PDFs
    for (const label of labelVariants) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Same-line: "Label : VALUE"
      const sameLineRe = new RegExp(
        escaped + '\\s*[:\\-]*\\s*([A-Za-z][A-Za-z\\s.\'-]{0,80}?)' + boundary,
        'i'
      );
      let m = rawText.match(sameLineRe);
      if (m) {
        const val = m[1].replace(/\s+/g, ' ').trim();
        // Reject table headers that may be captured when the label is bare
        // (e.g. a table header line like "Name  Internal  Old  Result"
        // before the actual card content starts in the PDF).
        if (val && !isTableHeader(val)) return val;
      }
      // Next-line: "Label\nVALUE" — capture until the next field label or end.
      const nextLineRe = new RegExp(
        '(?:^|\\n)' + escaped + '\\s*[:\\-]*\\s*(?:\\n|\\r\\n)?([A-Za-z][A-Za-z\\s.\'-]{0,80}?)' + boundary,
        'i'
      );
      m = rawText.match(nextLineRe);
      if (m) {
        const val = m[1].replace(/\s+/g, ' ').trim();
        if (val && !isTableHeader(val)) return val;
      }
    }
    return null;
  },

  // ── TIER 1: Label-driven Semester ───────────────────────────────────────
  _extractLabeledSemester(rawText) {
    const labelVariants = ['Semester', 'Sem', 'Semester No', 'Semester Number'];
    for (const label of labelVariants) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sameLineRe = new RegExp(escaped + '\\s*[:\\-]*\\s*(\\d{1,2})\\b', 'i');
      let m = rawText.match(sameLineRe);
      if (m) return parseInt(m[1], 10);
      const nextLineRe = new RegExp(
        '(?:^|\\n)' + escaped + '\\s*[:\\-]*\\s*(?:\\n|\\r\\n)?(\\d{1,2})\\b', 'i'
      );
      m = rawText.match(nextLineRe);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  },

  parseProductionData(rawText, textItems, resultType) {
    const student = {};
    const metadata = {};
    const subjects = [];
    const parsingWarnings = [];

    // ── Identity extraction: label-first, pattern-fallback ──────────────

    // 1. USN — Tier 1: labeled extraction
    let usnRaw = this._extractLabeledUsn(rawText);
    // 2. USN — Tier 2: generic VTU pattern fallback
    if (!usnRaw) usnRaw = this._extractPatternUsn(rawText);

    if (usnRaw) {
      student.usn = usnRaw;                      // as-OCR, uppercased
      student.usnRaw = usnRaw;                    // alias for consumers
      student.usnNormalized = this._normalizeUsn(usnRaw); // I→1, O→0
    }

    // 3. Student Name — Tier 1: labeled extraction
    const name = this._extractLabeledName(rawText);
    if (name) student.name = name;

    // 4. Semester — Tier 1: labeled extraction
    const sem = this._extractLabeledSemester(rawText);
    if (sem !== null) metadata.semester = sem;

    // Reconstruct spatial line structures from items or rawText
    const reconstructedLines = this.groupItemsIntoLines(textItems, rawText);

    // Subject Code Detector (Dynamic for VTU and generic schemes: MMC101, 21MCA11, 18CS51, etc.)
    const subjectCodeRegex = /\b([A-Z]{2,4}\d{2,4}[A-Z]?|\d{2}[A-Z]{2,3}\d{2,3})\b/i;

    for (const line of reconstructedLines) {
      const codeMatch = line.text.match(subjectCodeRegex);
      if (!codeMatch) continue;

      const subjectCode = codeMatch[1].toUpperCase();

      // Ignore header matches or USNs accidentally matched as code
      if (subjectCode === student.usn || /SEMESTER|RESULT|CODE|MARKS/i.test(subjectCode)) continue;

      let subject;
      if (resultType === 'revaluation') {
        // PHASE 2 FIX (BUG 1): a bare alphanumeric token is NOT a subject row.
        // A real revaluation card row must have the structural evidence of a
        // 9-column result line: either a pipe-separated 9-column layout, OR
        // enough numeric + status tokens on the same line to form a
        // subject-result row. Tokens like "SE038" or "FA2003" that appear in
        // headers, footers, or non-result text must NOT be promoted to
        // detected subjects.
        if (!this.looksLikeRevaluationRow(line.text)) continue;
        subject = this.parseRevaluationDetails(subjectCode, line.text);
      } else {
        subject = this.extractSubjectDetails(subjectCode, line.text);
      }
      if (subject) subjects.push(subject);
    }

    const warnings = this.validateData(student, subjects);

    return {
      resultType,
      student,
      semester: metadata.semester || null,
      subjects,
      metadata,
      parsingWarnings,
      lines: reconstructedLines.map(l => l.text),
      warnings
    };
  },

  // =====================================================
  // 4. SPATIAL LINE GROUPING (Eliminates Flat PDF Stream Issues)
  // =====================================================
  groupItemsIntoLines(textItems, rawText) {
    if (!textItems || textItems.length === 0) {
      return rawText.split(/\r?\n/).map(t => ({ text: t.trim() })).filter(l => l.text);
    }

    // Sort items top-to-bottom, then left-to-right
    const sorted = [...textItems].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    let currentLine = [];
    let currentY = sorted[0]?.y || 0;

    for (const item of sorted) {
      if (Math.abs(item.y - currentY) <= 15) {
        currentLine.push(item);
      } else {
        if (currentLine.length > 0) {
          currentLine.sort((a, b) => a.x - b.x);
          lines.push({ text: currentLine.map(i => i.text).join(' ') });
        }
        currentLine = [item];
        currentY = item.y;
      }
    }
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push({ text: currentLine.map(i => i.text).join(' ') });
    }

    return lines;
  },

  // =====================================================
  // 5. MATHEMATICAL & HEURISTIC MARKS EXTRACTION
  // =====================================================
  extractSubjectDetails(subjectCode, lineText) {
    // 1. Clean dates out (e.g. 2026-04-28 or 20260428)
    const textWithoutDates = lineText.replace(/\b20\d{2}[-/]?\d{2}[-/]?\d{2}\b/g, ' ');

    // 2. Isolate Subject Name (Text between Subject Code and first mark digit)
    const afterCode = textWithoutDates.substring(textWithoutDates.indexOf(subjectCode) + subjectCode.length);
    const nameMatch = afterCode.match(/^\s*\|?\s*([A-Za-z\s()\/,-]+?)(?=\s+\d|\s*\|)/);
    const subjectName = nameMatch ? nameMatch[1].replace(/\|/g, '').trim() : '';

    // 3. Extract all potential number tokens
    const tokens = (textWithoutDates.match(/\b\d{1,3}\b/g) || []).map(Number);

    let internalMarks = null;
    let externalMarks = null;
    let totalMarks = null;
    let marksValidated = false;
    let confidence = 'low';

    // Mathematical triplet validation: Look for Int + Ext === Total
    for (let i = 0; i <= tokens.length - 3; i++) {
      const intM = tokens[i];
      const extM = tokens[i + 1];
      const totM = tokens[i + 2];

      if (intM <= 100 && extM <= 100 && intM + extM === totM) {
        internalMarks = intM;
        externalMarks = extM;
        totalMarks = totM;
        marksValidated = true;
        confidence = 'high';
        break;
      }
    }

    // Fallback: If OCR missed the total or corrupt tokens exist, derive total
    if (!marksValidated && tokens.length >= 2) {
      const validMarks = tokens.filter(n => n <= 100);
      if (validMarks.length >= 2) {
        internalMarks = validMarks[0];
        externalMarks = validMarks[1];
        totalMarks = internalMarks + externalMarks;
        confidence = 'medium';
        marksValidated = true;
      }
    }

    // Result status (P/F/PASS/FAIL/ABSENT)
    const resultMatch = lineText.match(/\b(PASS|FAIL|P|F|ABSENT|A|WITHHELD|W)\b/i);
    let result = null;
    if (resultMatch) {
      const res = resultMatch[1].toUpperCase();
      result = res.startsWith('P') ? 'P' : res.startsWith('F') ? 'F' : res;
    }

    const subjectType = /LABORATORY|\bLAB\b/i.test(subjectName) || /LAB/i.test(subjectCode) ? 'lab' : 'theory';

    return {
      subjectCode,
      subjectName,
      subjectType,
      internalMarks,
      externalMarks,
      totalMarks,
      result,
      marksConfidence: confidence,
      marksValidated
    };
  },

  // =====================================================
  // 5b. ORIGINAL PARSER (extracted for isolation)
  // =====================================================
  parseOriginalData(rawText, textItems) {
    const student = {};
    const metadata = {};
    const subjects = [];
    const parsingWarnings = [];

    // USN: Standard university pattern (e.g., 1MV25MC061, 18CS51, etc.)
    const usnMatch = rawText.match(/\b([1-9][A-Z]{2}\d{2}[A-Z]{2,3}\d{3})\b/i);
    if (usnMatch) student.usn = usnMatch[1].toUpperCase();

    // Student Name: Match text between "Student Name" and next label
    const nameMatch = rawText.match(/Student\s+Name\s*[:+]?\s*([A-Za-z\s.'-]+?)(?=\s+(?:Semester|USN|Father|Result)|$)/i);
    if (nameMatch) student.name = nameMatch[1].replace(/\s+/g, ' ').trim();

    // Semester
    const semMatch = rawText.match(/Semester\s*[:\-]?\s*(\d+)/i);
    if (semMatch) {
      metadata.semester = parseInt(semMatch[1], 10);
    }

    // Reconstruct spatial line structures from items or rawText
    const reconstructedLines = this.groupItemsIntoLines(textItems, rawText);

    // Subject Code Detector (Dynamic for VTU and generic schemes: MMC101, 21MCA11, 18CS51, etc.)
    const subjectCodeRegex = /\b([A-Z]{2,4}\d{2,4}[A-Z]?|\d{2}[A-Z]{2,3}\d{2,3})\b/i;

    for (const line of reconstructedLines) {
      const codeMatch = line.text.match(subjectCodeRegex);
      if (!codeMatch) continue;

      const subjectCode = codeMatch[1].toUpperCase();
      
      // Ignore header matches or USNs accidentally matched as code
      if (subjectCode === student.usn || /SEMESTER|RESULT|CODE|MARKS/i.test(subjectCode)) continue;

      const subject = this.extractSubjectDetails(subjectCode, line.text);
      if (subject) subjects.push(subject);
    }

    const warnings = this.validateData(student, subjects);

    return {
      resultType: 'original',
      student,
      semester: metadata.semester || null,
      subjects,
      metadata,
      parsingWarnings,
      lines: reconstructedLines.map(l => l.text),
      warnings
    };
  },

  // =====================================================
  // 5c. REVALUATION PARSER (nine-column card format)
  // =====================================================
  parseRevaluationData(rawText, textItems) {
    const student = {};
    const metadata = {};
    const subjects = [];
    const parsingWarnings = [];

    // USN: Standard university pattern (e.g., 1MV25MC061, 18CS51, etc.)
    const usnMatch = rawText.match(/\b([1-9][A-Z]{2}\d{2}[A-Z]{2,3}\d{3})\b/i);
    if (usnMatch) student.usn = usnMatch[1].toUpperCase();

    // Student Name: Match text between "Student Name" and next label
    const nameMatch = rawText.match(/Student\s+Name\s*[:+]?\s*([A-Za-z\s.'-]+?)(?=\s+(?:Semester|USN|Father|Result)|$)/i);
    if (nameMatch) student.name = nameMatch[1].replace(/\s+/g, ' ').trim();

    // Semester
    const semMatch = rawText.match(/Semester\s*[:\-]?\s*(\d+)/i);
    if (semMatch) {
      metadata.semester = parseInt(semMatch[1], 10);
    }

    // Reconstruct spatial line structures from items or rawText
    const reconstructedLines = this.groupItemsIntoLines(textItems, rawText);

    // Subject Code Detector (Dynamic for VTU and generic schemes: MMC101, 21MCA11, 18CS51, etc.)
    const subjectCodeRegex = /\b([A-Z]{2,4}\d{2,4}[A-Z]?|\d{2}[A-Z]{2,3}\d{2,3})\b/i;

    for (const line of reconstructedLines) {
      const codeMatch = line.text.match(subjectCodeRegex);
      if (!codeMatch) continue;

      const subjectCode = codeMatch[1].toUpperCase();
      
      // Ignore header matches or USNs accidentally matched as code
      if (subjectCode === student.usn || /SEMESTER|RESULT|CODE|MARKS/i.test(subjectCode)) continue;

      const subject = this.parseRevaluationDetails(subjectCode, line.text);
      if (subject) subjects.push(subject);
    }

    const warnings = this.validateData(student, subjects);

    return {
      resultType: 'revaluation',
      student,
      semester: metadata.semester || null,
      subjects,
      metadata,
      parsingWarnings,
      lines: reconstructedLines.map(l => l.text),
      warnings
    };
  },


// =====================================================
// 5a. REVALUATION SUBJECT DETAILS (nine-column card format)
// =====================================================

/**
 * BUG 1 FIX (PART A): Determine whether `lineText` has the structural
 * evidence of a VTU revaluation result line (nine-column format).
 *
 * The method checks for one of two strong signals:
 *   1. Pipe-separated 9+ parts  →  the card clearly separates each column.
 *   2. At least 3 numeric tokens (1–3 digits each) on the same line.
 *      A non-result line (header, footer, fee note, USN) may contain a
 *      subject-code-like token but will not have 3+ marks-like numbers.
 *
 * A line that passes this check is still processed normally by
 * parseRevaluationDetails; a line that fails is simply skipped, preventing
 * false-positive subject rows from footer metadata, fee-receipt tokens, etc.
 */
looksLikeRevaluationRow(lineText) {
  if (!lineText || typeof lineText !== 'string') return false;

  // Signal 1: pipe-separated nine-column format
  const parts = lineText.split('|').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length >= 9) return true;

  // Signal 2: at least 4 numeric tokens that look like marks (1–3 digits).
  // A real revaluation row has exactly 4 marks columns: Internal, Old,
  // Rv, Final. A form-header line like "Form No. SE038  2026-04-28" has
  // only 1-3 numbers (the form number + date components) and must NOT pass.
  // This was ≥ 3, which caused FA2003 (form number "2003") + a nearby year
  // or other numbers to reach 3+ tokens and become false-positive candidates.
  const tokens = lineText.match(/\b\d{1,3}\b/g) || [];
  return tokens.length >= 4;
},

parseRevaluationDetails(subjectCode, lineText) {
  // Clean dates out (e.g. 2026-04-28 or 20260428)
  const textWithoutDates = lineText.replace(/\b20\d{2}[-/]?\d{2}[-/]?\d{2}\b/g, ' ');

  // VTU revaluation card canonical 9-column layout (left → right):
  //   [0] SubjectCode
  //   [1] SubjectName
  //   [2] InternalMarks   (numeric 0..100)
  //   [3] OldMarks        (numeric 0..100)
  //   [4] OldResult       (P / F / A / W / X / R / NE)
  //   [5] RvMarks         (numeric 0..100)
  //   [6] RvResult        (P / F / A / W / X / R / NE)
  //   [7] FinalMarks      (numeric 0..100)
  //   [8] FinalResult     (P / F / A / W / X / R / NE)
  //
  // OCR is lossy: it can drop pipe separators, merge columns, insert
  // spaces, and corrupt result letters. We try strategies in order of
  // evidence strength and never invent column values.
  let subjectName    = '';
  let internalMarks  = null;
  let oldMarks       = null;
  let oldResult      = null;
  let oldResultRaw   = null;
  let rvMarks        = null;
  let rvResult       = null;
  let rvResultRaw    = null;
  let finalMarks     = null;
  let finalResult    = null;
  let finalResultRaw = null;
  let parsingMethod  = 'none';
  let marksValidated = false;
  let rowConfidence  = 'low';

  // Strategy 1: pipe-separated 9-column format (clean VTU card)
  const parts = textWithoutDates.split('|').map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length >= 9) {
    subjectName    = (parts[1] || '').replace(/\|/g, '').trim();
    internalMarks  = this._asMark(parts[2]);
    oldMarks       = this._asMark(parts[3]);
    oldResult      = this.normalizeResult(parts[4]);
    oldResultRaw   = (parts[4] || '').trim() || null;
    rvMarks        = this._asMark(parts[5]);
    rvResult       = this.normalizeResult(parts[6]);
    rvResultRaw    = (parts[6] || '').trim() || null;
    finalMarks     = this._asMark(parts[7]);
    finalResult    = this.normalizeResult(parts[8]);
    finalResultRaw = (parts[8] || '').trim() || null;

    parsingMethod  = 'pipe-split';
    marksValidated = true;
    rowConfidence  = 'high';
    return this._revRow(subjectCode, lineText, {
      subjectName, internalMarks, oldMarks, oldResult, oldResultRaw,
      rvMarks, rvResult, rvResultRaw,
      finalMarks, finalResult, finalResultRaw,
      parsingMethod, marksValidated, rowConfidence
    });
  } else {
    // Strategy 2: positional alignment for damaged/merged OCR.
    //
    // The line may have some pipes (or none) but the column boundaries
    // are lost. We rebuild the column stream by tokenizing and then
    // aligning to the 9-column shape:
    //   [name?] [number number number number] [status status status]
    //
    // A bounded, POSITIONAL-ONLY dictionary is applied to status-slot
    // tokens that are OCR-distorted versions of known VTU result
    // letters (see _alignRevalRow). The dictionary is never applied
    // globally; a token is only mapped if it is already in a status
    // column by the alignment.
    const innerTokens = this._tokRevalRow(textWithoutDates, subjectCode);
    if (innerTokens.length > 0) {
      const aligned = this._alignRevalRow(innerTokens, subjectCode);
      if (aligned) {
        subjectName    = aligned.subjectName    || '';
        internalMarks  = aligned.internalMarks;
        oldMarks       = aligned.oldMarks;
        oldResult      = aligned.oldResult;
        oldResultRaw   = aligned.oldResultRaw;
        rvMarks        = aligned.rvMarks;
        rvResult       = aligned.rvResult;
        rvResultRaw    = aligned.rvResultRaw;
        finalMarks     = aligned.finalMarks;
        finalResult    = aligned.finalResult;
        finalResultRaw = aligned.finalResultRaw;
        parsingMethod  = aligned.parsingMethod;
        marksValidated = aligned.marksValidated;
        rowConfidence = aligned.rowConfidence;
      }
    }
  }

  return this._revRow(subjectCode, lineText, {
    subjectName, internalMarks, oldMarks, oldResult, oldResultRaw,
    rvMarks, rvResult, rvResultRaw,
    finalMarks, finalResult, finalResultRaw,
    parsingMethod, marksValidated, rowConfidence
  });
},

/**
 * Tokenize a revaluation line for positional alignment.
 * Returns an ordered array of { kind: 'name'|'number'|'status'|'symbol', value, raw }.
 * The subject code itself is NOT emitted; the stream starts from the
 * token immediately following it in the source.
 *
 * Approach:
 *   1. Walk the text left-to-right using a token regex that captures
 *      numbers, words, and symbols separately (pipes are skipped).
 *   2. Anchor on the subject code: the first alphanumeric run that
 *      matches (or starts with) the supplied code marks the row boundary.
 *   3. Everything before the code anchor is discarded (header noise).
 *   4. After the anchor: word runs accumulate into a name buffer until
 *      the first number token flushes them as a single 'name' token.
 *   5. Number tokens and remaining word/symbol tokens form the data stream.
 */
_tokRevalRow(text, subjectCode) {
  if (!text || !subjectCode) return [];
  const upperCode = String(subjectCode).toUpperCase();
  const tokenRe  = /\b(\d{1,3})\b|([A-Za-z][A-Za-z0-9()\/.,&\-]{0,30})|([{}@#~`^&]+)/g;
  const tokens   = [];
  const nameBuf  = [];
  const statusTokens = [];  // status candidates seen so far (for stray-1 filter)
  let codeSeen   = false;
  let dataStarted = false;  // flips true on first number; gates name-vs-status

  for (const m of text.matchAll(tokenRe)) {
    const num  = m[1];
    const word = m[2];
    const sym  = m[3];
    if (num) {
      // Flush name buffer before emitting a number token.
      if (nameBuf.length) {
        const joined = nameBuf.join(' ').replace(/\|/g, '').replace(/\s+/g, ' ').trim();
        if (joined && joined.toUpperCase() !== upperCode) {
          tokens.push({ kind: 'name', value: joined, raw: joined });
        }
        nameBuf.length = 0;
      }
      const n = parseInt(num, 10);
      // Heuristic: a solitary "1" surrounded by numbers in a row that has
      // status tokens is almost always a misread status letter or pipe,
      // NOT a real marks value. We promote it to a status candidate so
      // the aligner maps it positionally (e.g. between rvMarks and
      // finalMarks it becomes rvResult, after a status it stays as a
      // status candidate for a subsequent slot).
      //
      // Example: "30 15 &} 20 1 20 P"
      //   The 1 between 20 and 20 is the rvResult that OCR misread.
      //   Treating it as a status yields [&}, 1, P] → F, P, P.
      const lastTok = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      const prevWasNumber = lastTok && lastTok.kind === 'number';
      if (n === 1 && prevWasNumber && statusTokens.length >= 1) {
        // Promote to status candidate.
        statusTokens.push('1');
        tokens.push({ kind: 'status', value: '1', raw: num });
        codeSeen = true;
        dataStarted = true;
        continue;
      }
      tokens.push({ kind: 'number', value: n, raw: num });
      codeSeen = true;
      dataStarted = true;  // first number = marks start; word stream becomes status
      continue;
    }
    if (sym) {
      // Symbol in a potential status position; preserve raw for the aligner.
      statusTokens.push(sym);
      tokens.push({ kind: 'status', value: sym, raw: sym });
      continue;
    }
    if (word) {
      const upper = word.toUpperCase();
      if (!codeSeen) {
        // Before the first number: either this word IS the code anchor
        // (skip it) or it is header noise (discard).
        if (upper === upperCode || upper.startsWith(upperCode)) {
          codeSeen = true;
          // Any remainder after the code is the start of the name.
          const rem = word.substring(String(subjectCode).length).replace(/^[^A-Za-z]+/, '');
          if (rem) nameBuf.push(rem);
        }
        // else: header noise, discard
        continue;
      }
      // After code anchor AND after the first number has been emitted:
      // the row has entered the data region. Subsequent words are
      // VTU result-letter candidates (P / F / A / W / X / R / NE),
      // NOT name fragments. Emit as 'status' so the aligner maps them.
      if (dataStarted) {
        statusTokens.push(word);
        tokens.push({ kind: 'status', value: word, raw: word });
        continue;
      }
      // Before the first number: still in the name region, accumulate.
      nameBuf.push(word);
      continue;
    }
  }

  // Flush trailing name buffer.
  if (nameBuf.length && codeSeen) {
    const joined = nameBuf.join(' ').replace(/\|/g, '').replace(/\s+/g, ' ').trim();
    if (joined) tokens.push({ kind: 'name', value: joined, raw: joined });
  }

  return tokens;
},

/**
 * Positional alignment for the 9-column revaluation row.
 *
 * Expected post-code stream shape:
 *   [name?] [number number number number] [status status status]
 *
 * If the OCR dropped column separators, numbers and statuses may be
 * interleaved. We realign by counting:
 *   - The first 4 numbers → [internal, old, rv, final] marks
 *   - The first 3 status-position tokens → [oldResult, rvResult, finalResult]
 *
 * OCR-distortion mapping is bounded and POSITIONAL ONLY — never
 * applied globally, only to tokens that already occupy a status
 * position based on the 4+3 alignment:
 *   "&}" "&{" "}" "{" "&" → F
 *   "1"  "l"  "I"          → P   (only when 4 marks are present)
 *
 * Returns null if no numbers are found at all.
 */
_alignRevalRow(tokens, subjectCode) {
  // Separate the leading name token (column 1) from the data stream.
  let nameStr   = '';
  let dataStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'name') {
      nameStr   = tokens[i].value;
      dataStart = i + 1;
      break;
    }
    if (tokens[i].kind !== 'name') {
      dataStart = i;
      break;
    }
  }

  const dataTokens = tokens.slice(dataStart);
  const numbers  = dataTokens.filter(t => t.kind === 'number');
  const statuses = dataTokens.filter(t => t.kind !== 'number');  // status + symbol

  if (numbers.length === 0) return null;

  const num = (t) => (t && Number.isFinite(t.value)) ? t.value : null;

  // Map a token in a status column to a canonical VTU result letter.
  // source: 'canonical' | 'ocr-distorted' | 'unmappable'
  const mapStatus = (t) => {
    if (!t) return { normalized: null, raw: null, source: 'unmappable' };
    const rawText = String(t.raw || t.value || '').trim();
    if (!rawText) return { normalized: null, raw: null, source: 'unmappable' };

    // Canonical VTU letter (PASS, P, FAIL, F, ABSENT, A, W, X, NE …)
    const canon = this.normalizeResult(rawText);
    if (canon) return { normalized: canon, raw: rawText, source: 'canonical' };

    // Bounded OCR-distortion dictionary (POSITIONAL ONLY).
    const u = rawText.toUpperCase();
    // F distortions: &}  &{  }  {  &
    if (u === '&}' || u === '&{' || u === '}' || u === '{' || u === '&') {
      return { normalized: 'F', raw: rawText, source: 'ocr-distorted' };
    }
    // P distortions: 1  l  I  (only when 4 marks already present)
    if ((u === '1' || u === 'L' || u === 'I') && numbers.length >= 4) {
      return { normalized: 'P', raw: rawText, source: 'ocr-distorted' };
    }
    return { normalized: null, raw: rawText, source: 'unmappable' };
  };

  let internalMarks = num(numbers[0]) || null;
  let oldMarks      = null;
  let rvMarks       = null;
  let finalMarks    = null;
  let oldResult     = null, oldResultRaw     = null;
  let rvResult      = null, rvResultRaw      = null;
  let finalResult   = null, finalResultRaw   = null;

  // Fixed positional alignment:
  // Regardless of how the OCR arranged the data stream (canonical: 4 numbers
  // then 3 statuses; or interleaved: mixed), the 9-column card always has:
  //   columns 2-5 : 4 numeric marks
  //   columns 6-8 : 3 status letters
  //
  // We extract the first 4 numbers and first 3 status candidates in source
  // order and assign them to their canonical column positions.
  //
  // If we have more than 4 numbers (e.g. 5 from a stray pipe-misread-1),
  // we drop the extras. Statuses beyond 3 are also dropped.
  if (numbers.length >= 4) {
    internalMarks = num(numbers[0]);
    oldMarks      = num(numbers[1]);
    rvMarks       = num(numbers[2]);
    finalMarks    = num(numbers[3]);
  } else {
    // Partial: fewer than 4 numbers. Assign what we have without inventing.
    if (numbers.length >= 1) internalMarks = num(numbers[0]);
    if (numbers.length >= 2) oldMarks      = num(numbers[1]);
    if (numbers.length >= 3) rvMarks       = num(numbers[2]);
    if (numbers.length >= 4) finalMarks    = num(numbers[3]);
  }

  // Status mapping: positional, bounded dictionary only.
  // statuses[0] = oldResult, statuses[1] = rvResult, statuses[2] = finalResult.
  // If only 2 statuses, the missing one is the most ambiguous (rvResult
  // is in the middle), so we default to assigning the first to oldResult
  // and the second to finalResult, leaving rvResult null. This matches the
  // VTU card layout where status columns flank the marks they belong to.
  if (statuses.length >= 1) {
    const s0 = mapStatus(statuses[0]);
    oldResult = s0.normalized; oldResultRaw = s0.raw;
  }
  if (statuses.length >= 2) {
    const s1 = mapStatus(statuses[1]);
    rvResult = s1.normalized; rvResultRaw = s1.raw;
  }
  if (statuses.length >= 3) {
    const s2 = mapStatus(statuses[2]);
    finalResult = s2.normalized; finalResultRaw = s2.raw;
  }

  const allMarks   = internalMarks !== null && oldMarks !== null && rvMarks !== null && finalMarks !== null;
  const allStatus  = oldResult !== null && rvResult !== null && finalResult !== null;
  const validated  = allMarks && allStatus;
  const parsingMethod = validated
    ? 'positional-alignment'
    : (internalMarks !== null || oldResult !== null ? 'partial-alignment' : 'none');
  const confidence    = validated
    ? 'high'
    : (internalMarks !== null ? 'medium' : 'low');

  return {
    subjectName: nameStr,
    internalMarks,
    oldMarks,
    oldResult,
    oldResultRaw,
    rvMarks,
    rvResult,
    rvResultRaw,
    finalMarks,
    finalResult,
    finalResultRaw,
    parsingMethod,
    marksValidated: validated,
    rowConfidence: confidence
  };
},

/** Compact envelope builder for parseRevaluationDetails. */
_revRow(subjectCode, lineText, f) {
  // PHASE 3 FIX (PART G): reject rows with impossible marks values.
  // A form-header line like "FAz003 | 70, 380..." contains ≥4 numeric
  // tokens (e.g. 70, 380, 3, 0) that the positional aligner maps to
  // marks columns. Values like rvMarks=380 are clearly impossible —
  // VTU marks never exceed 100. Detecting any value > 100 is the most
  // reliable signal that the row is a phantom subject.
  const VTU_MAX_MARKS = 100;
  if (
    (f.internalMarks !== null && f.internalMarks > VTU_MAX_MARKS) ||
    (f.oldMarks       !== null && f.oldMarks       > VTU_MAX_MARKS) ||
    (f.rvMarks        !== null && f.rvMarks        > VTU_MAX_MARKS) ||
    (f.finalMarks     !== null && f.finalMarks     > VTU_MAX_MARKS)
  ) {
    return null;
  }
  // Also reject zero-marks rows (another class of phantom subjects).
  if (
    f.internalMarks === null &&
    f.oldMarks       === null &&
    f.rvMarks        === null &&
    f.finalMarks     === null
  ) {
    return null;
  }
  return {
    subjectCode,
    subjectName:    f.subjectName    || '',
    internalMarks:  f.internalMarks,
    oldMarks:       f.oldMarks,
    oldResult:      f.oldResult,
    oldResultRaw:   f.oldResultRaw,
    rvMarks:        f.rvMarks,
    rvResult:       f.rvResult,
    rvResultRaw:    f.rvResultRaw,
    finalMarks:     f.finalMarks,
    finalResult:    f.finalResult,
    finalResultRaw: f.finalResultRaw,
    marksConfidence: f.rowConfidence === 'high' ? 'high'
                   : f.internalMarks !== null ? 'medium' : 'low',
    marksValidated:  f.marksValidated,
    parsingMethod:   f.parsingMethod,
    rawLine:         lineText
  };
},

/** Safe mark-value parser: string → integer in [0..100] or null. */
_asMark(s) {
  if (s == null) return null;
  const n = parseInt(String(s).trim().replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
},

// =====================================================
// 5a-2. STATUS NORMALIZATION HELPER
// =====================================================
normalizeResult(token) {
  if (!token) return null;
  const upper = token.toUpperCase();
  if (upper === 'PASS' || upper === 'P' || upper === 'A') return 'P';
  if (upper === 'FAIL' || upper === 'F' || upper === 'W' || upper === 'WITHHELD') return 'F';
  if (upper === 'ABSENT') return 'ABSENT';
  if (upper === 'NE' || upper === 'NOT ENTERED') return 'NE';
  if (upper === 'X') return 'X';
  return null;
},
  // =====================================================
  // 6. VALIDATION CHECKS
  // =====================================================
  validateData(student, subjects) {
    const warnings = [];

    if (!student.usn) warnings.push('Student USN could not be identified.');
    if (!student.name) warnings.push('Student name could not be identified.');
    if (subjects.length === 0) warnings.push('No subjects could be extracted from the result document.');

    subjects.forEach(sub => {
      if (!sub.marksValidated) {
        warnings.push(`Marks require manual verification for ${sub.subjectCode}.`);
      }
    });

    return [...new Set(warnings)];
  }
};

module.exports = documentExtractor;