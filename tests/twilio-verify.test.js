const { test } = require('node:test');
const assert = require('node:assert/strict');
const verify = require('../services/twilioVerifyService');
test('Verify sends no custom body or sender and requires approved code checks', async () => {
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'];
  const saved = keys.map(k => process.env[k]), originalFetch = global.fetch;
  const sid = 'VE' + 'c'.repeat(32); let approved = false;
  try {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'test', TWILIO_VERIFY_SERVICE_SID: 'VA' + 'b'.repeat(32) });
    global.fetch = async (url, options) => {
      assert.equal(options.body.has('Body'), false); assert.equal(options.body.has('From'), false);
      if (url.endsWith('/Verifications')) {
        assert.equal(options.body.get('Channel'), 'sms');
        return { ok: true, json: async () => ({ sid, status: 'pending' }) };
      }
      assert.equal(options.body.get('VerificationSid'), sid); assert.equal(options.body.get('Code'), '123456');
      return { ok: true, json: async () => ({ sid, status: approved ? 'approved' : 'pending' }) };
    };
    assert.deepEqual(await verify.send('+919876543210'), { verificationSid: sid });
    assert.equal(await verify.check(sid, '123456'), false);
    approved = true; assert.equal(await verify.check(sid, '123456'), true);
    assert.equal(await verify.check(sid, 'invalid'), false);
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ code: 20404 }) });
    assert.equal(await verify.check(sid, '123456'), false);
  } finally {
    global.fetch = originalFetch;
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});
