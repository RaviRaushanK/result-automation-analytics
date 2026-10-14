'use strict';

/**
 * Tests for the AI hybrid extraction pipeline (advanced OCR + VLM + LLM).
 *
 * These tests never hit the network: they stub the Groq clients
 * (services/aiProviders) and the page rasteriser (services/pageRenderer),
 * then assert that services/vlmExtractor produces the SAME `extraction`
 * contract that services/documentExtractor.parseProductionData emits — so
 * resultController and revaluationExtractor keep working unchanged.
 *
 * They also assert that when GROQ_API_KEY is absent, documentExtractor
 * still uses the classic Tesseract path (no regression).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

const aiProvidersPath = path.join(root, 'services', 'aiProviders.js');
const pageRendererPath = path.join(root, 'services', 'pageRenderer.js');
const vlmExtractorPath = path.join(root, 'services', 'vlmExtractor.js');
const documentExtractorPath = path.join(root, 'services', 'documentExtractor.js');

// A real, existing file with a .pdf extension so the extractor's file-exists
// and extension checks pass. Its bytes are irrelevant — pageRenderer is stubbed.
// Created up-front and removed on process exit so no artifact is left behind.
const FIXTURE = path.join(__dirname, '.vlm-fixture.pdf');
fs.writeFileSync(FIXTURE, Buffer.from('%PDF-1.4 test fixture\n'));
process.on('exit', () => { try { fs.unlinkSync(FIXTURE); } catch (_) { /* ignore */ } });

// Fake 1x1 PNG buffer (only used as an image passthrough in tests).
const FAKE_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d49444154789c6360000002000154a24f9f0000000049454e44ae426082',
    'hex'
);

/** Install a stub module into Node's require cache. */
function stubModule(absPath, exports) {
    require.cache[require.resolve(absPath)] = {
        id: absPath, filename: absPath, loaded: true, exports
    };
}

function clearCaches() {
    for (const p of [aiProvidersPath, pageRendererPath, vlmExtractorPath, documentExtractorPath]) {
        delete require.cache[require.resolve(p)];
    }
}

test('vlmExtractor.isAvailable() is false when AI is not configured', () => {
    // Stub isConfigured() to false rather than deleting the env var: the real
    // aiProviders re-loads GROQ_API_KEY from config/.env via dotenv on require,
    // which is correct production behaviour. Stubbing isolates this test from
    // whatever key the developer happens to have configured.
    clearCaches();
    stubModule(aiProvidersPath, {
        isConfigured: () => false,
        vision: async () => '{}',
        complete: async () => '{}',
        safeJsonParse: (t, f) => f
    });
    const vlm = require(vlmExtractorPath);
    assert.equal(typeof vlm.extract, 'function');
    assert.equal(vlm.isAvailable(), false);
    clearCaches();
});

test('vlmExtractor.extract() throws a clear error when not configured', async () => {
    clearCaches();
    stubModule(aiProvidersPath, { isConfigured: () => false });
    const vlm = require(vlmExtractorPath);
    await assert.rejects(
        () => vlm.extract(FIXTURE, 'original'),
        /not configured|GROQ_API_KEY/i
    );
});

test('hybrid extraction matches the legacy documentExtractor contract', async () => {
    process.env.GROQ_API_KEY = 'test-key-1234';
    clearCaches();

    // Stub pageRenderer: return a single fake page image.
    stubModule(pageRendererPath, {
        documentToImages: async () => [{ pageNumber: 1, buffer: FAKE_PNG, mime: 'image/png' }],
        isRenderingAvailable: () => true
    });

    // Stub aiProviders: vision reads the card, LLM returns merged JSON.
    const mergedJson = JSON.stringify({
        usn: '1MV25MC074', name: 'RAHUL KUMAR', semester: 3,
        subjects: [
            { subjectCode: '21CS31', subjectName: 'Maths', internalMarks: 42, externalMarks: 55, totalMarks: 97, result: 'P', confidence: 'high' },
            { subjectCode: '21CS32', subjectName: 'Data Structures', internalMarks: 38, externalMarks: 61, totalMarks: 99, result: 'P', confidence: 'high' }
        ]
    });
    stubModule(aiProvidersPath, {
        isConfigured: () => true,
        VLM_MODEL: 'qwen/qwen3.8-27b',
        LLM_MODEL: 'openai/gpt-oss-20b',
        BASE_URL: 'https://api.groq.com/openai/v1',
        vision: async () => mergedJson,
        complete: async () => mergedJson,
        safeJsonParse: (t, f) => { try { return JSON.parse(t); } catch (_) { return f; } }
    });

    const vlm = require(vlmExtractorPath);
    const result = await vlm.extract(FIXTURE, 'original');

    // --- Envelope --------------------------------------------------------
    assert.equal(result.success, true);
    assert.ok(result.extraction, 'must return an `extraction` object like documentExtractor');
    const ex = result.extraction;

    // --- Identity fields consumed by both controllers --------------------
    assert.equal(ex.extractionMethod, 'vlm-hybrid');
    assert.equal(ex.student.usn, '1MV25MC074');
    assert.equal(ex.student.name, 'RAHUL KUMAR');
    assert.equal(ex.student.usnNormalized, '1MV25MC074');
    assert.equal(ex.semester, 3);

    // --- Subjects shape (resultController reads these exact keys) ---------
    assert.equal(ex.subjects.length, 2);
    const s0 = ex.subjects[0];
    assert.equal(s0.subjectCode, '21CS31');
    assert.equal(s0.internalMarks, 42);
    assert.equal(s0.externalMarks, 55);
    assert.equal(s0.totalMarks, 97);
    assert.equal(s0.result, 'P');
    assert.ok(['high', 'medium', 'low'].includes(s0.marksConfidence));

    // --- Shared contract keys --------------------------------------------
    assert.ok(Array.isArray(ex.warnings));
    assert.equal(ex.warnings.length, 0); // identity + subjects all present
    assert.ok(Array.isArray(ex.lines));
    assert.ok(ex.metadata && ex.metadata.semester === 3);

    // --- USN normalization (I->1, O->0) still applies --------------------
    const aiMod = require.cache[require.resolve(aiProvidersPath)].exports;
    const ocrUsnJson = JSON.stringify({
        usn: 'IMV25MCO074', name: 'X', semester: 1,
        subjects: [{ subjectCode: '21CS31', internalMarks: 40, externalMarks: 50, confidence: 'high' }]
    });
    aiMod.complete = async () => ocrUsnJson;
    aiMod.vision = async () => ocrUsnJson;
    delete require.cache[require.resolve(vlmExtractorPath)];
    const vlm2 = require(vlmExtractorPath);
    const r2 = await vlm2.extract(FIXTURE, 'original');
    assert.equal(r2.extraction.student.usnRaw, 'IMV25MCO074');
    assert.equal(r2.extraction.student.usnNormalized, '1MV25MC074');
});

test('hybrid extraction emits revaluation-shaped subjects', async () => {
    process.env.GROQ_API_KEY = 'test-key-1234';
    clearCaches();

    stubModule(pageRendererPath, {
        documentToImages: async () => [{ pageNumber: 1, buffer: FAKE_PNG, mime: 'image/png' }]
    });

    const revalJson = JSON.stringify({
        usn: '1MV25MC074', name: 'RAHUL KUMAR', semester: 3,
        subjects: [
            { subjectCode: '21CS31', oldMarks: 40, rvMarks: 52, finalMarks: 52, oldResult: 'F', rvResult: 'P', finalResult: 'P', confidence: 'high' }
        ]
    });
    stubModule(aiProvidersPath, {
        isConfigured: () => true,
        vision: async () => revalJson,
        complete: async () => revalJson,
        safeJsonParse: (t, f) => { try { return JSON.parse(t); } catch (_) { return f; } }
    });

    const vlm = require(vlmExtractorPath);
    const result = await vlm.extract(FIXTURE, 'revaluation');
    const ex = result.extraction;

    // revaluationExtractor reads these keys off each subject.
    const s = ex.subjects[0];
    assert.equal(s.subjectCode, '21CS31');
    assert.equal(s.oldMarks, 40);
    assert.equal(s.rvMarks, 52);
    assert.equal(s.finalMarks, 52);
    assert.equal(s.oldResult, 'F');
    assert.equal(s.rvResult, 'P');
    assert.equal(s.finalResult, 'P');
    assert.equal(s.parsingMethod, 'vlm-hybrid');

    clearCaches();
    delete process.env.GROQ_API_KEY;
});

test('documentExtractor stays on classic Tesseract when AI is off', () => {
    // Stub isConfigured() to false (see note above) so this test does not
    // depend on the developer's real config/.env. documentExtractor reads
    // aiProviders.isConfigured() at call time to decide the path.
    process.env.EXTRACTION_MODE = 'auto';
    clearCaches();
    stubModule(aiProvidersPath, { isConfigured: () => false });

    const de = require(documentExtractorPath);
    assert.equal(typeof de.extract, 'function');
    // supportedImageTypes preserved => classic path intact.
    assert.deepEqual(de.supportedImageTypes, ['.jpg', '.jpeg', '.png']);

    clearCaches();
    delete process.env.EXTRACTION_MODE;
});

