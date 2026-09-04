var fs = require('fs');
var p = 'scripts/_p.js';
var f = fs.readFileSync(p, 'utf8');
f = f.replace(/probe\(\)\.on\([^;]+;/g, 'probe().catch(function(e){console.error(e);process.exit(1);});');
fs.writeFileSync(p, f);
console.log('fixed, last 200 chars:');
console.log(f.slice(-200));

