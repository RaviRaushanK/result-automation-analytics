require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
var db = require('../database/models');
var RS = db.ResultSession, Res = db.Result, St = db.Student, IL = db.ImportLog, OE = db.OcrExtraction;
db.sequelize.authenticate().then(function() {
  return RS.findAll({ order: [['created_at','DESC']] });
}).then(function(sessions) {
  console.log('Sessions: ' + sessions.length);
  return Promise.all(sessions.map(function(s) {
    return Res.findOne({ where: { session_id: s.session_id }, include: [{ model: St, as: 'Student' }] }).then(function(r) {
      return IL.findAll({ where: { session_id: s.session_id } }).then(function(logs) {
        return { session: s, result: r, logs: logs };
      });
    });
  }));
}).then(function(rows) {
  rows.forEach(function(row) {
    var s = row.session, r = row.result;
    console.log('--- session_id=' + s.session_id + ' ' + s.session_name + ' ---');
    if (r) console.log('  result_id=' + r.result_id + ' student=' + (r.Student ? r.Student.usn + ' ' + r.Student.student_name : '-'));
    row.logs.forEach(function(l) { console.log('  import_id=' + l.import_id + ' type=' + l.import_type + ' status=' + l.status + ' file=' + l.file_name); });
  });
  // Now show OCR for each import
  return OE.findAll({ order: [['created_at','DESC']] });
}).then(function(ocrs) {
  console.log('\nOcrExtractions: ' + ocrs.length);
  ocrs.forEach(function(o) {
    var ej = o.extracted_json || {};
    var ocr = ej.ocr || {};
    var subs = ocr.subjects || [];
    var stuCand = ocr.student_candidates || {};
    console.log('--- ocr_id=' + o.extraction_id + ' import_id=' + o.import_id + ' status=' + o.extraction_status + ' method=' + ocr.extraction_method + ' ---');
    console.log('  OCR student USN: ' + JSON.stringify(stuCand.usn) + ' norm: ' + JSON.stringify(stuCand.usn_normalized));
    subs.forEach(function(s) { console.log('  code=' + (s.subjectCode||'') + ' int=' + s.internalMarks + ' old=' + s.oldMarks + ' rv=' + s.rvMarks + ' final=' + s.finalMarks + ' conf=' + s.confidence + ' match=' + s.match_state); });
    console.log('  missing_subjects: ' + (ocr.missing_subjects||[]).length);
  });
  db.sequelize.close();
}).catch(function(e) { console.error(e); process.exit(1); });

