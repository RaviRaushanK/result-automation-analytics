'use strict';

const message = 'Your account access is disabled. Contact your institution administrator to review or restore your access.';

module.exports = function accountAccessResponse(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  if (req.accepts('html')) {
    return res.status(403).render('errors/account-disabled', {
      layout: 'layouts/landing',
      title: 'Account access disabled - SRAAS',
      pageStyles: ['/css/account-access.css?v=20261030-1'],
      user: null,
      signInHref: req.session?.adminId ? '/logout?next=login' : '/login',
    });
  }
  return res.status(403).json({ error: message, message, code: 'ACCOUNT_ACCESS_DISABLED' });
};
