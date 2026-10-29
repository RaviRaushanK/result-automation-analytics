'use strict';
const emailService = require('./emailService');
function invitationUrl(path) {
  const base = new URL(process.env.APP_BASE_URL || `http://localhost:${process.env.APP_PORT || 3000}`);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Object.assign(new Error('Configure APP_BASE_URL as the application origin, for example https://results.your-institution.edu.'), { status: 503 });
  if (!/^\/register\?token=[a-f0-9]{64}$/.test(path)) throw new Error('Invalid invitation path.');
  return new URL(path, base).href;
}
async function send(to, url) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  const text = `Your institution has invited you to join SRAAS as faculty, with access to Dashboard, Analysis, Reports, and personal settings.\n\nCreate your account using this private invitation link:\n${url}\n\nThe invitation expires in seven days. You will need your existing faculty code and must verify your email address.\n${local ? '\nThis is a local test link. It only works on the computer running SRAAS. Ask the administrator for a reachable application URL if you are using another device.\n' : ''}\nIf you were not expecting this invitation, you can ignore it.`;
  return emailService.sendOtpEmail(to, 'You are invited to join SRAAS', text, undefined);
}
module.exports = { invitationUrl, send };
