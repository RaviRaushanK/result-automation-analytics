require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
var db = require('../database/models');
var OE = db.OcrExtraction;
db.sequelize.authenticate().then(function() {
  return OE.findAll({ order: [['extraction_id','ASC']] });
}).then(function(rows) {
  console.log('Total OCR rows: ' + rows.length);
  var valid = [];
  rows.forEach(function(o) {
    if (o.extraction_status === 'extracted' || o.extraction_status === 'success' || (o.extracted_json && o.extracted_json.ocr)) {
      valid.push(o);
    }
  });
  console.log('Rows with extraction_status=extracted/success: ' + valid.length);
  valid.forEach(function(o) {
    var ej = o.extracted_json || {};
    var ocr = ej.ocr || {};
    var subs = ocr.subjects || [];
    var stu = ocr.student_candidates || {};
    console.log('--- ocr_id=' + o.extraction_id + ' import_id=' + o.import_id + ' status=' + o.extraction_status + ' method=' + ocr.extraction_method + ' ---');
    console.log('  USN: ' + JSON.stringify(stu.usn) + ' norm: ' + JSON.stringify(stu.usn_normalized));
    subs.forEach(function(s) { console.log('  code=' + (s.subjectCode||'') + ' name=' + (s.subjectName||'') + ' int=' + s.internalMarks + ' old=' + s.oldMarks + ' rv=' + s.rvMarks + ' final=' + s.finalMarks + ' conf=' + s.confidence + ' match=' + s.match_state); });
    console.log('  missing: ' + (ocr.missing_subjects||[]).length);
  });
  if (valid.length === 0) {
    console.log('Sample raw extracted_json for first 2 rows:');
    rows.slice(0, 2).forEach(function(o) {
      console.log('--- ocr_id=' + o.extraction_id + ' status=' + o.extraction_status + ' ---');
      console.log(JSON.stringify(o.extracted_json, null, 2).substring(0, 1500));
    });
  }
  db.sequelize.close();
}).catch(function(e) { console.error(e); process.exit(1); });

