'use strict';
const nodemailer = require('nodemailer');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

let transporter = null;

function validateConfig() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[emailService] SMTP configuration is incomplete. Missing:', missing.join(', '));
    return false;
  }
  return true;
}

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Safe diagnostic logging (never the password).
  console.log('[emailService] SMTP_HOST:', host);
  console.log('[emailService] SMTP_PORT:', port);
  console.log('[emailService] SMTP_USER configured:', !!user);
  console.log('[emailService] SMTP_PASS configured:', !!pass);
  console.log('[emailService] SMTP_FROM:', process.env.SMTP_FROM);

  if (!validateConfig()) {
    console.warn('[emailService] SMTP not configured — OTPs will be logged to console instead of being sent.');
    return {
      sendMail: async (mailOptions) => {
        console.log('========================================');
        console.log('DEV EMAIL (SMTP not configured):');
        console.log('To:', mailOptions.to);
        console.log('Subject:', mailOptions.subject);
        console.log('Body:', mailOptions.text);
        console.log('========================================');
        return { messageId: 'dev-' + Math.random().toString(36).slice(2) };
      }
    };
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    requireTLS: true,
    auth: { user, pass }
  });

  // Safe backend SMTP verification.
  transporter.verify((error, success) => {
    if (error) {
      console.error('SMTP verification failed:', {
        message: error.message,
        code: error.code,
        command: error.command,
        response: error.response,
        responseCode: error.responseCode
      });
    } else {
      console.log('SMTP server is ready');
    }
  });

  return transporter;
}

async function sendOtpEmail(to, subject, text, html) {
  if (!validateConfig()) {
    throw new Error('SMTP configuration is incomplete.');
  }
  const t = getTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html
  };
  try {
    const info = await t.sendMail(mailOptions);
    console.log('OTP email sent:', {
      to: to.replace(/(.{2}).*(@.*)/, '$1***$2'),
      accepted: info.accepted,
      rejected: info.rejected,
      envelopeTo: info.envelope && info.envelope.to,
      messageId: info.messageId,
      response: info.response
    });
    return info;
  } catch (error) {
    console.error('OTP email sending failed:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode
    });
    throw error;
  }
}

module.exports = { sendOtpEmail, getTransporter };
