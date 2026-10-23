'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');


test('equivalent numeric and status representations do not produce disagreement warnings', async () => {
    const { extractor } = fixture({ merged: card({ ...normalRow, internalMarks: '30', externalMarks: '20', result: 'PASS' }) });
    const { extraction } = await extractor.extract('synthetic.png');
    assert.equal(extraction.warnings.length, 0);
    assert.equal(extraction.subjects[0].marksValidated, true);
});
const normalRow = { subjectCode: 'MMC105', subjectName: 'WEB TECHNOLOGIES', internalMarks: 30, externalMarks: 20, result: 'P', confidence: 'high' };
const revalRow = { ...normalRow, oldMarks: 15, oldResult: 'F', rvMarks: 20, rvResult: 'P', finalMarks: 20, finalResult: 'P' };
const card = row => ({ usn: '1MV25MC999', name: 'TEST STUDENT', semester: 1, subjects: [row] });

function fixture(options = {}) {
    const state = { parameters: [], terminated: 0, visionPrompts: [], llmPrompts: [] };
    const source = card(options.row || normalRow);
    const chain = {};
    for (const method of ['rotate', 'resize', 'grayscale', 'normalize', 'sharpen', 'png']) chain[method] = () => chain;
    chain.toBuffer = async () => Buffer.from('synthetic page');
    const worker = {
        setParameters: async value => state.parameters.push(value),
        recognize: async (input, settings, outputs) => {
            assert.equal(outputs.text, true);
            if (options.ocrFails) throw new Error('OCR offline');
            return { data: { text: options.ocrText ?? 'University Seat Number 1MV25MC999 TEST STUDENT MMC105 30 20 P' } };
        },
        terminate: async () => { state.terminated++; }
    };
    const ai = {
        isConfigured: () => true,
        safeJsonParse(text, fallback) { try { return JSON.parse(text); } catch (_) { return fallback; } },
        vision: async input => {
            state.visionPrompts.push(input.userText);
            if (options.visionFails) throw new Error('Vision offline');
            return JSON.stringify(options.vision === undefined ? source : options.vision);
        },
        complete: async input => {
            state.llmPrompts.push(input.userText);
            if (options.llmFails) throw new Error('LLM offline');
            return JSON.stringify(options.merged === undefined ? source : options.merged);
        }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/vlmExtractor.js'), 'utf8'), {
        module, exports: module.exports, Buffer, console: { warn() {} },
        require(name) {
            if (name === './academicIntegrity') return require('../services/academicIntegrity');
            if (name === 'fs') return { existsSync: () => true };
            if (name === 'sharp') return () => chain;
            if (name === 'tesseract.js') return { createWorker: async () => worker };
            if (name === './aiProviders') return ai;
            if (name === './pageRenderer') return {
                documentToImages: async () => Array.from({ length: options.pages || 1 }, (_, i) => ({ pageNumber: i + 1, buffer: Buffer.from('synthetic page'), mime: 'image/png' }))
            };
            return require(name);
        }
    });
    return { extractor: module.exports, state };
}

for (const extension of ['png', 'jpg', 'jpeg', 'pdf']) {
    for (const resultType of ['original', 'revaluation']) {
        test(extension + ' runs OCR, vision and LLM with the full ' + resultType + ' contract', async () => {
            const { extractor, state } = fixture({ row: resultType === 'revaluation' ? revalRow : normalRow });
            const { extraction } = await extractor.extract('synthetic.' + extension, resultType);
            assert.equal(extraction.stages.ocr.status, 'ok');
            assert.equal(extraction.stages.vision.status, 'ok');
            assert.equal(extraction.stages.llm.status, 'ok');
            assert.equal(extraction.subjects[0].internalMarks, 30);
            assert.equal(extraction.subjects[0].marksValidated, true);
            assert.equal(extraction.warnings.length, 0);
            assert.equal(state.parameters[0].tessedit_pageseg_mode, '6');
            assert.equal(state.parameters[0].preserve_interword_spaces, '1');
            assert.equal(state.terminated, 1);
            assert.equal(state.visionPrompts.length, 1);
            assert.equal(state.llmPrompts.length, 1);
            assert.match(state.llmPrompts[0], /SOURCE 1: Tesseract OCR TEXT/);
            assert.match(state.llmPrompts[0], /SOURCE 2: VISION MODEL JSON/);
            if (resultType === 'revaluation') {
                for (const field of ['internalMarks', 'oldMarks', 'oldResult', 'rvMarks', 'rvResult', 'finalMarks', 'finalResult']) assert.ok(state.visionPrompts[0].includes(field));
                assert.match(state.visionPrompts[0], /NOT internalMarks \+ rvMarks/);
                assert.equal(extraction.subjects[0].finalMarks, 20);
                assert.equal(extraction.subjects[0].oldResult, 'F');
            }
        });
    }
}

test('LLM outage, malformed schema and empty response cannot discard vision rows', async () => {
    for (const options of [{ llmFails: true }, { merged: {} }, { merged: [] }, { merged: { subjects: [] } }]) {
        const { extractor } = fixture({ row: revalRow, ...options });
        const { extraction } = await extractor.extract('synthetic.png', 'revaluation');
        assert.equal(extraction.subjects.length, 1);
        assert.equal(extraction.subjects[0].finalMarks, 20);
        assert.notEqual(extraction.stages.llm.status, 'ok');
        assert.ok(extraction.warnings.length);
    }
});

test('incomplete LLM marks preserve independently read vision cells', async () => {
    const { extractor } = fixture({ row: revalRow, merged: card({ ...revalRow, rvMarks: null, oldResult: null }) });
    const { extraction } = await extractor.extract('synthetic.png', 'revaluation');
    assert.equal(extraction.subjects[0].rvMarks, 20);
    assert.equal(extraction.subjects[0].oldResult, 'F');
    assert.equal(extraction.stages.llm.status, 'partial');
    assert.match(extraction.warnings.join(' '), /incomplete AI reconciliation/);
});

test('omitted vision subjects survive partial LLM reconciliation without duplicates', async () => {
    const second = { ...normalRow, subjectCode: 'MMC104' };
    const { extractor } = fixture({ vision: { ...card(normalRow), subjects: [normalRow, second] }, merged: { ...card(normalRow), subjects: [normalRow, normalRow] } });
    const { extraction } = await extractor.extract('synthetic.pdf');
    assert.deepEqual(Array.from(extraction.subjects, row => row.subjectCode), ['MMC105', 'MMC104']);
    assert.equal(extraction.stages.llm.status, 'partial');
});

test('identity conflicts cannot combine reconciled marks with a different vision student', async () => {
    const { extractor } = fixture({ merged: { ...card({ ...normalRow, internalMarks: 99 }), usn: '1MV25MC888' } });
    const { extraction } = await extractor.extract('synthetic.png');
    assert.equal(extraction.student.usn, '1MV25MC999');
    assert.equal(extraction.subjects[0].internalMarks, 30);
    assert.match(extraction.warnings.join(' '), /disagree on the student USN/);
});

test('disagreeing AI readings lower confidence and require row verification', async () => {
    const { extractor } = fixture({ merged: card({ ...normalRow, externalMarks: 25 }) });
    const { extraction } = await extractor.extract('synthetic.png');
    assert.equal(extraction.subjects[0].marksConfidence, 'low');
    assert.equal(extraction.subjects[0].marksValidated, false);
    assert.match(extraction.warnings.join(' '), /disagree on marks or status/);
});

test('invalid mark syntax is rejected rather than silently changed to a different number', async () => {
    for (const value of ['-5', '1.5', '20/50', 'abc20', true, 101, 'Infinity']) {
        const row = { ...normalRow, internalMarks: value };
        const { extractor } = fixture({ row });
        const { extraction } = await extractor.extract('synthetic.png');
        assert.equal(extraction.subjects[0].internalMarks, null, String(value));
        assert.equal(extraction.subjects[0].marksValidated, false, String(value));
        assert.notEqual(extraction.stages.vision.status, 'ok');
    }
    const { extractor } = fixture({ row: { ...normalRow, internalMarks: '0', externalMarks: 0 } });
    assert.equal((await extractor.extract('synthetic.png')).extraction.subjects[0].internalMarks, 0);
});

test('OCR failure is diagnosed, worker is released, and usable AI rows remain available', async () => {
    const { extractor, state } = fixture({ ocrFails: true });
    const { extraction } = await extractor.extract('synthetic.png');
    assert.equal(state.terminated, 1);
    assert.equal(extraction.stages.ocr.status, 'failed');
    assert.equal(extraction.stages.vision.status, 'ok');
    assert.equal(extraction.subjects.length, 1);
    assert.match(extraction.warnings.join(' '), /Text OCR/);
});

test('vision failure or invalid schema is visible while OCR-fed LLM remains usable', async () => {
    for (const options of [{ visionFails: true }, { vision: [] }, { vision: {} }]) {
        const { extractor } = fixture(options);
        const { extraction } = await extractor.extract('synthetic.png');
        assert.equal(extraction.stages.vision.status, 'failed');
        assert.equal(extraction.stages.llm.status, 'ok');
        assert.equal(extraction.subjects.length, 1);
        assert.match(extraction.warnings.join(' '), /Vision reading/);
    }
});

test('total AI outage produces no invented rows and preserves OCR for local recovery', async () => {
    const { extractor } = fixture({ llmFails: true, visionFails: true });
    const { extraction } = await extractor.extract('synthetic.png');
    assert.equal(extraction.subjects.length, 0);
    assert.match(extraction.rawText, /MMC105 30 20 P/);
    assert.equal(extraction.stages.llm.status, 'failed');
    assert.equal(extraction.stages.vision.status, 'failed');
});

test('each rasterized PDF page runs all stages with page-specific diagnostics', async () => {
    const { extractor, state } = fixture({ pages: 2 });
    const { extraction } = await extractor.extract('synthetic.pdf');
    assert.equal(state.visionPrompts.length, 2);
    assert.equal(state.terminated, 2);
    assert.equal(state.llmPrompts.length, 1);
    assert.equal(extraction.stages.ocr.pages.length, 2);
    assert.equal(extraction.stages.vision.pages.length, 2);
    assert.equal(extraction.subjects.length, 1);
});

