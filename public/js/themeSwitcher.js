/**
 * Theme switcher – toggles between light and dark mode.
 * Persists choice in localStorage (primary) and cookie (for server-side middleware).
 * Adds theme class to <body> for CSS targeting.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'sraas-theme';
  const THEME_COOKIE = 'theme';
  const root = document.documentElement;
  const CLASS_LIGHT = 'theme-light';
  const CLASS_DARK = 'theme-dark';
  const systemTheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const valid = value => ['system', 'light', 'dark'].includes(value);
  const cookie = name => document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  let preference;

  /**
   * Apply the selected theme to the DOM.
   * @param {'light'|'dark'} theme
   */
  function setTheme() {
    const theme = preference === 'system' ? (systemTheme?.matches ? 'dark' : 'light') : preference;
    // Set data-theme on <html> (for CSS custom properties)
    root.setAttribute('data-theme', theme);

    // Set class on <body> for CSS targeting
    document.body.classList.remove(CLASS_LIGHT, CLASS_DARK);
    document.body.classList.add(theme === 'dark' ? CLASS_DARK : CLASS_LIGHT);

    // Persist in localStorage
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch (e) {
      // localStorage may be unavailable
    }

    // Persist in cookie (for server-side middleware)
    document.cookie = THEME_COOKIE + '=' + theme + ';path=/;max-age=' + (60 * 60 * 24 * 30);
    document.cookie = 'themePreference=' + preference + ';path=/;max-age=' + (60 * 60 * 24 * 30);
    root.classList.remove(CLASS_LIGHT, CLASS_DARK);
    root.classList.add(theme === 'dark' ? CLASS_DARK : CLASS_LIGHT);
    document.querySelectorAll('[name="theme_preference"]').forEach(input => { input.checked = input.value === preference; });

    // Update toggle button icon if present
    const toggleBtn = document.querySelector('.theme-toggle-btn');
    if (toggleBtn) {
      const icon = toggleBtn.querySelector('.material-icons');
      if (icon) {
        icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
      }
      toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  /**
   * Read the initial theme from localStorage, fallback to cookie, fallback to 'light'.
   * @returns {'light'|'dark'}
   */
  function getInitialTheme() {
    // 1. Check localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (valid(stored)) return stored;
    } catch (e) { /* ignore */ }

    // 2. Check cookie
    const selected = cookie('themePreference');
    if (valid(selected)) return selected;
    const legacy = cookie(THEME_COOKIE);
    if (['light', 'dark'].includes(legacy)) return legacy;

    // 3. Check system preference
    return 'system';
  }

  // Initialize theme
  preference = getInitialTheme();
  setTheme();
  window.getThemePreference = () => preference;
  window.setThemePreference = function (value) {
    if (!valid(value)) return;
    preference = value;
    setTheme();
  };
  document.querySelectorAll('[name="theme_preference"]').forEach(input => {
    input.addEventListener('change', () => { if (input.checked) window.setThemePreference(input.value); });
  });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) window.setThemePreference(valid(event.newValue) ? event.newValue : 'system');
  });

  // Expose a global toggle for UI controls
  window.toggleTheme = function () {
    const current = root.getAttribute('data-theme') || 'light';
    const newTheme = current === 'light' ? 'dark' : 'light';
    window.setThemePreference(newTheme);
  };

  // Listen for system preference changes
  if (systemTheme) {
    systemTheme.addEventListener('change', function () {
      if (preference === 'system') setTheme();
    });
  }

  // Auto-dismiss flash alerts after 5 seconds
  (function autoDismissAlerts() {
    const alerts = document.querySelectorAll('.alert-container .alert');
    const DISMISS_DELAY = 5000; // 5 seconds

    alerts.forEach(function (alert) {
      // Clear any existing timeout on this alert to avoid duplicates
      if (alert._autoDismissTimeout) {
        clearTimeout(alert._autoDismissTimeout);
      }

      // Set timeout to auto-close
      alert._autoDismissTimeout = setTimeout(function () {
        try {
          var bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
          bsAlert.close();
        } catch (e) {
          // Fallback: remove the alert element
          alert.remove();
        }
      }, DISMISS_DELAY);

      // Clear timeout if user manually closes the alert
      alert.addEventListener('closed.bs.alert', function () {
        if (alert._autoDismissTimeout) {
          clearTimeout(alert._autoDismissTimeout);
        }
      });
    });
  })();
})();
