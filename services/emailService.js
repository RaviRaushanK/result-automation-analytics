'use strict';
const nodemailer = require('nodemailer');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // If no SMTP credentials are configured, fall back to a dev logger.
  // In production this should be misconfigured intentionally to avoid
  // accidental email sending without explicit setup.
  if (!host || !user || !pass) {
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
    secure: port === 465,
    auth: { user, pass }
  });
  return transporter;
}

async function sendOtpEmail(to, subject, text, html) {
  return await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'SRAAS <noreply@localhost>',
    to,
    subject,
    text,
    html
  });
}

module.exports = { sendOtpEmail, getTransporter };
