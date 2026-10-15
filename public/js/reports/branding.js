(function () {
  'use strict';
  function fallback(image) {
    image.hidden = true;
    const replacement = image.parentElement.querySelector('.report-brand-fallback');
    if (replacement) replacement.hidden = false;
  }
  function watch(image) {
    image.addEventListener('error', () => fallback(image));
    if (image.getAttribute('src') && image.complete && !image.naturalWidth) fallback(image);
  }
  document.querySelectorAll('.report-logo-image').forEach(watch);
  window.renderReportBranding = function (branding) {
    const header = document.getElementById('reports-branding');
    if (!header) return;
    header.querySelectorAll('[data-branding-field]').forEach(element => {
      const value = branding[element.dataset.brandingField] || '';
      element.textContent = value;
      element.hidden = !value;
    });
    const logo = header.querySelector('.report-brand-logo');
    logo.replaceChildren();
    const placeholder = document.createElement('span'); placeholder.className = 'report-brand-fallback'; placeholder.textContent = 'MCA'; logo.append(placeholder);
    if (/^\/uploads\/branding\/[a-f0-9-]{36}\.png$/.test(branding.institution_logo || '')) {
      const image = document.createElement('img'); image.className = 'report-logo-image'; image.alt = branding.institution_name + ' logo';
      logo.prepend(image); placeholder.hidden = true; watch(image); image.hidden = false; image.src = branding.institution_logo;
    }
    const footer = document.getElementById('reports-brand-footer');
    if (footer) footer.textContent = branding.report_footer || '';
  };
})();
