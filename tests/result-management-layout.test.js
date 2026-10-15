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

test('responsive stylesheet is restricted to Result Management requests', async () => {
  const head = path.join(__dirname, '../views/partials/head.ejs');
  assert.match(await ejs.renderFile(head, { resultManagementPage: true }), /href="\/css\/result-management.css"/);
  assert.doesNotMatch(await ejs.renderFile(head, {}), /href="\/css\/result-management.css"/);
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
