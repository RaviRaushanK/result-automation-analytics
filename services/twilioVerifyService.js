'use strict';
function enabled() { return process.env.SMS_PROVIDER === 'twilio-verify'; }
async function request(resource, values) {
  const e = process.env;
  if (!/^VA[0-9a-f]{32}$/i.test(e.TWILIO_VERIFY_SERVICE_SID || '') || !/^AC[0-9a-f]{32}$/i.test(e.TWILIO_ACCOUNT_SID || '') || !e.TWILIO_AUTH_TOKEN) {
    throw Object.assign(new Error('Mobile verification is not configured.'), { status: 503 });
  }
  try {
    const response = await fetch(`https://verify.twilio.com/v2/Services/${e.TWILIO_VERIFY_SERVICE_SID}/${resource}`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64') },
      body: new URLSearchParams(values), signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('[twilioVerify] Request rejected:', { code: result.code, httpStatus: response.status });
      if (resource === 'VerificationCheck' && response.status === 404) return { status: 'expired' };
      throw new Error('Provider rejected verification');
    }
    return result;
  } catch {
    throw Object.assign(new Error('Mobile verification is temporarily unavailable. Please check Twilio Verify trial access and verified recipients.'), { status: 503 });
  }
}
async function send(to) {
  const result = await request('Verifications', { To: to, Channel: 'sms' });
  if (!/^VE[0-9a-f]{32}$/i.test(result.sid || '') || result.status !== 'pending') throw Object.assign(new Error('A mobile verification could not be started.'), { status: 503 });
  return { verificationSid: result.sid };
}
async function check(sid, code) {
  if (!/^VE[0-9a-f]{32}$/i.test(sid || '') || !/^\d{6}$/.test(code)) return false;
  const result = await request('VerificationCheck', { VerificationSid: sid, Code: code });
  return result.status === 'approved' && result.sid === sid;
}
module.exports = { enabled, send, check };
