(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StudentEmailValidation = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function getError(email) {
    if (typeof email !== 'string' || !email) return 'Email is required.';
    if (email.length > 100) return 'Email must contain no more than 100 characters.';
    if (/\s/.test(email)) return 'Email must not contain spaces.';
    var parts = email.split('@');
    if (parts.length !== 2) return 'Email must contain exactly one @ symbol, for example student@gmail.com.';
    var local = parts[0];
    var domain = parts[1];
    if (!local) return 'Email must include a username before @.';
    if (local.length > 64) return 'Email username must contain no more than 64 characters.';
    if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return 'Email username contains an invalid character.';
    if (local.startsWith('.') || local.endsWith('.')) return 'Email username must not start or end with a dot.';
    if (local.includes('..')) return 'Email username must not contain consecutive dots.';
    if (!domain) return 'Email must include a domain after @, for example gmail.com.';
    if (domain.toLowerCase() !== 'gmail.com') {
      return 'Only @gmail.com email addresses are allowed. Example: example@gmail.com.';
    }
    var username = local.split('+')[0];
    if (!/^[A-Za-z0-9.]+$/.test(username)) {
      return 'Email has an invalid Gmail username. Use only letters, numbers and dots before an optional +tag.';
    }
    if (username.startsWith('.') || username.endsWith('.')) return 'Email has an invalid Gmail username: it must not start or end with a dot.';
    return '';
  }
  function isValid(email) {
    return !getError(email);
  }
  return { isValid: isValid, getError: getError };
}));
