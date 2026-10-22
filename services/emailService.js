'use strict';
const nodemailer = require('nodemailer');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

let transporter = null;

function deliveryError(error) {
  const authFailed = error.code === 'EAUTH' || error.responseCode === 535;
  const message = authFailed
    ? 'Verification email could not be sent because the email service is not authenticated. Please contact your administrator.'
    : 'Verification email is temporarily unavailable. Please try again later or contact your administrator.';
  return Object.assign(new Error(message), {
    status: 503, code: authFailed ? 'EMAIL_AUTH_FAILED' : 'EMAIL_DELIVERY_FAILED', publicMessage: message
  });
}

function getTransporter() {
  if (transporter) return transporter;
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const missing = required.filter(key => !process.env[key]?.trim());
  const port = Number(process.env.SMTP_PORT);
  if (missing.length || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[emailService] Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in config/.env.');
    throw deliveryError({});
  }
  const host = process.env.SMTP_HOST.trim();
  // Google displays app passwords in groups separated by spaces.
  const pass = /^smtp\.gmail\.com$/i.test(host) ? process.env.SMTP_PASS.replace(/\s/g, '') : process.env.SMTP_PASS;
  transporter = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000,
    auth: { user: process.env.SMTP_USER.trim(), pass }
  });
  return transporter;
}

async function sendOtpEmail(to, subject, text, html) {
  try {
    const info = await getTransporter().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
    if (!info.accepted || info.accepted.length === 0) throw new Error('SMTP server did not accept email');
    return info;
  } catch (error) {
    // Never log OTPs, credentials, recipient addresses or raw provider responses.
    console.error('[emailService] Delivery failed:', { code: error.code, responseCode: error.responseCode });
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.error('[emailService] SMTP authentication rejected. For Gmail, set SMTP_USER to the sending account and SMTP_PASS to a current App Password for that same account, then restart. See https://support.google.com/accounts/answer/185833');
    }
    throw error.publicMessage ? error : deliveryError(error);
  }
}

module.exports = { sendOtpEmail, getTransporter, deliveryError };
