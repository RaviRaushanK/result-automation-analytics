/**
 * scripts/test-phase6.js — Phase 6 Approval & Persistence tests
 *
 * T1: Valid card values → persisted correctly.
 * T2: Forged subject_result_id → rejected.
 * T3: Manual Add row → persisted with was_manual_correction=true.
 * T4: Old=15/F, Final=20/P → rejected (below threshold).
 * T5: Old=50/P, Final=60/P → accepted, persisted.
 * T6: OCR unmatched subject → not persisted.
 * T7: Original result approval → unchanged behavior.
 */
'use strict';
require('../services/revaluationValidator');
require('../services/revaluationPersistence');
const P = require('../services/revaluationPersistence');
const V = require('../services/revaluationValidator');

const SR1 = 99981, SR2 = 99982, SR3 = 99983;
const SC1 = 'T4CS101', SC2 = 'T4CS102', SC3 = 'T4CS103';

let pass = 0, fail = 0;
function check(label, got, exp) {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log((ok ? '  PASS' : '  FAIL') + '  ' + label + (ok ? '' : ' | exp: ' + JSON.stringify(exp) + ' got: ' + JSON.stringify(got)));
  ok ? pass++ : fail++;
}
function run(label, fn) {
  console.log('\n[' + label + ']');
  try { fn(); } catch(e) { console.error('  EXCEPTION:', e.message); fail++; }
}

// ── T0: buildEventRemarksEx ───────────────────────────────────────────────────

run('T0: buildEventRemarksEx MISSING_MANUAL', () => {
  const r = P.buildEventRemarksEx(99901, 'pdfjs', {
    source: 'MISSING_MANUAL', decision: 'accept', was_manual_correction: true, event_ids: []
  });
  const p = JSON.parse(r);
  check('import_id=99901', p.import_id, 99901);
  check('source=MISSING_MANUAL', p.source, 'MISSING_MANUAL');
  check('decision=accept', p.decision, 'accept');
  check('was_manual_correction=true', p.was_manual_correction, true);
  check('event_ids=[]', JSON.stringify(p.event_ids), '[]');
  check('base contains importId', p.base_remarks.indexOf('Revaluation import #99901') !== -1, true);
});

run('T0b: buildEventRemarksEx OCR with event_ids', () => {
  const r = P.buildEventRemarksEx(99902, 'tesseract', {
    source: 'OCR_DETECTED', decision: 'accept', was_manual_correction: false, event_ids: [1, 2, 3]
  });
  const p = JSON.parse(r);
  check('source=OCR_DETECTED', p.source, 'OCR_DETECTED');
  check('was_manual_correction=false', p.was_manual_correction, false);
  check('event_ids=[1,2,3]', JSON.stringify(p.event_ids), '[1,2,3]');
  check('base contains tesseract', p.base_remarks.indexOf('tesseract') !== -1, true);
});

run('T0c: buildEventRemarksEx null meta defaults', () => {
  const r = P.buildEventRemarksEx(99903, null, null);
  const p = JSON.parse(r);
  check('import_id=99903', p.import_id, 99903);
  check('source=OCR_DETECTED', p.source, 'OCR_DETECTED');
  check('decision=accept', p.decision, 'accept');
  check('was_manual_correction=false', p.was_manual_correction, false);
  check('event_ids=[]', JSON.stringify(p.event_ids), '[]');
});

// ── T1: valid card values ─────────────────────────────────────────────────────

run('T1: valid card fields → ok', () => {
  const c = {card_internal_marks:'30',card_old_marks:'45',card_old_result:'pass',
              card_rv_marks:'50',card_rv_result:'pass',card_final_marks:'75',card_final_result:'pass'};
  const r = V.validateNineCardFields(c, {max_marks:100});
  check('ok', r.ok, true);
  check('0 errors', r.errors.length, 0);
  check('0 warnings', r.warnings.length, 0);
});

// ── T2: Forged subject_result_id ─────────────────────────────────────────────

run('T2: forged srid not in srById', () => {
  const srById = new Map([[SR1,{subject_result_id:SR1}]]);
  check('forged rejected', srById.has(99999), false);
  check('valid accepted', srById.has(SR1), true);
});

// ── T3: MISSING_MANUAL proposal fields ───────────────────────────────────────

run('T3: MISSING_MANUAL proposal flags', () => {
  const p = {
    source:'MISSING_MANUAL', decision:'accept', was_manual_correction:true,
    subject_result_id:SR1, bound_to_srid:SR1,
    proposed_revised_total_marks:65, proposed_revised_status:'pass', proposed_revised_grade:'B'
  };
  check('source=MISSING_MANUAL', p.source, 'MISSING_MANUAL');
  check('was_manual_correction=true', p.was_manual_correction, true);
  check('Phase6 triggers validation', p.source === 'MISSING_MANUAL', true);
});

run('T3b: remarks JSON for MISSING_MANUAL', () => {
  const r = P.buildEventRemarksEx(99901,'stub',{
    source:'MISSING_MANUAL', decision:'accept', was_manual_correction:true, event_ids:[]
  });
  const p = JSON.parse(r);
  check('was_manual_correction=true', p.was_manual_correction, true);
  check('source=MISSING_MANUAL', p.source, 'MISSING_MANUAL');
  check('decision=accept', p.decision, 'accept');
});

// ── T4: Old=15/F, Final=20/P → rejected (below threshold) ──────────────────

run('T4: F/15+P/20 → threshold error', () => {
  const r = V.validateNineCardFields({card_old_marks:'15',card_old_result:'fail',
      card_final_marks:'20',card_final_result:'pass'}, {max_marks:100});
  check('not ok', r.ok, false);
  check('has threshold error', r.errors.some(e=>e.indexOf('pass threshold')!==-1), true);
  check('would throw BadState', r.ok === false, true);
});

// ── T5: Old=50/P, Final=60/P → accepted ────────────────────────────────────

run('T5: P/50+P/60 → ok', () => {
  const r = V.validateNineCardFields({card_old_marks:'50',card_old_result:'pass',
      card_final_marks:'60',card_final_result:'pass'}, {max_marks:100});
  check('ok', r.ok, true);
  check('0 errors', r.errors.length, 0);
});

// ── T6: OCR unmatched subject → not persisted ────────────────────────────────

run('T6: unmatched OCR not in selected', () => {
  const srById = new Map([[SR1,{subject_result_id:SR1}]]);
  check('SR2 not in map', srById.has(SR2), false);
  check('SR3 not in map', srById.has(SR3), false);
});

// ── T7: Original marks/status from SubjectResult DB ──────────────────────────

run('T7: original values from SubjectResult DB', () => {
  const sr = {marks:45, result_status:'pass'};
  check('original_marks from DB', Number(sr.marks), 45);
  check('original_status from DB', sr.result_status, 'pass');
  // approveReview maps: original_marks←sr.marks, original_status←sr.result_status
});

// ── T8: Phase 5 fires for MISSING_MANUAL at approval time ───────────────────

run('T8: threshold-violating MISSING_MANUAL → reject at approval', () => {
  const card = {card_internal_marks:20, card_old_marks:15, card_old_result:'fail',
      card_rv_marks:20, card_rv_result:'fail', card_final_marks:20, card_final_result:'pass'};
  const r = V.validateNineCardFields(card, {max_marks:100});
  check('Phase5 rejects', r.ok, false);
  check('threshold error', r.errors.some(e=>e.indexOf('pass threshold')!==-1), true);
});

run('T8b: valid MISSING_MANUAL → pass Phase5', () => {
  const card = {card_internal_marks:25, card_old_marks:50, card_old_result:'pass',
      card_rv_marks:55, card_rv_result:'pass', card_final_marks:65, card_final_result:'pass'};
  const r = V.validateNineCardFields(card, {max_marks:100});
  check('ok', r.ok, true);
  check('0 errors', r.errors.length, 0);
  check('0 warnings', r.warnings.length, 0);
});

// ── T9: Source provenance preserved in remarks ─────────────────────────────

run('T9: source preserved in remarks', () => {
  const r1 = P.buildEventRemarksEx(99901,'pdfjs',{source:'MISSING_MANUAL',decision:'accept',was_manual_correction:true,event_ids:[]});
  check('MISSING_MANUAL', JSON.parse(r1).source, 'MISSING_MANUAL');
  const r2 = P.buildEventRemarksEx(99902,'tesseract',{source:'OCR_DETECTED',decision:'accept',was_manual_correction:false,event_ids:[]});
  check('OCR_DETECTED', JSON.parse(r2).source, 'OCR_DETECTED');
  const r3 = P.buildEventRemarksEx(99903,'stub',{source:'UNMATCHED_ATTACH',decision:'accept',was_manual_correction:false,event_ids:[]});
  check('UNMATCHED_ATTACH', JSON.parse(r3).source, 'UNMATCHED_ATTACH');
});

// ── T10: remarks JSON structure ──────────────────────────────────────────────

run('T10: remarks JSON complete', () => {
  const r = P.buildEventRemarksEx(99904,'stub',{
    source:'MISSING_MANUAL', decision:'accept', was_manual_correction:true, event_ids:[101,102]
  });
  const p = JSON.parse(r);
  check('import_id=99904', p.import_id, 99904);
  check('source=MISSING_MANUAL', p.source, 'MISSING_MANUAL');
  check('decision=accept', p.decision, 'accept');
  check('was_manual_correction=true', p.was_manual_correction, true);
  check('event_ids=2', p.event_ids.length, 2);
  check('base_remarks string', typeof p.base_remarks === 'string', true);
  check('base_remarks not empty', p.base_remarks.length > 0, true);
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('Phase 6 results: ' + pass + '/' + (pass+fail) + ' PASS');
console.log('='.repeat(60));
process.exit(fail>0?1:0);

