'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { base, pages } = require('./fixtures/result-management-pages');

for (const [name, [view, locals]] of Object.entries(pages)) {
  test(`Result Management ${name} renders with its responsive scope`, async () => {
    const html = await ejs.renderFile(path.join(__dirname, '../views', view + '.ejs'), {
      ...base, ...locals, user: { role: 'admin' }
    });
    assert.match(html, /class="[^"]*(result-management-page|revaluation-ui)/);
    if (name === 'review') {
      assert.match(html, /title="Original marks card" class="result-document-frame"/);
      assert.doesNotMatch(html, /height:759px/);
    }
    if (name === 'blocked') assert.match(html, /data-registration-blocked="true"/);
  });
}

for (const fileType of ['png', 'jpg', 'jpeg']) {
  test('original result review renders ' + fileType + ' marks card as an image', async () => {
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), {
      ...base, ...pages.review[1], fileType, fileUrl: '/test/card.' + fileType
    });
    assert.match(html, /<img[^>]*src="\/test\/card\./);
    assert.doesNotMatch(html, /<iframe/);
  });
}

test('revaluation preview keeps identity confirmation and replacement controls before Validate', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/revaluation/review.ejs'), {
    ...base, ...pages['revaluation-review'][1],
    identityCheck: { severity: 'mismatch', message: 'Student identity does not match.' },
    identityBlocking: true,
    meta: { ...base.meta, ocrStudent: { name: 'OTHER STUDENT', usn: '1MV25MC099' } }
  });
  assert.match(html, /id="validateRevaluationBtn"[^>]*disabled/);
  assert.match(html, /action="\/revaluation\/pending\/9000\/confirm-identity"/);
  assert.match(html, /id="confirmMismatchModal"/);
  assert.match(html, /upload\?replace=1/);
  assert.match(html, /OTHER STUDENT/);
  assert.match(html, /title="Original revaluation marks card"/);
  assert.doesNotMatch(html, /action="\/revaluation\/approve/);
});

test('validated revaluation preview has one explicit approval POST, not another confirmation page', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/revaluation/review.ejs'), {
    ...base, ...pages.locked[1]
  });
  assert.match(html, /action="\/revaluation\/approve\/9000"/);
  assert.match(html, /Approve &amp; Save/);
  assert.doesNotMatch(html, /href="\/revaluation\/approve/);
  assert.match(html, /review\/9000\?edit=1/);
});

test('responsive stylesheet is restricted to Result Management requests', async () => {
  const head = path.join(__dirname, '../views/partials/head.ejs');
  const stylesheet = /href="\/css\/result-management\.css(?:\?[^"\s]*)?"/;
  assert.match(await ejs.renderFile(head, { resultManagementPage: true }), stylesheet);
  assert.doesNotMatch(await ejs.renderFile(head, {}), stylesheet);
});

for (const [label, maxInternal, maxExternal] of [['internal-only', 100, 0], ['external-only', 0, 100], ['legacy', null, undefined]]) {
  test(`Review displays ${label} component limits without replacing zero with a default`, async () => {
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), {
      ...base, ...pages.review[1],
      subjects: [{ ...base.subjects[0], max_internal: maxInternal, max_external: maxExternal }]
    });
    const internal = maxInternal ?? 50;
    const external = maxExternal ?? 100;
    assert.match(html, new RegExp('max="' + internal + '"[^>]*id="internal_1"[^>]*placeholder="0-' + internal + '"'));
    assert.match(html, new RegExp('max="' + external + '"[^>]*id="external_1"[^>]*placeholder="0-' + external + '"'));
    assert.match(html, new RegExp('max ' + internal + '</div>'));
    assert.match(html, new RegExp('max ' + external + '</div>'));
  });
}
