'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const layouts = require('express-ejs-layouts');
const path = require('node:path');
const groups = require('../config/reportCenter');
const reports = require('../services/reportsService');
const sidebar = require('../config/sidebar.json');
const db = require('../database/models');
after(() => db.sequelize.close());

async function harness(run) {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.use(layouts); app.set('layout', 'layouts/main');
  app.use(express.static(path.join(__dirname, '../public')));
  app.use((req, res, next) => {
    const role = req.headers['x-role']; req.session = role ? { adminId: 1, role, username: 'UX test' } : {};
    res.locals.flash = []; res.locals.breadcrumbItems = []; next();
  });
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.use('/reports', require('../routes/reportsRoutes')); app.use('/analytics', require('../routes/analyticsRoutes'));
  app.use((err, req, res, next) => res.status(err.status || 500).send(err.message));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('report center covers exactly every formal report with valid destinations', () => {
  const cards = groups.flatMap(g => g.cards);
  assert.deepEqual(cards.map(c => c.type).sort(), [...reports.TYPES].sort());
  for (const card of cards) { assert.equal(card.href, '/reports/' + card.type); assert.equal(card.title, reports.TITLES[card.type]); }
});

test('every Analytics page loads its real stylesheet after shared styles and uses the local chart asset', async () => harness(async base => {
  for (const page of ['overview', 'students', 'toppers', 'failed', 'subjects', 'semesters', 'progress', 'revaluation']) {
    const response = await fetch(base + '/analytics/' + page, { headers: { 'x-role': 'faculty' } });
    assert.equal(response.status, 200);
    const html = await response.text();
    const styles = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(match => match[1]).filter(href => href.startsWith('/css/'));
    const analytics = styles.find(href => href.startsWith('/css/analytics.css'));
    assert.ok(analytics, page + ': Analytics stylesheet declared');
    assert.ok(styles.indexOf(analytics) > styles.indexOf('/css/dashboard.css'), page + ': specific styles follow shared styles');
    for (const href of styles) {
      const asset = await fetch(base + href);
      assert.equal(asset.status, 200, page + ': ' + href);
      assert.match(asset.headers.get('content-type'), /text\/css/);
    }
    const css = await (await fetch(base + analytics)).text();
    for (const selector of ['.analytics-page', '.analytics-filters', '.analytics-chart-scroll', '.analytics-table', '.analytics-nav-link', '.analytics-summary-card']) assert.ok(css.includes(selector), selector);
    assert.match(html, /src="\/js\/reports\/chart\.umd\.min\.js"/);
  }
}));
test('authorized roles render report center, every card, progress page and old pages', async () => harness(async base => {
  for (const role of ['admin', 'faculty']) {
    const response = await fetch(base + '/reports', { headers: { 'x-role': role } });
    assert.equal(response.status, 200); const html = await response.text();
    for (const card of groups.flatMap(g => g.cards)) { assert.ok(html.includes(`class="reports-launcher" href="${card.href}"`)); assert.ok(html.includes(card.title)); }
    assert.match(html, /reports-center-grid/); assert.ok(!html.includes('width="'));
    assert.equal((html.match(/sidebar-link active"/g) || []).length, 1);
  }
  for (const route of ['/analytics', '/analytics/overview', '/analytics/progress', ...reports.TYPES.map(t => '/reports/' + t)]) {
    const response = await fetch(base + route, { headers: { 'x-role': 'faculty' } }); assert.equal(response.status, 200, route);
    const html = await response.text(); assert.equal((html.match(/sidebar-link active"/g) || []).length, 1, route);
  }
}));
test('new routes retain authentication and role restrictions', async () => harness(async base => {
  for (const route of ['/reports', '/analytics/progress', '/analytics/api/progress']) {
    assert.equal((await fetch(base + route, { headers: { Accept: 'application/json' } })).status, 401);
    assert.equal((await fetch(base + route, { headers: { Accept: 'application/json', 'x-role': 'student' } })).status, 403);
  }
  assert.equal((await fetch(base + '/analytics/api/progress?batch_id=bad', { headers: { Accept: 'application/json', 'x-role': 'faculty' } })).status, 400);
}));
test('navigation preserves all reports and exposes progress and both overview routes', () => {
  const children = label => sidebar.menu.find(g => g.label === label).children;
  assert.equal(children('Reports')[0].route, '/reports'); assert.equal(children('Analytics')[0].route, '/analytics/overview');
  assert.ok(children('Analytics').some(c => c.route === '/analytics/progress'));
  for (const type of reports.TYPES) assert.ok(children('Reports').some(c => c.route === '/reports/' + type));
});
