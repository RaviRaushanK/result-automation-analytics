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
  parseProductionData(rawText, textItems, resultType) {
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