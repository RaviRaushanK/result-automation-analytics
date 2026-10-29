'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const menu = require('../middlewares/menuMiddleware');
const db = require('../database/models');
after(() => db.sequelize.close());

const analytics = ['/analytics/overview', '/analytics/students', '/analytics/toppers', '/analytics/failed', '/analytics/subjects', '/analytics/semesters', '/analytics/progress', '/analytics/revaluation'];
const reports = ['/reports', '/reports/student', '/reports/class', '/reports/subject', '/reports/toppers', '/reports/consolidated', '/reports/student-progress', '/reports/result-analysis', '/reports/revaluation'];
async function render(role, currentPath = '/dashboard', account = {}) {
  const req = { user: { role, username: 'faculty.login' }, account, originalUrl: currentPath };
  const res = { locals: {} }; menu(req, res, () => {});
  return ejs.renderFile(path.join(__dirname, '../views/partials/sidebar.ejs'), { ...res.locals, user: req.user });
}

test('only Faculty Analytics defaults open with exactly the existing permitted navigation', async () => {
  const html = await render('faculty');
  assert.match(html, /Faculty Workspace/);
  assert.match(html, /class="collapse show" id="menu-analytics"/);
  assert.match(html, /class="collapse" id="menu-reports"/);
  assert.match(await render('faculty', '/reports/class'), /class="collapse show" id="menu-reports"/);
  const links = [...html.matchAll(/href="([^"#]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, ['/dashboard', ...analytics, ...reports, '/settings']);
  assert.match(html, /Progress \/ Backlog Trends/); assert.match(html, />Class Result</);
  for (const forbidden of ['Academic Management', 'Student Repository', 'Result Management']) assert.ok(!html.includes(forbidden));
});

test('faculty active child and parent stay correct on every permitted destination', async () => {
  for (const route of [...analytics, ...reports, '/settings']) {
    const html = await render('faculty', route);
    const active = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>/g)];
    assert.equal(active.length, 1, route);
    assert.ok(active[0][0].includes(`href="${route}"`), route);
    assert.match(active[0][0], /sidebar-link[^"\n]* active/);
    const parent = html.match(/class="([^"]*active-parent[^"]*)"[\s\S]*?data-bs-target="#menu-([^"]+)"/);
    assert.equal(parent?.[2], route.startsWith('/analytics') ? 'analytics' : route.startsWith('/reports') ? 'reports' : undefined, route);
  }
  assert.match(await render('faculty', '/analytics'), /href="\/analytics\/overview" aria-current="page"/);
  assert.match(await render('faculty', '/reports/class/print'), /href="\/reports\/class" aria-current="page"/);
});

test('Faculty identity details are not displayed above Settings', async () => {
  const html = await render('faculty', '/dashboard', { faculty_name: 'Current faculty name', faculty_code: 'FAC42' });
  assert.doesNotMatch(html, /faculty-sidebar-profile|Current faculty name|FAC42|faculty\.login/);
  assert.match(html, /sidebar-settings-link/);
});

test('Admin navigation retains its labels, destinations, and active-group-only expansion', async () => {
  const dashboard = await render('admin');
  assert.doesNotMatch(dashboard, /faculty-sidebar|Faculty Workspace|collapse show/);
  for (const link of ['/batches', '/subjects', '/students', '/faculty', '/results/upload', '/revaluation/start']) assert.ok(dashboard.includes(`href="${link}"`));
  assert.match(dashboard, /Progress \/ Backlog Trends/); assert.match(dashboard, />Class Result</);
  const selected = await render('admin', '/reports/class');
  assert.match(selected, /class="collapse show" id="menu-reports"/);
  assert.match(selected, /class="collapse" id="menu-analytics"/);
  const head = path.join(__dirname, '../views/partials/head.ejs');
  assert.doesNotMatch(await ejs.renderFile(head, { user: { role: 'admin' }, theme: 'light' }), /faculty-sidebar\.css/);
  assert.match(await ejs.renderFile(head, { user: { role: 'faculty' }, theme: 'light' }), /faculty-sidebar\.css/);
});

test('every exposed Analytics and Reports destination permits Faculty in its actual backend router', async () => {
  const express = require('express'), layouts = require('express-ejs-layouts');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.set('layout', 'layouts/main'); app.use(layouts);
  app.use((req, res, next) => {
    const role = req.get('x-fixture-role') || 'faculty';
    req.session = { adminId: 1, username: 'Route fixture', role };
    req.account = { admin_id: 1, username: 'Route fixture', role, faculty_name: 'Route faculty', faculty_code: 'FAC42' };
    res.locals.flash = []; res.locals.breadcrumbItems = []; next();
  });
  app.use(require('../middlewares/themeMiddleware'));
  app.use('/analytics', require('../routes/analyticsRoutes')); app.use('/reports', require('../routes/reportsRoutes'));
  app.use((error, req, res, next) => res.status(error.status || 500).send(error.message));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const route of [...analytics, ...reports]) {
      assert.equal((await fetch(origin + route)).status, 200, route);
      assert.equal((await fetch(origin + route, { headers: { 'x-fixture-role': 'student' } })).status, 403, route);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
