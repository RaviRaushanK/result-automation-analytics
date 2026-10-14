(function () {
  'use strict';
  const pickers = [];
  document.querySelectorAll('[data-year-picker]').forEach(root => {
    const input = root.querySelector('input');
    const toggle = root.querySelector('[data-year-toggle]');
    const panel = root.querySelector('.batch-year-panel');
    const grid = root.querySelector('[data-year-grid]');
    const previous = root.querySelector('[data-year-prev]');
    const next = root.querySelector('[data-year-next]');
    const minimum = Number(input.min), maximum = Number(input.max);
    const clamp = value => Math.min(maximum, Math.max(minimum, value));
    let start, focusedYear;
    function close(focusTarget) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focusTarget) focusTarget.focus();
    }
    function render(focus) {
      root.querySelector('[data-year-range]').textContent = start + '-' + Math.min(start + 9, maximum);
      previous.disabled = start <= minimum;
      next.disabled = start + 10 > maximum;
      grid.replaceChildren();
      for (let year = start; year < start + 10; year++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'batch-year-choice';
        button.textContent = String(year);
        button.dataset.pickYear = String(year);
        button.disabled = year < minimum || year > maximum;
        button.tabIndex = year === focusedYear ? 0 : -1;
        button.setAttribute('aria-pressed', String(input.value !== '' && Number(input.value) === year));
        grid.appendChild(button);
      }
      if (focus) grid.querySelector('[data-pick-year="' + focusedYear + '"]')?.focus();
    }
    function open() {
      pickers.forEach(picker => picker());
      const value = Number(input.value);
      focusedYear = clamp(input.value && Number.isInteger(value) ? value : new Date().getFullYear());
      start = Math.floor(focusedYear / 10) * 10;
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      render(true);
    }
    pickers.push(() => close());
    toggle.addEventListener('click', () => panel.hidden ? open() : close(input));
    previous.addEventListener('click', () => { start -= 10; focusedYear = start; render(false); });
    next.addEventListener('click', () => { start += 10; focusedYear = start; render(false); });
    grid.addEventListener('click', event => {
      const choice = event.target.closest('[data-pick-year]');
      if (!choice || choice.disabled) return;
      input.value = choice.dataset.pickYear;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close(input);
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && event.altKey && event.target === input) { event.preventDefault(); open(); return; }
      if (panel.hidden) return;
      if (event.key === 'Tab') {
        setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 0);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(toggle); return; }
      const choice = event.target.closest('[data-pick-year]');
      if (!choice) return;
      const year = Number(choice.dataset.pickYear);
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5, PageUp: -10, PageDown: 10 };
      let target;
      if (event.key in offsets) target = year + offsets[event.key];
      else if (event.key === 'Home') target = start;
      else if (event.key === 'End') target = Math.min(start + 9, maximum);
      else return;
      event.preventDefault();
      focusedYear = clamp(target);
      start = Math.floor(focusedYear / 10) * 10;
      render(true);
    });
    input.addEventListener('input', () => { if (!panel.hidden) render(false); });
    document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
    input.form.addEventListener('reset', () => close());
    root.closest('.modal')?.addEventListener('hidden.bs.modal', () => close());
  });
})();
