/**
 * ============================================================
 * SRAAS Hybrid VLM Extractor  (OCR + Vision + LLM)
 * ============================================================
 *
 * Uses THREE free signals together to read a result document:
 *   1. Advanced OCR  — Tesseract (sharp-preprocessed), as today.
 *   2. Vision (VLM)  — Groq qwen/qwen3.8-27b reads the page image(s).
 *   3. LLM reconcile — Groq openai/gpt-oss-20b merges both into strict JSON
 *                      that matches documentExtractor's output contract.
 *
 * The returned object is a DROP-IN for
 * documentExtractor.extract(filePath, resultType) — same envelope and the
 * same `extraction` field shape — so resultController and revaluationExtractor
 * keep working unchanged. If any AI step fails, callers fall back to the
 * classic Tesseract path (see documentExtractor.extract).
 */

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

const ai = require('./aiProviders');
const pageRenderer = require('./pageRenderer');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];
const PDF_EXT = ['.pdf'];

const VLM_SYSTEM_PROMPT = [
    'You are an expert document-reading assistant for university result',
    'marks cards (VTU-style). Transcribe the page EXACTLY as printed.',
    'Return a JSON object only — no prose, no markdown fences.'
].join(' ');

function buildVlmUserPrompt(resultType) {
    return [
        'Transcribe this result marks card into JSON with this schema:',
        '{ "usn": string|null, "name": string|null, "semester": number|null,',
        '  "subjects": [ { "subjectCode": string, "subjectName": string|null,',
        '    "internalMarks": number|null, "externalMarks": number|null,',
        '    "totalMarks": number|null, "oldMarks": number|null,',
        '    "oldResult": "P"|"F"|"A"|"W"|"NE"|null, "rvMarks": number|null,',
        '    "rvResult": "P"|"F"|"A"|"W"|"NE"|null, "finalMarks": number|null,',
        '    "finalResult": "P"|"F"|"A"|"W"|"NE"|null,',
        '    "result": "P"|"F"|"A"|"W"|"NE"|null,',
        '    "confidence": "high"|"medium"|"low" } ] }',
        'Rules:',
        '- Read characters precisely; keep subject codes verbatim.',
        '- Normal result card: use internalMarks + externalMarks.',
        '- Revaluation card: read internalMarks and each independent oldMarks/oldResult, rvMarks/rvResult, finalMarks/finalResult cell.',
        '- finalMarks on a revaluation card is the printed final external mark, NOT internalMarks + rvMarks.',
        'Document type: ' + resultType,
        '- Use null for anything not printed. Do not guess marks.',
        '- confidence reflects how clearly each row was readable.'
    ].join('\n');
}

const LLM_SYSTEM_PROMPT = [
    'You reconcile OCR text and a vision-model transcription of the same',
    'university result marks card into one authoritative structured JSON.',
    'Prefer values that agree in BOTH sources; when they disagree, prefer the',
    'vision reading if its confidence is high, otherwise the OCR. Never invent',
    'marks. Output JSON only — no prose, no markdown fences.'
].join(' ');

function buildLlmUserPrompt({ resultType, ocrTexts, visionJson, schemaHint }) {
    const visionPart = JSON.stringify(visionJson || {}, null, 2);
    return [
        `Document type: ${resultType}`,
        '',
        '=== SOURCE 1: Tesseract OCR TEXT ===',
        (ocrTexts && ocrTexts.length ? ocrTexts.join('\n--- page break ---\n') : '(no OCR text)'),
        '',
        '=== SOURCE 2: VISION MODEL JSON ===',
        visionPart,
        '',
        '=== TASK ===',
        'Merge the two sources into the final JSON with this exact schema:',
        schemaHint
    ].join('\n');
}

function buildOutputSchemaHint(resultType) {
    const base = [
        '{ "usn": string|null, "name": string|null, "semester": number|null,',
        '  "subjects": [ { "subjectCode": string, "subjectName": string|null,',
        '    "internalMarks": number|null, "externalMarks": number|null,',
        '    "totalMarks": number|null, "oldMarks": number|null,',
        '    "oldResult": "P"|"F"|"A"|"W"|"NE"|null, "rvMarks": number|null,',
        '    "rvResult": "P"|"F"|"A"|"W"|"NE"|null, "finalMarks": number|null,',
        '    "finalResult": "P"|"F"|"A"|"W"|"NE"|null,',
        '    "result": "P"|"F"|"A"|"W"|"NE"|null,',
        '    "confidence": "high"|"medium"|"low" } ] }'
    ].join('\n');
    return resultType === 'revaluation'
        ? base + '\n(Revaluation card: preserve internalMarks and each printed old/RV/final mark and result letter independently. finalMarks is NOT an internal-plus-external total.)'
        : base + '\n(Normal card: prioritise internalMarks + externalMarks and totalMarks.)';
}

// Advanced OCR (Tesseract) — same preprocessing documentExtractor uses.
async function runTesseractOcr(imageBuffer) {
    const sharp = require('sharp');
    const processed = await sharp(imageBuffer)
        .rotate()
        .resize({ width: 2400, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();

    const worker = await Tesseract.createWorker('eng', 1, {});
    try {
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        const result = await worker.recognize(processed, {}, { text: true });
        return (result && result.data && result.data.text) ? result.data.text.trim() : '';
    } finally {
        try { await worker.terminate(); } catch (_) { /* ignore */ }
    }
}


// ------------------------------------------------------------
// Normalisation helpers (mirror documentExtractor's semantics)
// ------------------------------------------------------------
function toMark(v) {
    if (v === null || v === undefined || v === '') return null;
    const text = String(v).trim();
    if (!/^\d{1,3}$/.test(text)) return null;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > 100) return null;
    return n;
}

function normalizeResultToken(token) {
    if (!token) return null;
    const u = String(token).trim().toUpperCase();
    if (u === 'P' || u === 'PASS') return 'P';
    if (u === 'F' || u === 'FAIL' || u === 'W' || u === 'WITHHELD') return 'F';
    if (u === 'A' || u === 'ABSENT') return 'A';
    if (u === 'NE' || u === 'X') return 'NE';
    return null;
}

function normalizeUsn(usn) {
    const s = String(usn || '')
        .toUpperCase()
        .replace(/I/g, '1')
        .replace(/O/g, '0')
        .replace(/[^A-Z0-9]/g, '');
    if (s.length > 10) return s.slice(0, 7) + s.slice(-3);
    return s;
}

function cleanConfidence(c) {
    const v = String(c || '').toLowerCase();
    return ['high', 'medium', 'low'].includes(v) ? v : 'medium';
}

function isDocument(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.subjects));
}

function isCompleteRow(row, resultType) {
    if (!row || !row.subjectCode) return false;
    const marks = resultType === 'revaluation'
        ? [row.internalMarks, row.oldMarks, row.rvMarks, row.finalMarks]
        : [row.internalMarks, row.externalMarks];
    const statuses = resultType === 'revaluation'
        ? [row.oldResult, row.rvResult, row.finalResult] : [row.result];
    return marks.every(value => toMark(value) !== null) &&
        statuses.every(value => normalizeResultToken(value) !== null);
}

function reconcileReadings(vision, reconciled, resultType, warnings) {
    if (!isDocument(reconciled)) return vision;
    if (vision.usn && reconciled.usn && normalizeUsn(vision.usn) !== normalizeUsn(reconciled.usn)) {
        warnings.push('The AI readings disagree on the student USN. Check the identity against the original card.');
        return vision;
    }
    const codeOf = row => String(row?.subjectCode || '').trim().toUpperCase();
    const visionRows = new Map(vision.subjects.map(row => [codeOf(row), row]).filter(([code]) => code));
    const seen = new Set();
    const subjects = [];
    const fields = resultType === 'revaluation'
        ? ['internalMarks', 'oldMarks', 'oldResult', 'rvMarks', 'rvResult', 'finalMarks', 'finalResult']
        : ['internalMarks', 'externalMarks', 'result'];
    const valueOf = (row, field) => /result$/i.test(field) ? normalizeResultToken(row[field]) : toMark(row[field]);
    for (const row of reconciled.subjects) {
        const code = codeOf(row);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        const observed = visionRows.get(code);
        if (observed && isCompleteRow(observed, resultType) && !isCompleteRow(row, resultType)) {
            subjects.push(observed);
            warnings.push('An incomplete AI reconciliation for ' + code + ' was replaced with its vision reading. Verify the marks.');
        } else if (observed && isCompleteRow(observed, resultType) && isCompleteRow(row, resultType) &&
            fields.some(field => valueOf(row, field) !== valueOf(observed, field))) {
            subjects.push({ ...row, confidence: 'low' });
            warnings.push('AI readings disagree on marks or status for ' + code + '. Verify this row against the original card.');
        } else {
            subjects.push(row);
        }
    }
    for (const [code, row] of visionRows) {
        if (seen.has(code)) continue;
        subjects.push(row);
        warnings.push('Subject ' + code + ' was retained from vision because reconciliation omitted it. Verify the row.');
    }
    return {
        ...vision, ...reconciled,
        usn: reconciled.usn || vision.usn,
        name: reconciled.name || vision.name,
        semester: reconciled.semester ?? vision.semester,
        subjects
    };
}

// ------------------------------------------------------------
// Build the `extraction` payload in documentExtractor's shape
// ------------------------------------------------------------
function buildExtraction({ filePath, resultType, merged, rawText, extractionMethod, pageCount }) {
    const student = {};
    if (merged.usn) {
        student.usn = String(merged.usn).toUpperCase();
        student.usnRaw = student.usn;
        student.usnNormalized = normalizeUsn(merged.usn);
    }
    if (merged.name) student.name = String(merged.name).replace(/\s+/g, ' ').trim();

    const semester = Number.isFinite(merged.semester) ? Number(merged.semester) : null;

    const subjects = [];
    for (const row of (Array.isArray(merged.subjects) ? merged.subjects : [])) {
        const code = row && row.subjectCode ? String(row.subjectCode).trim().toUpperCase() : '';
        if (!code) continue;
        const confidence = cleanConfidence(row.confidence);

        if (resultType === 'revaluation') {
            subjects.push({
                subjectCode: code,
                subjectName: row.subjectName || '',
                internalMarks: toMark(row.internalMarks),
                oldMarks: toMark(row.oldMarks),
                oldResult: normalizeResultToken(row.oldResult),
                oldResultRaw: row.oldResult || null,
                rvMarks: toMark(row.rvMarks),
                rvResult: normalizeResultToken(row.rvResult),
                rvResultRaw: row.rvResult || null,
                finalMarks: toMark(row.finalMarks),
                finalResult: normalizeResultToken(row.finalResult),
                finalResultRaw: row.finalResult || null,
                marksConfidence: confidence,
                marksValidated: confidence === 'high' && isCompleteRow(row, resultType),
                parsingMethod: extractionMethod,
                rawLine: row.rawLine || ''
            });
        } else {
            const internalMarks = toMark(row.internalMarks);
            const externalMarks = toMark(row.externalMarks);
            const totalMarks = row.totalMarks != null
                ? toMark(row.totalMarks)
                : (internalMarks !== null && externalMarks !== null ? internalMarks + externalMarks : null);
            subjects.push({
                subjectCode: code,
                subjectName: row.subjectName || '',
                subjectType: /LAB/i.test(code) || /LABORATORY|LAB/i.test(row.subjectName || '') ? 'lab' : 'theory',
                internalMarks,
                externalMarks,
                totalMarks,
                result: normalizeResultToken(row.result),
                marksConfidence: confidence,
                marksValidated: confidence === 'high' && isCompleteRow(row, resultType)
            });
        }
    }

    const warnings = [];
    if (!student.usn) warnings.push('Student USN could not be identified.');
    if (!student.name) warnings.push('Student name could not be identified.');
    if (subjects.length === 0) warnings.push('No subjects could be extracted from the result document.');

    return {
        documentType: path.extname(filePath).replace('.', ''),
        extractionMethod,
        rawText: rawText || '',
        resultType,
        student,
        semester,
        subjects,
        metadata: { semester },
        parsingWarnings: [],
        lines: (rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean),
        warnings,
        pageCount
    };
}

// ------------------------------------------------------------
// Public API — matches documentExtractor.extract(filePath, resultType)
// ------------------------------------------------------------
const vlmExtractor = {

    isAvailable() {
        return ai.isConfigured();
    },

    async extract(filePath, resultType = 'original') {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        if (!ai.isConfigured()) {
            throw new Error('AI extraction is not configured (GROQ_API_KEY missing).');
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!IMAGE_EXT.includes(ext) && !PDF_EXT.includes(ext)) {
            throw new Error(`Unsupported file type: ${ext}`);
        }

        // 1. Rasterise the document to page images (needed for scanned PDFs).
        const pageImages = await pageRenderer.documentToImages(filePath);
        if (!pageImages.length) throw new Error('No page images could be produced from the document.');

        // 2. Run advanced OCR + Vision in parallel across pages.
        const ocrTexts = [];
        const visionPerPage = [];
        const stages = { ocr: { pages: [] }, vision: { pages: [] }, llm: { status: 'pending' } };
        const stageWarnings = [];
        for (const img of pageImages) {
            const base64 = img.buffer.toString('base64');
            const [ocrText, visionText] = await Promise.all([
                runTesseractOcr(img.buffer).then(text => {
                    stages.ocr.pages.push({ page: img.pageNumber, status: text ? 'ok' : 'empty' });
                    return text;
                }).catch(err => {
                    stages.ocr.pages.push({ page: img.pageNumber, status: 'failed' });
                    console.warn('[vlmExtractor] OCR failed for page', img.pageNumber, err.message);
                    return '';
                }),
                ai.vision({
                    imageBase64: base64,
                    mime: img.mime || 'image/png',
                    systemPrompt: VLM_SYSTEM_PROMPT,
                    userText: buildVlmUserPrompt(resultType),
                    jsonMode: true
                }).then(text => {
                    const parsed = ai.safeJsonParse(text, null);
                    if (!isDocument(parsed)) throw new Error('Vision returned an invalid document schema');
                    const status = parsed.subjects.length
                        ? (parsed.subjects.every(row => isCompleteRow(row, resultType)) ? 'ok' : 'partial') : 'empty';
                    stages.vision.pages.push({ page: img.pageNumber, status });
                    return parsed;
                }).catch(err => {
                    stages.vision.pages.push({ page: img.pageNumber, status: 'failed' });
                    console.warn('[vlmExtractor] Vision failed for page', img.pageNumber, err.message);
                    return { subjects: [] };
                })
            ]);
            ocrTexts.push(`[page ${img.pageNumber}]\n${ocrText}`);
            visionPerPage.push(visionText);
        }

        for (const stage of ['ocr', 'vision']) {
            const pages = stages[stage].pages;
            stages[stage].status = pages.every(page => page.status === 'ok') ? 'ok'
                : pages.some(page => ['ok', 'partial'].includes(page.status)) ? 'partial' : 'failed';
            if (stages[stage].status !== 'ok') {
                stageWarnings.push((stage === 'ocr' ? 'Text OCR' : 'Vision reading') +
                    ' was incomplete or unavailable on some pages. Verify the extracted rows against the card.');
            }
        }

        // Merge vision output across pages (subjects concatenated).
        const mergedVision = { usn: null, name: null, semester: null, subjects: [] };
        for (const v of visionPerPage) {
            if (!v || typeof v !== 'object') continue;
            if (!mergedVision.usn && v.usn) mergedVision.usn = v.usn;
            if (!mergedVision.name && v.name) mergedVision.name = v.name;
            if (mergedVision.semester == null && v.semester != null) mergedVision.semester = v.semester;
            if (Array.isArray(v.subjects)) mergedVision.subjects.push(...v.subjects);
        }

        const combinedOcr = ocrTexts.join('\n');

        // 3. Reconcile OCR + Vision with the LLM into strict JSON.
        const schemaHint = buildOutputSchemaHint(resultType);
        let merged;
        try {
            const llmOut = await ai.complete({
                systemPrompt: LLM_SYSTEM_PROMPT,
                userText: buildLlmUserPrompt({
                    resultType, ocrTexts: [combinedOcr], visionJson: mergedVision, schemaHint
                }),
                jsonMode: true
            });
            merged = ai.safeJsonParse(llmOut, null);
            if (!isDocument(merged)) throw new Error('Reconciliation returned an invalid document schema');
            stages.llm.status = merged.subjects.length
                ? (merged.subjects.every(row => isCompleteRow(row, resultType)) ? 'ok' : 'partial') : 'empty';
        } catch (err) {
            console.warn('[vlmExtractor] LLM reconcile failed, using vision-only merge:', err.message);
            merged = null;
            stages.llm.status = 'failed';
            stageWarnings.push('AI reconciliation was unavailable. Verify the remaining extraction against the original card.');
        }

        const warningCount = stageWarnings.length;
        merged = reconcileReadings(mergedVision, merged, resultType, stageWarnings);
        if (stageWarnings.length > warningCount && stages.llm.status === 'ok') stages.llm.status = 'partial';

        const extractionMethod = 'vlm-hybrid';
        const extraction = buildExtraction({
            filePath, resultType, merged,
            rawText: combinedOcr || JSON.stringify(mergedVision),
            extractionMethod,
            pageCount: pageImages.length
        });
        extraction.stages = stages;
        extraction.warnings.push(...stageWarnings);

        return {
            success: true,
            message: 'Result document extracted with hybrid OCR + VLM + LLM',
            file: path.basename(filePath),
            extraction
        };
    }
};

module.exports = vlmExtractor;

