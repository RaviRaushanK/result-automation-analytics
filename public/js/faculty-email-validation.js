(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./email-tlds'));
  else root.FacultyEmailValidation = factory(root.EmailTlds);
})(typeof window !== 'undefined' ? window : globalThis, function (domains) {
  'use strict';
  const tlds = new Set(domains || []);
  function getError(value) {
    if (typeof value !== 'string') return 'Enter a valid email address.';
    const email = value.trim();
    if (!email) return '';
    if (email.length > 100) return 'Email must contain no more than 100 characters.';
    const parts = email.split('@');
    if (parts.length !== 2) return 'Enter a valid email address, such as name@college.edu.';
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return 'Enter a valid email username before @.';
    const labels = domain.split('.');
    if (labels.length < 2 || !labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) || !/^[A-Za-z]{2,63}$/.test(labels.at(-1))) return 'Enter a valid email domain, such as college.edu.';
    if (!tlds.has(labels.at(-1).toLowerCase())) return 'This email domain ending is not valid. Check the address, such as name@gmail.com or name@college.edu.';
    return '';
  }
  return { getError };
});
