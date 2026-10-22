(function (root) {
  'use strict';
  function validate(raw) {
    const message = 'Enter a valid email address, for example name@college.ac.in (maximum 100 characters).';
    const invalid = { valid: false, message };
    if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw)) return invalid;
    const value = raw.trim().toLowerCase();
    if (value.length > 100 || /\s/.test(value)) return invalid;
    const parts = value.split('@');
    if (parts.length !== 2) return invalid;
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return invalid;
    const labels = domain.split('.');
    if (labels.length < 2 || !/^[a-z]{2,63}$/.test(labels[labels.length - 1]) || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return invalid;
    return { valid: true, value, message: '' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validate };
  if (!root.document) return;
  root.document.querySelectorAll('[data-account-email]').forEach(input => {
    const feedbackId = input.getAttribute('data-email-feedback');
    const feedback = feedbackId ? root.document.getElementById(feedbackId) : null;
    const check = () => {
      const result = validate(input.value);
      input.setCustomValidity(result.valid ? '' : result.message);
      input.setAttribute('aria-invalid', String(!result.valid));
      if (feedback) {
        feedback.textContent = result.valid ? '' : result.message;
        feedback.hidden = result.valid;
        input.classList.toggle('is-invalid', !result.valid);
      }
      return result;
    };
    input.addEventListener('input', check);
    // Native validation can prevent submit from firing (e.g. a missing @).
    input.addEventListener('invalid', check);
    input.addEventListener('blur', () => { const result = check(); if (result.valid) input.value = result.value; });
    input.form.addEventListener('submit', event => {
      const result = check();
      if (!result.valid) { event.preventDefault(); input.reportValidity(); }
      else input.value = result.value;
    });
  });
})(typeof window === 'undefined' ? globalThis : window);
