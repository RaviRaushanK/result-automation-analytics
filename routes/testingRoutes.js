/**
 * Testing Routes – Isolated routes for visual verification of EJS layouts.
 * All routes are prefixed with /testing and serve static placeholder content.
 * No database queries, business logic, or production dependencies.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Load sidebar config for main layout menu rendering
const sidebarPath = path.join(__dirname, '..', 'config', 'sidebar.json');
let menuConfig = [];
try {
  const raw = fs.readFileSync(sidebarPath, 'utf-8');
  const json = JSON.parse(raw);
  menuConfig = json.menu || [];
} catch (err) {
  console.error('Testing routes: failed to load sidebar config', err);
}

// Shared mock locals for all test views
const baseLocals = {
  theme: 'light',
  themeClass: 'theme-light',
  user: { name: 'Admin' },
  flash: [
    { type: 'success', text: 'Testing flash message — success.' },
    { type: 'warning', text: 'Testing flash message — warning.' }
  ],
  breadcrumbItems: [
    { href: '/', label: 'Home' },
    { href: '/testing', label: 'Testing' },
    { href: '#', label: 'Current Page' }
  ],
  menuConfig: menuConfig,
  layout: 'layouts/main'
};

/**
 * GET /testing/main
 * Renders the main layout test page with all UI component placeholders.
 */
router.get('/main', (req, res) => {
  res.render('testing-layouts/main', {
    ...baseLocals,
    title: 'Testing – Main Layout',
    layout: 'layouts/main'
  });
});

/**
 * GET /testing/auth
 * Renders the auth layout test page with login/register form placeholders.
 */
router.get('/auth', (req, res) => {
  res.render('testing-layouts/auth', {
    ...baseLocals,
    title: 'Testing – Auth Layout',
    flash: [], // suppress flash for cleaner auth view
    layout: 'layouts/auth'
  });
});

/**
 * GET /testing/report
 * Renders the report layout test page with printable result report placeholders.
 */
router.get('/report', (req, res) => {
  res.render('testing-layouts/report', {
    ...baseLocals,
    title: 'Testing – Report Layout',
    layout: 'layouts/report'
  });
});

module.exports = router;