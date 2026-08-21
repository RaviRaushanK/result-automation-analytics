/**
 * SRAS Sidebar Controller
 * Handles responsive sidebar behavior:
 * - Desktop: collapsible icon-only mode (240px ↔ 72px)
 * - Tablet: starts collapsed, expandable
 * - Mobile: overlay drawer with hamburger toggle
 * - localStorage persistence
 * - Keyboard navigation & accessibility
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'sras-sidebar-collapsed';
  const MOBILE_BREAKPOINT = 768;
  const DESKTOP_BREAKPOINT = 1024;

  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');

  if (!sidebar) return;

  /* ---------- Helpers ---------- */

  function getViewportWidth() {
    return window.innerWidth;
  }

  function isMobile() {
    return getViewportWidth() < MOBILE_BREAKPOINT;
  }

  function isDesktop() {
    return getViewportWidth() >= DESKTOP_BREAKPOINT;
  }

  function getStoredState() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val === null) return null;
      return val === 'true';
    } catch (e) {
      return null;
    }
  }

  function setStoredState(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch (e) {
      // localStorage unavailable
    }
  }

  /* ---------- Tooltip Attributes ---------- */

  function addTooltipAttributes() {
    const links = sidebar.querySelectorAll('.sidebar-link');
    links.forEach(function(link) {
      if (link.hasAttribute('data-tooltip')) return;

      const textSpan = link.querySelector('span:not(.material-icons)');
      if (textSpan) {
        link.setAttribute('data-tooltip', textSpan.textContent.trim());
        return;
      }

      // Fallback for links where the label text is a direct text node
      // (e.g. the sticky Settings link)
      const icon = link.querySelector('.material-icons');
      if (icon && icon.nextSibling && icon.nextSibling.nodeType === Node.TEXT_NODE) {
        const text = icon.nextSibling.textContent.trim();
        if (text) {
          link.setAttribute('data-tooltip', text);
        }
      }
    });
  }

  /* ---------- Focus Trap (Mobile Drawer) ---------- */

  function trapFocus(element) {
    const focusableEls = element.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled])'
    );
    if (focusableEls.length === 0) return;

    const firstFocusable = focusableEls[0];
    const lastFocusable = focusableEls[focusableEls.length - 1];

    function handler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    }

    element.addEventListener('keydown', handler);
    return handler;
  }

  function removeFocusTrap(element, handler) {
    if (handler) {
      element.removeEventListener('keydown', handler);
    }
  }

  let currentFocusTrapHandler = null;

  /* ---------- Desktop / Tablet Collapse ---------- */

  function applyCollapsedState(collapsed) {
    if (isMobile()) return; // Mobile uses different mechanism

    if (collapsed) {
      sidebar.classList.add('collapsed');
      sidebar.classList.remove('expanded');
      if (sidebarCollapseBtn) {
        sidebarCollapseBtn.setAttribute('aria-label', 'Expand sidebar');
        sidebarCollapseBtn.title = 'Expand sidebar';
      }
    } else {
      sidebar.classList.remove('collapsed');
      if (isDesktop()) {
        // Desktop: fully expanded, no expanded class needed
        sidebar.classList.remove('expanded');
      } else {
        // Tablet: use expanded class for full width
        sidebar.classList.add('expanded');
      }
      if (sidebarCollapseBtn) {
        sidebarCollapseBtn.setAttribute('aria-label', 'Collapse sidebar');
        sidebarCollapseBtn.title = 'Collapse sidebar';
      }
    }
    setStoredState(collapsed);
  }

  function toggleCollapse() {
    if (isMobile()) return;
    const isCollapsed = sidebar.classList.contains('collapsed');
    applyCollapsedState(!isCollapsed);
  }

  /* ---------- Mobile Drawer ---------- */

  function openMobileDrawer() {
    if (!isMobile()) return;
    sidebar.classList.add('mobile-open');
    sidebarOverlay.classList.add('active');
    sidebarToggle.setAttribute('aria-expanded', 'true');
    sidebarOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Install focus trap
    currentFocusTrapHandler = trapFocus(sidebar);

    // Move focus to sidebar for accessibility
    const firstFocusable = sidebar.querySelector('a, button');
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }

  function closeMobileDrawer() {
    if (!isMobile()) return;
    sidebar.classList.remove('mobile-open');
    sidebarOverlay.classList.remove('active');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    sidebarOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Remove focus trap
    if (currentFocusTrapHandler) {
      removeFocusTrap(sidebar, currentFocusTrapHandler);
      currentFocusTrapHandler = null;
    }

    // Return focus to hamburger button
    if (sidebarToggle) {
      sidebarToggle.focus();
    }
  }

  function toggleMobileDrawer() {
    if (sidebar.classList.contains('mobile-open')) {
      closeMobileDrawer();
    } else {
      openMobileDrawer();
    }
  }

  /* ---------- Event Listeners ---------- */

  // Hamburger button in navbar (mobile)
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function (e) {
      e.preventDefault();
      toggleMobileDrawer();
    });
  }

  // Collapse button inside sidebar (desktop/tablet)
  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleCollapse();
    });
  }

  // Overlay click closes mobile drawer
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', function () {
      closeMobileDrawer();
    });
  }

  // Escape key closes mobile drawer or collapses sidebar
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (isMobile() && sidebar.classList.contains('mobile-open')) {
        closeMobileDrawer();
      }
    }
  });

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
      const wasMobile = sidebar.classList.contains('mobile-open');
      if (!isMobile() && wasMobile) {
        // Switching from mobile to desktop/tablet: close drawer
        closeMobileDrawer();
      }
      // Re-apply collapsed state for new viewport
      if (!isMobile()) {
        const stored = getStoredState();
        applyCollapsedState(stored);
      }
    }, 150);
  });

  /* ---------- Nested Menu Accessibility ---------- */

  // Ensure collapse toggles in sidebar have proper keyboard handling
  const sidebarLinks = sidebar.querySelectorAll('.sidebar-link[data-bs-toggle="collapse"]');
  sidebarLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      // Let Bootstrap handle the collapse, but ensure aria-expanded is correct
      const targetId = this.getAttribute('data-bs-target');
      if (targetId) {
        const target = document.querySelector(targetId);
        if (target) {
          const isExpanded = this.getAttribute('aria-expanded') === 'true';
          this.setAttribute('aria-expanded', String(!isExpanded));
        }
      }
    });
  });

  /* ---------- Initialize on Page Load ---------- */

  function init() {
    addTooltipAttributes();

    if (isMobile()) {
      // Mobile: sidebar hidden by default
      sidebar.classList.remove('collapsed', 'expanded', 'mobile-open');
      sidebarOverlay.classList.remove('active');
      sidebarToggle.setAttribute('aria-expanded', 'false');
      sidebarOverlay.setAttribute('aria-hidden', 'true');
    } else {
      // Desktop/Tablet: restore collapsed state from localStorage
      const stored = getStoredState();
      if (isDesktop()) {
        // Desktop: default to expanded (visible) if no stored preference
        applyCollapsedState(stored !== null ? stored : false);
      } else {
        // Tablet: default to collapsed (icon-only) if no stored preference
        applyCollapsedState(stored !== null ? stored : true);
      }
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();