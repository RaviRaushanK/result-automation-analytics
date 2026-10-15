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
