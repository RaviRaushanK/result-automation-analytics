(function () {
  'use strict';
  const notification = document.querySelector('[data-settings-notification]');
  if (notification) {
    const timer = setTimeout(() => notification.remove(), 5000);
    notification.querySelector('button').addEventListener('click', () => {
      clearTimeout(timer);
      notification.remove();
    });
  }
  const form = document.getElementById('institution-form');
  if (!form) return;
  function update() {
    for (const input of form.elements) {
      const target = document.querySelector('#settings-branding [data-branding-field="' + input.name + '"]');
      if (target) { target.textContent = input.value.trim(); target.hidden = !input.value.trim(); }
    }
    document.getElementById('settings-preview-footer').textContent = form.elements.report_footer.value.trim();
  }
  form.addEventListener('input', update);
})();
