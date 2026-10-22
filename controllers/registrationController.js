'use strict';
const crypto = require('node:crypto');
const service = require('../services/registrationService');
const invitationEmail = require('../services/invitationEmailService');
const { maskEmail, maskMobile } = require('../services/otpService');
function render(res, stage, values = {}, status = 200) {
  return res.status(status).render('auth/register', { layout: 'layouts/landing', title: 'Registration - SRAAS',
    pageStyles: ['/css/registration.css'], stage, error: null, notice: null, ...values });
}
function publicError(error) {
  if (error.name === 'SequelizeUniqueConstraintError') return 'The username or email is already registered. Ask your administrator for a new invitation.';
  return error.status ? error.message : 'Registration is unavailable. Please try again later.';
}
async function verificationPage(req, res, error = null, notice = null, status = 200) {
  try {
    const state = await service.state(req.session.registrationToken, req.session.registrationSecret);
    return render(res, 'verify', { ...state, email: maskEmail(state.email), mobile: maskMobile(state.mobile), error, notice }, status);
  } catch (err) { return render(res, 'unavailable', { error: publicError(err) }, err.status || 500); }
}
module.exports = {
  page: async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    try {
      if (req.query.token !== undefined) {
        await service.inspect(req.query.token);
        if (req.session.registrationToken !== req.query.token) {
          req.session.registrationToken = req.query.token;
          req.session.registrationSecret = crypto.randomBytes(32).toString('hex');
          req.session.registrationStarted = false;
        }
        return req.session.save(err => err ? render(res, 'unavailable', { error: 'Unable to save your session.' }, 500) : res.redirect(303, '/register'));
      }
      if (req.session.registrationStarted) return verificationPage(req, res);
      const invitation = await service.inspect(req.session.registrationToken);
      return render(res, 'details', { email: invitation.email });
    } catch (error) { return render(res, 'unavailable', { error: publicError(error) }, error.status || 500); }
  },
  start: async (req, res) => {
    try {
      await service.start(req.session.registrationToken, req.session.registrationSecret, req.body);
      req.session.registrationStarted = true;
      return req.session.save(err => err ? render(res, 'unavailable', { error: 'Unable to save your session.' }, 500) : res.redirect(303, '/register'));
    } catch (error) {
      try { const invitation = await service.inspect(req.session.registrationToken); return render(res, 'details', { email: invitation.email, error: publicError(error) }, error.status || 500); }
      catch { return render(res, 'unavailable', { error: publicError(error) }, error.status || 500); }
    }
  },
  send: async (req, res) => {
    try {
      await service.send(req.session.registrationToken, req.session.registrationSecret, req.body.channel);
      return verificationPage(req, res, null, 'Verification code sent. It expires in 5 minutes.');
    } catch (error) { return verificationPage(req, res, publicError(error), null, error.status || 500); }
  },
  verify: async (req, res) => {
    try {
      const result = await service.verify(req.session.registrationToken, req.session.registrationSecret, req.body.channel, req.body.otp);
      if (!result.complete) return verificationPage(req, res, null, 'Contact verified. Complete the remaining verification to activate your account.');
      delete req.session.registrationToken; delete req.session.registrationSecret; delete req.session.registrationStarted;
      return render(res, 'complete');
    } catch (error) { return verificationPage(req, res, publicError(error), null, error.status || 500); }
  },
  invitations: (req, res) => res.render('auth/invitations', { title: 'Invite a User - SRAAS', error: null, invitePath: null }),
  invite: async (req, res) => {
    let invitePath = null;
    try {
      // Validate the configured origin before creating an invitation.
      invitationEmail.invitationUrl('/register?token=' + '0'.repeat(64));
      invitePath = invitationEmail.invitationUrl(await service.invite(req.session.adminId, req.body.email));
      const recipient = req.body.email.trim().toLowerCase();
      console.log('[invitations] Sending invitation email.');
      const receipt = await invitationEmail.send(recipient, invitePath);
      console.log('[invitations] Email accepted by SMTP server:', { messageId: receipt?.messageId, acceptedCount: receipt?.accepted?.length });
      return res.render('auth/invitations', { title: 'Invite a User - SRAAS', error: null, invitePath, emailSent: true, emailRecipient: recipient });
    } catch (error) {
      console.error('[invitations] Invitation request failed:', { code: error.code, status: error.status, invitationCreated: Boolean(invitePath) });
      return res.status(error.status || 500).render('auth/invitations', { title: 'Invite a User - SRAAS', error: invitePath ? 'Invitation created, but the email could not be sent. Check the email service configuration. You can copy the link below and share it privately.' : publicError(error), invitePath, emailSent: false });
    }
  }
};
