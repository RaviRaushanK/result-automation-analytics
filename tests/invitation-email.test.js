const { test } = require('node:test');
const assert = require('node:assert/strict');
const invitation = require('../services/invitationEmailService');
const email = require('../services/emailService');
test('invitation email uses the configured application URL and includes its private link', async () => {
  const savedUrl = process.env.APP_BASE_URL, originalSend = email.sendOtpEmail;
  try {
    process.env.APP_BASE_URL = 'https://results.institution.example';
    const path = '/register?token=' + 'a'.repeat(64);
    const url = invitation.invitationUrl(path);
    assert.equal(url, 'https://results.institution.example' + path);
    let delivered = false;
    email.sendOtpEmail = async (to, subject, text) => { assert.equal(to, 'user@example.com'); assert.match(subject, /invited/); assert.ok(text.includes(url)); assert.match(text, /seven days/); delivered = true; };
    await invitation.send('user@example.com', url); assert.ok(delivered);
    process.env.APP_BASE_URL = 'https://user:secret@institution.example';
    assert.throws(() => invitation.invitationUrl(path));
    process.env.APP_BASE_URL = 'javascript:alert(1)';
    assert.throws(() => invitation.invitationUrl(path));
  } finally {
    email.sendOtpEmail = originalSend;
    if (savedUrl === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedUrl;
  }
});
