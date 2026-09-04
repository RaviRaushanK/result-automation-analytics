const fs = require('fs');
const lines = fs.readFileSync('views/revaluation/review.ejs','utf8').split('\n');
const s = parseInt(process.argv[2],10); const c = parseInt(process.argv[3],10);
lines.slice(s-1, s-1+c).forEach((l,i)=>console.log((s+i)+': '+l));
