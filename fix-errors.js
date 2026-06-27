// Fix script 
const fs = require('fs'); 
let content = fs.readFileSync('app.js', 'utf-8'); 
let lines = content.split('\n'); 
