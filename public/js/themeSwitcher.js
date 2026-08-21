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

  /**
   * Apply the selected theme to the DOM.
   * @param {'light'|'dark'} theme
   */
  function setTheme(theme) {
    // Set data-theme on <html> (for CSS custom properties)
    root.setAttribute('data-theme', theme);

    // Set class on <body> for CSS targeting
    document.body.classList.remove(CLASS_LIGHT, CLASS_DARK);
    document.body.classList.add(theme === 'dark' ? CLASS_DARK : CLASS_LIGHT);

    // Persist in localStorage
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      // localStorage may be unavailable
    }

    // Persist in cookie (for server-side middleware)
    document.cookie = THEME_COOKIE + '=' + theme + ';path=/;max-age=' + (60 * 60 * 24 * 30);

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
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) { /* ignore */ }

    // 2. Check cookie
    const match = document.cookie.match(new RegExp('(^| )' + THEME_COOKIE + '=([^;]+)'));
    if (match) {
      const val = match[2];
      if (val === 'light' || val === 'dark') return val;
    }

    // 3. Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  // Initialize theme
  const initialTheme = getInitialTheme();
  setTheme(initialTheme);

  // Expose a global toggle for UI controls
  window.toggleTheme = function () {
    const current = root.getAttribute('data-theme') || 'light';
    const newTheme = current === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  };

  // Listen for system preference changes
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', function (e) {
      // Only auto-switch if user hasn't explicitly set a preference
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          setTheme(e.matches ? 'dark' : 'light');
        }
      } catch (err) { /* ignore */ }
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
