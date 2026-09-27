'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadRepository() {
  const queries = [];
  const module = { exports: {} };
  const database = {
    ResultSession: {
      findAll: async () => [{ session_id: 1 }]
    },
    sequelize: {
      query: async (sql, options) => {
        queries.push({ sql, replacements: options.replacements });
        return [];
      }
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'repositories/analyticsRepository.js'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === 'sequelize') return { QueryTypes: { SELECT: 'SELECT' } };
      if (name === '../database/models') return database;
      throw new Error(`Unexpected require: ${name}`);
    }
  });

  return { repository: module.exports, queries };
}

function topperServiceResponse() {
  const module = { exports: {} };
  const repository = {
    getTopStudents: async () => [{
      rank: '1', cgpa: '9.12', sgpa: '9.00',
      subjectsAttempted: '6', passed: '6', failed: '0'
    }]
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/analyticsService.js'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      assert.equal(name, '../repositories/analyticsRepository');
      return repository;
    }
  });
  return module.exports.getToppers({ batch_id: 7 });
}

test('Toppers query excludes failed or CGPA-less results and ranks before pagination', async () => {
  const { repository, queries } = loadRepository();
  await repository.getTopStudents({ batch_id: 7 }, { limit: 25, offset: 50 });

  assert.equal(queries.length, 1);
  const { sql, replacements } = queries[0];
  assert.match(sql, /r\.result_status = 'pass'/);
  assert.match(sql, /r\.cgpa IS NOT NULL/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(ORDER BY r\.cgpa DESC, st\.usn ASC\) AS `rank`/);
  assert.match(sql, /HAVING SUM\(CASE WHEN .* = 'fail' THEN 1 ELSE 0 END\) = 0/);
  assert.match(sql, /ORDER BY r\.cgpa DESC, st\.usn ASC/);
  assert.match(sql, /LIMIT :limitValue OFFSET :offsetValue/);
  // The repository is evaluated in a VM; round-trip the replacements to
  // compare their values with this realm's native strict deep equality.
  assert.deepEqual(JSON.parse(JSON.stringify(replacements)), {
    sessionIds: [1], limitValue: 25, offsetValue: 50
  });
});

test('Toppers service returns a numeric fixed rank and describes its policy', async () => {
  const response = await topperServiceResponse();
  assert.equal(response.data[0].rank, 1);
  assert.equal(response.data[0].cgpa, 9.12);
  assert.match(response.notice, /stored CGPA/);
});

test('Toppers page disables table sorting while keeping search and count', () => {
  const template = fs.readFileSync(path.join(root, 'views/analytics/toppers.ejs'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public/js/analytics/toppers.js'), 'utf8');
  const headers = [...template.matchAll(/<th\b[^>]*>/g)].map(match => match[0]);

  assert.ok(headers.length > 0, 'Toppers table must have column headers');
  assert.ok(headers.every(header => /data-nosort/.test(header)), 'Every Toppers column must be non-sortable');
  assert.doesNotMatch(template, /Click a column header to sort/);
  assert.match(template, /id="toppers-search"/);
  assert.match(template, /id="toppers-count"/);
  assert.match(script, /AnalyticsTable\.enhance\('toppers-table', \{\s*search: 'toppers-search',\s*count: 'toppers-count'/);
});
