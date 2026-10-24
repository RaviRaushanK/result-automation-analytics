'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const rules = require('../public/js/mca-pass-rules');
const policy = require('../services/academicPolicy');
const validator = require('../services/revaluationValidator');
const subject = { subject_type: 'theory', max_internal: 50, max_external: 50, max_marks: 100 };

for (const type of ['theory', 'lab']) {
  for (const [internal, external, status] of [[37,14,'fail'],[24,50,'fail'],[50,19,'fail'],[25,20,'fail'],[25,25,'pass'],[30,20,'pass'],[50,0,'fail'],[0,50,'fail'],[50,50,'pass']]) {
    test(`MCA ${type}: CIE ${internal}, SEE ${external} => ${status}`, () => {
      const definition = { ...subject, subject_type: type };
      assert.equal(rules.evaluate(internal, external, definition).status, status);
      const result = policy.gradeFromComponents(internal, external, definition);
      assert.equal(result.status, status);
      if (status === 'fail') { assert.equal(result.grade, 'F'); assert.equal(result.point, 0); }
    });
  }
}
test('MCA project uses 50% SEE and CIE eligibility, including SEE-only configuration', () => {
  const definition = { ...subject, subject_type: 'project' };
  assert.equal(rules.evaluate(30,20,definition).status, 'fail');
  assert.equal(rules.evaluate(25,25,definition).status, 'pass');
  assert.equal(rules.evaluate(24,50,definition).status, 'fail');
  assert.equal(policy.gradeFromComponents(0,50,{ ...definition, max_internal:0,max_external:100 }).grade,'C');
});
test('thresholds use configured maxima and integer boundaries, without treating missing marks as zero', () => {
  assert.equal(rules.evaluate(50,39,{...subject,max_internal:100,max_external:100,max_marks:200}).status,'fail');
  assert.equal(rules.evaluate(60,40,{...subject,max_internal:100,max_external:100,max_marks:200}).status,'pass');
  assert.equal(rules.evaluate(null,50,subject).valid,false);
  assert.equal(rules.evaluate('30',20,subject).valid,false);
  assert.equal(rules.evaluate(25.5,25,subject).valid,false);
});
test('browser and server use identical MCA requirements', () => {
  const context = { window: {} }; vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/mca-pass-rules'),'utf8'),context);
  for (const [i,e] of [[37,14],[30,20],[24,50],[25,25]]) {
    assert.equal(context.window.McaPassRules.evaluate(i,e,subject).status, rules.evaluate(i,e,subject).status);
  }
});
test('revaluation FAIL above total pass band is valid when a component fails; a forged PASS is blocked', () => {
  const card = { card_internal_marks:37,card_old_marks:14,card_old_result:'fail',card_rv_marks:14,
    card_rv_result:'fail',card_final_marks:51,card_final_result:'fail' };
  assert.equal(validator.validateNineCardFields(card,subject).ok,true);
  assert.equal(validator.validateNineCardFields({...card,card_final_result:'pass'},subject).ok,false);
  assert.equal(validator.validateNineCardFields({...card,card_rv_marks:20,card_rv_result:'pass',card_final_marks:57,card_final_result:'pass'},subject).ok,true);
});
