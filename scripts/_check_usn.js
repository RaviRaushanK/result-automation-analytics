require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
var db = require('../database/models');
var St = db.Student;
var Op = require('sequelize').Op;
db.sequelize.authenticate().then(function() {
  return St.findAll({ attributes: ['student_id','usn','student_name'], order: [['student_id','ASC']], limit: 50 });
}).then(function(students) {
  console.log('Total students: ' + students.length);
  students.forEach(function(s) { console.log('id=' + s.student_id + ' usn=' + s.usn + ' name=' + s.student_name); });
  db.sequelize.close();
}).catch(function(e) { console.error(e); process.exit(1); });

