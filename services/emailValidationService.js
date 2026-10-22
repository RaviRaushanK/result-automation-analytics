'use strict';
const { Resolver } = require('node:dns').promises;
const { validate } = require('../public/js/accountEmailValidation');
const absent = error => ['ENOTFOUND', 'ENODATA'].includes(error.code);
const invalid = message => Object.assign(new Error(message), { status: 422 });
async function validateDeliverable(raw, resolver = new Resolver({ timeout: 2500, tries: 1 })) {
  const result = validate(raw);
  if (!result.valid) throw invalid(result.message);
  const domain = result.value.split('@')[1];
  let records;
  try { records = await resolver.resolveMx(domain); }
  catch (error) {
    if (error.code === 'ENOTFOUND') throw invalid('This email domain does not exist. Please check the address.');
    if (!absent(error)) {
      // DNS outages are inconclusive. SMTP delivery and OTP verification remain required.
      console.warn('[emailValidation] DNS lookup unavailable; email OTP verification is required.', { code: error.code });
      return result.value;
    }
    records = [];
  }
  if (records.length) {
    if (records.some(record => !record.exchange || record.exchange === '.')) throw invalid('This email domain does not accept email. Use an address that can receive a verification code.');
    return result.value;
  }
  // SMTP can deliver directly to a domain's address when it has no MX record.
  const addresses = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
  if (addresses.some(item => item.status === 'fulfilled' && item.value.length)) return result.value;
  if (addresses.some(item => item.status === 'rejected' && !absent(item.reason))) {
    console.warn('[emailValidation] DNS address lookup unavailable; email OTP verification is required.');
    return result.value;
  }
  throw invalid('This email domain cannot receive email. Please check the address.');
}
module.exports = { validateDeliverable };
