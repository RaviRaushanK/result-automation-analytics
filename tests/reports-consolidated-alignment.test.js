'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');

test('consolidated export identifies student name headers and cells for left alignment only', async () => {
  const columns = [{ key: 'usn', label: 'USN' }, { key: 'student_name', label: 'Name' }, { key: 'total', label: 'Total' }];
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/partials/consolidated-table.ejs'), {
    report: { title: 'Consolidated', fixedColumns: columns.slice(0, 2), subjects: [], trailingColumns: columns.slice(2), columns,
      rows: [{ usn: 'TEST001', student_name: 'Student Name', total: 80 }] },
    display: (key, value) => value
  });
  assert.match(html, /<th[^>]*class="reports-student-name"[^>]*>Name<\/th>/);
  assert.match(html, /<td class="reports-student-name">Student Name<\/td>/);
  assert.match(html, /<td>80<\/td>/);
  assert.equal((html.match(/class="reports-student-name"/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/css/reports.css'), 'utf8'), /\.reports-consolidated \.reports-student-name\s*\{\s*text-align:\s*left;/);
});
