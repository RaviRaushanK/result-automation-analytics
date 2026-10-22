'use strict';
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../config/.env') });
function assertConfigured() {
  if (process.env.SMS_PROVIDER !== 'twilio' || !/^AC[0-9a-f]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID || '') ||
      !process.env.TWILIO_AUTH_TOKEN || !(process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)) {
    throw Object.assign(new Error('Mobile verification is unavailable. Ask your administrator to configure SMS delivery.'), { status: 503 });
  }
}
async function sendOtpSms(to, message) {
  if (require('./twilioVerifyService').enabled()) {
    if (!/^\+[1-9]\d{7,14}$/.test(to)) throw Object.assign(new Error('Enter a mobile number with its country code.'), { status: 400 });
    return require('./twilioVerifyService').send(to);
  }
  assertConfigured();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw Object.assign(new Error('Use a mobile number with its country code, for example +919876543210.'), { status: 400 });
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = new URLSearchParams({ To: to, Body: message });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) body.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else body.set('From', process.env.TWILIO_FROM);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') },
      body, signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || !result.sid || ['failed', 'undelivered'].includes(result.status)) {
      const code = Number(result.error_code || result.code) || null;
      // Log only diagnostic codes, never credentials, phone numbers or OTPs.
      console.error('[smsService] Twilio rejected SMS:', { httpStatus: response.status, code });
      if (code) console.error('[smsService] Error details: https://www.twilio.com/docs/api/errors/' + code);
      const messages = {
        572002: 'The Twilio trial sender does not match this recipient. Ask your administrator to set TWILIO_FROM to the Messaging trial number assigned to this verified recipient in Twilio Console.',
        21606: 'SMS delivery is unavailable because the sender is not a valid SMS-capable Twilio number for this account. Ask your administrator to correct TWILIO_FROM.',
        21608: 'This Twilio trial account cannot send to the recipient yet. Ask your administrator to verify the recipient in Twilio.',
        21408: 'SMS delivery is disabled for this destination country in Twilio. Ask your administrator to check Messaging Geo Permissions.',
        20003: 'SMS delivery could not authenticate with Twilio. Ask your administrator to check the account credentials.'
      };
      throw Object.assign(new Error(messages[code] || 'The verification SMS could not be sent. Please try again later.'), { status: 503, providerCode: code });
    }
    return { messageId: result.sid };
  } catch (error) {
    if (error.status === 503) throw error;
    console.error('[smsService] SMS connection failed:', { code: error.cause?.code || error.code || error.name });
    throw Object.assign(new Error('The verification SMS could not be sent. Please try again later.'), { status: 503 });
  }
}
module.exports = { sendOtpSms, assertConfigured };
