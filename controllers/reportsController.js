'use strict';

const service = require('../services/reportsService');

function authorization(req, res, next) {
  if (['admin', 'faculty'].includes(req.session?.role || req.user?.role)) return next();
  if (req.path.startsWith('/api/') || req.path.endsWith('.csv')) return res.status(403).json({ success: false, message: 'You are not authorized to access reports.' });
  return res.status(403).send('You are not authorized to access reports.');
}

function error(res, err) {
  if (!err.status) console.error('Reports request failed:', err.message);
  return res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Unable to load the report. Please try again.' });
}

function page(type) {
  return (req, res) => res.render(`reports/${type}`, {
    title: `${service.TITLES[type]} - SRAAS`, reportType: type, reportTitle: service.TITLES[type],
    pageStyles: ['/css/reports.css'],
    breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }, { href: `/reports/${type}`, label: service.TITLES[type] }]
  });
}

function api(type) {
  return async (req, res) => {
    try { res.json({ success: true, report: await service.getReport(type, req.query) }); }
    catch (err) { error(res, err); }
  };
}

function options(scope) {
  return async (req, res) => {
    try { res.json({ success: true, options: await service.getOptions(scope, { ...req.query, ...(req.params.batchId ? { batch_id: req.params.batchId } : {}) }) }); }
    catch (err) { error(res, err); }
  };
}

async function write(res, text) {
  if (res.destroyed) throw new Error('Report download disconnected');
  if (res.write(text)) return;
  await new Promise((resolve, reject) => {
    const clean = () => { res.off('drain', drain); res.off('close', close); res.off('error', fail); };
    const drain = () => { clean(); resolve(); };
    const close = () => { clean(); reject(new Error('Report download disconnected')); };
    const fail = err => { clean(); reject(err); };
    res.once('drain', drain); res.once('close', close); res.once('error', fail);
  });
}

function csv(type) {
  return async (req, res) => {
    try {
      const report = await service.prepare(type, req.query);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${service.filename(report)}"`, 'Cache-Control': 'private, no-store' });
      const line = cells => cells.map(service.csvCell).join(',') + '\r\n';
      await write(res, '\uFEFF' + line([report.title]));
      for (const context of service.contextLines(report)) await write(res, line(context));
      await write(res, '\r\n' + line(['Sl. No.', ...report.columns.map(c => c.label)]));
      let index = 0;
      for await (const row of service.fullRows(report)) await write(res, line([++index, ...report.columns.map(c => service.display(c.key, row[c.key]))]));
      res.end();
    } catch (err) {
      if (res.headersSent) { console.error('Report export failed:', err.message); res.destroy(); }
      else error(res, err);
    }
  };
}

function print(type) {
  return async (req, res) => {
    try {
      const report = await service.prepare(type, req.query);
      report.rows = [];
      for await (const row of service.fullRows(report)) report.rows.push(row);
      res.render('reports/print', { layout: false, report, context: service.contextLines(report), display: service.display });
    } catch (err) { error(res, err); }
  };
}

module.exports = { authorization, page, api, options, csv, print };
