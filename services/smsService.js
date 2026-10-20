'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

// No SMS provider is configured in this application. The implementation below
// logs the OTP to the console in development so the feature can be tested and
// verified without third-party credentials. To connect a real SMS provider
// (Twilio, AWS SNS, MSG91, etc.), replace the sendOtpSms implementation.

async function sendOtpSms(to, message) {
  console.log('========================================');
  console.log('DEV SMS (no provider configured):');
  console.log('To:', to);
  console.log('Message:', message);
  console.log('========================================');
  return { messageId: 'dev-sms-' + Math.random().toString(36).slice(2) };
}

module.exports = { sendOtpSms };
