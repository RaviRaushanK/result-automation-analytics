'use strict';
const fs = require('fs');
const r = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + f.name;
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.ejs')) r.push(p);
  }
}
walk('views');
const filtered = r.filter(p => p.toLowerCase().includes('log') || p.toLowerCase().includes('import'));
console.log('All ejs files matching log/import:');
filtered.forEach(p => console.log('  ', p));
console.log('\nAll ejs files:');
r.forEach(p => console.log('  ', p));