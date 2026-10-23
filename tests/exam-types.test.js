'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../database/models');
const policy = require('../services/academicPolicy');
const controller = require('../controllers/resultController');
const analytics = require('../services/analyticsService');
const { base, pages } = require('./fixtures/result-management-pages');
after(() => db.sequelize.close());

test('new entry types are restricted while legacy participation remains recognizable', () => {
  assert.deepEqual(controller._test.ALLOWED_EXAM_TYPES, ['REGULAR', 'BACKLOG']);
  for (const type of policy.EXAM_TYPES) {
    const parsed = controller._test.sanitizeAttempt(type === 'REGULAR' ? 1 : 3, type);
    assert.equal(parsed.ok, policy.NEW_EXAM_TYPES.includes(type));
    if (type !== 'REGULAR') assert.equal(policy.isRetakeAttempt(type), true);
  }
  for (const type of ['', null]) assert.equal(controller._test.sanitizeAttempt(1, type).ok, false);
  assert.equal(controller._test.sanitizeAttempt(2, 'REGULAR').ok, false);
  assert.equal(controller._test.sanitizeAttempt(1, 'BACKLOG').ok, false);
  for (const attempt of [2, 3, 25, 1000]) {
    assert.equal(controller._test.sanitizeAttempt(attempt, 'BACKLOG').attempt_no, attempt);
  }
});

test('upload and report selects offer only Regular and Backlog; upload is required', async () => {
  const upload = await ejs.renderFile(path.join(__dirname, '../views/results/upload.ejs'), { ...base, ...pages.upload[1] });
  const select = upload.match(/<select[^>]*name="exam_type"[^>]*>[\s\S]*?<\/select>/)[0];
  assert.match(select, /\brequired\b/);
  assert.match(select, /value="REGULAR"/);
  assert.match(select, /value="BACKLOG"/);
  assert.doesNotMatch(select, /SUPPLEMENTARY|REPEAT/);
  for (const reportType of ['class', 'toppers', 'consolidated']) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/reports/partials/page.ejs'), { reportType, reportTitle: 'Test', branding: {} });
    const filter = html.match(/<select[^>]*name="exam_type"[^>]*>[\s\S]*?<\/select>/)[0];
    assert.match(filter, /value="REGULAR"/);
    assert.match(filter, /value="BACKLOG"/);
    assert.doesNotMatch(filter, /SUPPLEMENTARY|REPEAT/);
  }
});

test('upload defaults Regular to 1 and Backlog to 2 while allowing later Backlog attempts', () => {
  const handlers = {};
  const type = { value: 'REGULAR', addEventListener: (name, handler) => { handlers[name] = handler; } };
  const attempt = { value: '1' };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/uploadSession.js'), 'utf8'), {
    document: {
      addEventListener: (name, handler) => { if (name === 'DOMContentLoaded') handler(); },
      getElementById: id => id === 'examTypeSelect' ? type : id === 'attemptNoInput' ? attempt : null
    }
  });
  assert.equal(attempt.value, '1');
  assert.equal(attempt.readOnly, true);
  type.value = 'BACKLOG'; handlers.change();
  assert.equal(attempt.value, '2'); assert.equal(attempt.min, '2'); assert.equal(attempt.readOnly, false);
  attempt.value = '3'; handlers.change(); assert.equal(attempt.value, '3');
  type.value = 'REGULAR'; handlers.change();
  assert.equal(attempt.value, '1'); assert.equal(attempt.readOnly, true);
});

test('Review exposes the semester Backlog number for correction without offering legacy exam types', async () => {
  for (const exam_type of ['REGULAR', 'BACKLOG']) {
    const attempt_no = exam_type === 'REGULAR' ? 1 : 3;
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), {
      ...base, ...pages.review[1], attempt: { attempt_no, exam_type }
    });
    const input = html.match(/<input[^>]*id="reviewAttemptNo"[^>]*>/)[0];
    assert.match(input, new RegExp('value="' + attempt_no + '"'));
    assert.match(input, /required/);
    assert.equal(input.includes('readonly'), exam_type === 'REGULAR');
    assert.doesNotMatch(html, /<option[^>]*value="(?:SUPPLEMENTARY|REPEAT)"/);
  }
});

test('Analytics filter renders with only the normal types on every attempt analysis page', async () => {
  for (const page of ['overview', 'students', 'toppers', 'failed', 'subjects', 'semesters']) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/analytics/' + page + '.ejs'), {});
    const select = html.match(/<select[^>]*name="exam_type"[^>]*>[\s\S]*?<\/select>/)[0];
    assert.match(select, /value="REGULAR"/);
    assert.match(select, /value="BACKLOG"/);
    assert.doesNotMatch(select, /SUPPLEMENTARY|REPEAT/);
  }
});

test('Analytics scopes both modes by exact exam type and keeps legacy filters readable', async () => {
  const query = db.sequelize.query, sessions = db.ExamSession.findAll;
  let captured;
  db.ExamSession.findAll = async () => [{ exam_session_id: 1 }];
  db.sequelize.query = async (sql, options) => {
    captured = { sql, params: options.replacements };
    return [{ examType: options.replacements.examType, sgpa: null, cgpa: null, subjectsAttempted: 1, passed: 0, failed: 1 }];
  };
  try {
    for (const mode of ['original', 'effective']) for (const exam_type of policy.EXAM_TYPES) {
      const result = await analytics.getStudentAnalytics({ exam_session_id: 1, attempt: 'all', mode, exam_type });
      assert.match(captured.sql, /r\.exam_type = :examType/);
      assert.equal(captured.params.examType, exam_type);
      assert.equal(result.data[0].examType, exam_type);
      assert.equal(result.data[0].sgpa, null);
      assert.equal(result.mode, mode);
      if (mode === 'effective') assert.match(captured.sql, /revaluation_status = 'approved'/);
    }
    await analytics.getStudentAnalytics({ exam_session_id: 1, attempt: 'all' });
    assert.equal(captured.params.examType, undefined);
    assert.doesNotMatch(captured.sql, /r\.exam_type = :examType/);
  } finally { db.sequelize.query = query; db.ExamSession.findAll = sessions; }
});
