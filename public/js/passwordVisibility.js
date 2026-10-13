(function () {
  'use strict';
  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const label = document.querySelector('label[for="' + input.id + '"]').textContent.toLowerCase();
    function sync() {
      button.hidden = input.value.length === 0;
      if (button.hidden) input.type = 'password';
      const visible = input.type === 'text';
      const description = (visible ? 'Hide ' : 'Show ') + label;
      button.setAttribute('aria-label', description);
      button.title = description;
      button.setAttribute('aria-pressed', String(visible));
      button.querySelector('.material-icons').textContent = visible ? 'visibility_off' : 'visibility';
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('focus', sync);
    button.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      sync();
    });
    input.form.addEventListener('reset', () => setTimeout(sync, 0));
    window.addEventListener('pageshow', sync);
    sync();
  });
})();
