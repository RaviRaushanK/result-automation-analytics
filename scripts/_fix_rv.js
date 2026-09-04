var fs = require('fs');
var c = fs.readFileSync('scripts/_real_verify.js', 'utf8');
// Remove the old var Op = db.Sequelize.Op; line (keep the require('sequelize').Op one)
c = c.replace(/var Op = db\.Sequelize\.Op;\r?\n?/g, '');
// Fix: also remove duplicate var Op lines
var lines = c.split('\n');
var seenOp = false;
var out = [];
for (var i = 0; i < lines.length; i++) {
  var l = lines[i];
  if (l.indexOf('var Op =') !== -1) {
    if (!seenOp) { out.push(l); seenOp = true; }
    // skip duplicate
  } else {
    out.push(l);
  }
}
c = out.join('\n');
fs.writeFileSync('scripts/_real_verify.js', c);
console.log('fixed. lines=' + c.split('\n').length + ' chars=' + c.length);
// Verify: print first 20 lines
console.log('first 15 lines:');
c.split('\n').slice(0, 15).forEach(function(line, i) { console.log((i+1) + ': ' + line); });

