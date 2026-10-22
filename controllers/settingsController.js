'use strict';
const service = require('../services/settingsService');
const repository = require('../repositories/settingsRepository');
const menu = require('../middlewares/menuMiddleware');
const otpService = require('../services/otpService');
const { AdminOtp } = require('../database/models');
const SECTIONS = [ ['account', 'My Account', 'person'], ['security', 'Account Security', 'security'], ['appearance', 'Appearance', 'palette'], ['institution', 'Institution & Reports', 'business'], ['academic-policy', 'Academic Policy', 'school'], ['system', 'System Information', 'info'] ];
async function currentAccount(req, res, next) {
  try {
    const account = await repository.account(req.session.adminId);
    if (!account) return res.status(403).send('Your account is inactive or unavailable.');
    req.account = account;
    req.user = { adminId: account.admin_id, username: account.username, role: account.role };
    res.locals.user = req.user;
    return menu(req, res, next);
  } catch (err) { next(err); }
}
function administrator(req, res, next) {
  if (req.account.role !== 'admin') return res.status(403).send('Administrator access is required.');
  next();
}
async function render(req, res, section, errors = {}, entered = {}, status = 200, message = '') {
  if (section === 'account') entered = { new_email: req.session.settingsPendingEmail || '', new_mobile: req.session.settingsPendingMobile || '', ...entered };
  const admin = req.account.role === 'admin';
  const allowed = SECTIONS.filter(([key]) => !['institution', 'system'].includes(key) || admin).filter(([key]) => key !== 'academic-policy' || ['admin', 'faculty'].includes(req.account.role));
  if (!allowed.some(([key]) => key === section)) return res.status(403).send('This settings section is not available for your account.');
  const notice = req.session.settingsNotice; delete req.session.settingsNotice;
  const branding = section === 'institution' ? await service.getBranding() : service.DEFAULTS;
  res.status(status).render('settings/index', { title: 'Settings - SRAAS', pageStyles: ['/css/settings.css', '/css/reports.css'], section, sections: allowed, account: req.account, errors, entered,
    branding, fields: service.FIELDS, audits: section === 'institution' ? await repository.audit() : [],
    academic: section === 'academic-policy' ? await service.academicPolicy() : null,
    system: section === 'system' ? await service.systemInformation() : null,
    notice: message || notice, noticeType: status >= 400 ? 'danger' : 'success', breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/settings', label: 'Settings' }, { label: allowed.find(([key]) => key === section)[1] }] });
}
async function page(req, res, next) {
  const section = req.query.section || 'account';
  if (typeof section !== 'string' || !SECTIONS.some(([key]) => key === section)) return res.status(400).send('Unknown settings section.');
  try { await render(req, res, section); } catch (err) { next(err); }
}
function save(section, operation, notice) {
  return async (req, res, next) => {
    try {
      await operation(req);
      req.session.settingsNotice = notice;
      req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=' + section));
    } catch (err) {
      if (!err.status) return next(err);
      const entered = {};
      for (const key of section === 'account' ? ['email', 'new_email', 'new_mobile'] : service.FIELDS.map(field => field.key)) {
        if (typeof req.body?.[key] === 'string') entered[key] = req.body[key].slice(0, 1000);
      }
      try { await render(req, res, section, err.errors || {}, entered, err.status, err.message); } catch (error) { next(error); }
    }
  };
}
async function changeEmailRequest(req, res, next) {
  try {
    const result = await service.requestChangeEmail(req.body, req.account.admin_id);
    req.session.settingsPendingEmail = req.body.new_email.trim().toLowerCase();
    req.session.settingsNotice = result.notice;
    req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=account'));
  } catch (err) {
    if (!err.status) return next(err);
    const entered = {};
    if (typeof req.body.new_email === 'string') entered.new_email = req.body.new_email.slice(0, 1000);
    try { await render(req, res, 'account', err.errors || {}, entered, err.status, err.message); } catch (error) { next(error); }
  }
}
async function changeEmailVerify(req, res, next) {
  try {
    const result = await service.verifyChangeEmail(req.body, req.account.admin_id);
    delete req.session.settingsPendingEmail;
    req.session.settingsNotice = result.notice;
    req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=account'));
  } catch (err) {
    if (!err.status) return next(err);
    try { await render(req, res, 'account', err.errors || {}, {}, err.status, err.message); } catch (error) { next(error); }
  }
}
async function changeMobileRequest(req, res, next) {
  try {
    const result = await service.requestChangeMobile(req.body, req.account.admin_id);
    req.session.settingsPendingMobile = req.body.new_mobile.trim();
    req.session.settingsNotice = result.notice;
    req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=account'));
  } catch (err) {
    if (!err.status) return next(err);
    const entered = {};
    if (typeof req.body.new_mobile === 'string') entered.new_mobile = req.body.new_mobile.slice(0, 1000);
    if (typeof req.body.countryCode === 'string') entered.countryCode = req.body.countryCode.slice(0, 100);
    try { await render(req, res, 'account', err.errors || {}, entered, err.status, err.message); } catch (error) { next(error); }
  }
}
async function changeMobileVerify(req, res, next) {
  try {
    const result = await service.verifyChangeMobile(req.body, req.account.admin_id);
    delete req.session.settingsPendingMobile;
    req.session.settingsNotice = result.notice;
    req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=account'));
  } catch (err) {
    if (!err.status) return next(err);
    try { await render(req, res, 'account', err.errors || {}, {}, err.status, err.message); } catch (error) { next(error); }
  }
}
async function contactVerification(req, res, next) {
  const kind = req.body.kind;
  if (!['email', 'mobile'].includes(kind) || !['cancel', 'resend'].includes(req.body.action)) return res.status(400).send('Unsupported verification action.');
  try {
    const type = kind === 'email' ? 'email_change' : 'mobile_change';
    if (req.body.action === 'cancel') {
      await AdminOtp.update({ is_used: 1 }, { where: { admin_id: req.account.admin_id, type, is_used: 0 } });
      delete req.session[kind === 'email' ? 'settingsPendingEmail' : 'settingsPendingMobile'];
      req.session.settingsNotice = 'Contact change cancelled.';
    } else {
      await otpService.resendOtp({ adminId: req.account.admin_id, type });
      req.session.settingsNotice = 'A new code has been sent to your new contact.';
    }
    req.session.save(err => err ? next(err) : res.redirect(303, '/settings?section=account'));
  } catch (err) {
    if (!err.status) return next(err);
    try { await render(req, res, 'account', {}, {}, err.status, err.message); } catch (error) { next(error); }
  }
}
module.exports = { currentAccount, administrator, page,
  account: save('account', req => service.updateEmail(req.body, req.account.admin_id), 'Your email address has been updated.'),
  changeEmailRequest,
  changeEmailVerify,
  changeMobileRequest,
  changeMobileVerify,
    contactVerification,
  institution: save('institution', req => service.saveInstitution(req.body, req.account.admin_id), 'Institution branding has been saved.'),
  logo: save('institution', req => service.saveLogo(req.body, req.file, req.account.admin_id), 'Institution logo has been updated.') };
