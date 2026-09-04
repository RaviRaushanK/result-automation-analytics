var fs = require('fs');
var c = fs.readFileSync('scripts/_real_verify.js', 'utf8');
fs.writeFileSync('scripts/_real_verify.content.txt', c);
console.log('lines: ' + c.split('\n').length + ', chars: ' + c.length);

