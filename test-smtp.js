'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, 'config/.env') });

const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT) || 587;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM;

console.log('SMTP_HOST:', host);
console.log('SMTP_PORT:', port);
console.log('SMTP_USER configured:', !!user);
console.log('SMTP_PASS configured:', !!pass);
console.log('SMTP_FROM:', from);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false,
  requireTLS: true,
  auth: { user, pass }
});

transporter.verify((err, success) => {
  if (err) {
    console.error('SMTP verification failed:', {
      message: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode
    });
    process.exit(1);
  }
  console.log('SMTP server is ready');
  process.exit(0);
});