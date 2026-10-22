'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const validator = require('../public/js/accountEmailValidation');
const db = require('../database/models');
after(() => db.sequelize.close());

test('account emails accept conventional personal and institutional addresses and reject malformed input', () => {
  for (const email of ['staff@college.ac.in', 'student+results@gmail.com', "o'connor@college.edu", 'first.last@dept.college.edu']) assert.equal(validator.validate(email).valid, true, email);
  assert.equal(validator.validate(' STAFF@COLLEGE.AC.IN ').value, 'staff@college.ac.in');
  // Syntax does not decide whether a particular provider/domain exists.
  assert.equal(validator.validate('staff@new-provider.education').valid, true);
  assert.equal(validator.validate('staff@college.edu').valid, true);
  for (const email of [null, {}, ['a@b.com'], '', 'a@localhost', '.a@college.edu', 'a.@college.edu', 'a..b@college.edu', 'a@@college.edu', 'a@-college.edu', 'a@college-.edu', 'a@college..edu', 'a b@college.edu', 'a@college.123', 'a@college.edu\r\n', '<a>@college.edu', 'a@college.edu,other@gmail.com', 'a'.repeat(65) + '@college.edu', 'a'.repeat(64) + '@' + 'b'.repeat(32) + '.edu']) assert.equal(validator.validate(email).valid, false, String(email));
});

test('browser applies the same rules, blocks invalid submission and normalizes valid input', () => {
  const events = {}, formEvents = {}; let message, prevented = false, reported = false;
  const feedback = {}; let invalidClass;
  const input = { value: 'a..b@college.edu', getAttribute: () => 'new-email-error', classList: { toggle: (name, enabled) => { invalidClass = enabled; } }, addEventListener: (key, callback) => { events[key] = callback; }, form: { addEventListener: (key, callback) => { formEvents[key] = callback; } }, setCustomValidity: value => { message = value; }, setAttribute() {}, reportValidity: () => { reported = true; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/accountEmailValidation'), 'utf8'), { window: { document: { querySelectorAll: () => [input], getElementById: () => feedback } } });
  events.input(); assert.ok(message);
  assert.match(feedback.textContent, /valid email address/); assert.equal(feedback.hidden, false); assert.equal(invalidClass, true);
  input.value = ''; events.invalid(); assert.equal(feedback.hidden, false);
  formEvents.submit({ preventDefault: () => { prevented = true; } }); assert.ok(prevented); assert.ok(reported);
  input.value = ' Staff@College.edu '; events.blur(); assert.equal(input.value, 'staff@college.edu'); assert.equal(message, '');
  assert.equal(feedback.hidden, true); assert.equal(invalidClass, false);
});

test('registration and account email requests reject invalid emails before database access or OTP delivery', async () => {
  const registration = require('../services/registrationService');
  const settings = require('../services/settingsService');
  for (const email of ['a..b@college.edu', 'a@college..edu', { email: 'a@college.edu' }]) {
    await assert.rejects(registration.invite(1, email), { status: 400 });
    await assert.rejects(settings.requestChangeEmail({ new_email: email }, 1), error => error.status === 422 && Boolean(error.errors.new_email));
  }
  await assert.rejects(registration.start('a'.repeat(64), 'b'.repeat(64), { email: 'changed@gmail.com' }), /Unsupported registration field/);
});

test('domain checks distinguish deliverable domains, nonexistent domains, null MX and temporary failures', async () => {
  const { validateDeliverable } = require('../services/emailValidationService');
  const fail = code => async () => { throw Object.assign(new Error('DNS failure'), { code }); };
  const resolver = { resolveMx: async () => [{ exchange: 'mx.college.edu', priority: 10 }], resolve4: fail('ENODATA'), resolve6: fail('ENODATA') };
  assert.equal(await validateDeliverable('Staff@College.edu', resolver), 'staff@college.edu');
  resolver.resolveMx = async () => [{ exchange: '', priority: 0 }];
  await assert.rejects(validateDeliverable('staff@college.edu', resolver), error => error.status === 422 && /does not accept email/.test(error.message));
  resolver.resolveMx = fail('ENOTFOUND');
  await assert.rejects(validateDeliverable('staff@nonexistent.edu', resolver), { status: 422 });
  resolver.resolveMx = fail('ETIMEOUT');
  assert.equal(await validateDeliverable('staff@college.edu', resolver), 'staff@college.edu');
  resolver.resolveMx = fail('ENODATA');
  resolver.resolve4 = async () => ['192.0.2.1'];
  assert.equal(await validateDeliverable('staff@college.edu', resolver), 'staff@college.edu');
  resolver.resolve4 = fail('ENODATA');
  await assert.rejects(validateDeliverable('staff@college.edu', resolver), { status: 422 });
  resolver.resolve6 = fail('ESERVFAIL');
  assert.equal(await validateDeliverable('staff@college.edu', resolver), 'staff@college.edu');
  resolver.resolveMx = fail('ENOTFOUND');
  await assert.rejects(validateDeliverable('staff@unknown-provider.education', resolver), { status: 422 });
});
