/**
 * Simple theme switcher – toggles between light and dark mode.
 * Persists choice in a cookie (expires in 30 days).
 */
(function () {
  const THEME_COOKIE = 'theme';
  const root = document.documentElement;

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    document.cookie = `${THEME_COOKIE}=${theme};path=/;max-age=${60 * 60 * 24 * 30}`;
  }

  // Initialize from cookie
  const match = document.cookie.match(new RegExp('(^| )' + THEME_COOKIE + '=([^;]+)'));
  const current = match ? match[2] : 'light';
  setTheme(current);

  // Expose a global toggle for UI controls
  window.toggleTheme = function () {
    const newTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  };
})();