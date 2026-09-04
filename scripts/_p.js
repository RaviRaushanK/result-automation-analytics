require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
var db = require('../database/models');
var RS = db.ResultSession, St = db.Student, Res = db.Result, SR = db.SubjectResult, IL = db.ImportLog, OE = db.OcrExtraction;
var sequelize = db.sequelize;
async function probe() {
  await sequelize.authenticate();
  var sessions = await RS.findAll({ include: [{ model: St, as: 'Student' }], order: [['created_at','DESC']], limit: 10 });
  console.log('Sessions:');
  sessions.forEach(function(s) { console.log('  id=' + s.session_id + ' ' + s.session_name + ' stu=' + (s.Student ? s.Student.usn + ' ' + s.Student.student_name : '-')) });
  var sindu = null;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].Student && /SINDU/i.test(sessions[i].Student.usn)) { sindu = sessions[i]; break; }
  }
  if (!sindu) { console.log('No SINDU session'); sequelize.close(); return; }
  console.log('\nSINDU session_id=' + sindu.session_id);
  var result = await Res.findOne({ where: { session_id: sindu.session_id } });
  if (!result) { console.log('No result'); sequelize.close(); return; }
  console.log('result_id=' + result.result_id + ' attempt=' + result.attempt_no + ' exam=' + result.exam_type);
  var srs = await SR.findAll({ where: { result_id: result.result_id } });
  console.log('SubjectResults:');
  srs.forEach(function(sr) { console.log('  srid=' + sr.subject_result_id + ' code=' + sr.subject_code + ' name=' + sr.subject_name + ' marks=' + sr.marks + ' status=' + sr.result_status + ' credits=' + sr.credits) });
  var logs = await IL.findAll({ where: { session_id: sindu.session_id }, order: [['created_at','DESC']] });
  console.log('ImportLogs:');
  logs.forEach(function(l) { console.log('  import_id=' + l.import_id + ' type=' + l.import_type + ' status=' + l.status + ' file=' + l.file_name) });
  var ocrs = await OE.findAll({ where: { import_id: logs.map(function(l) { return l.import_id }) }, order: [['created_at','DESC']] });
  console.log('OcrExtractions:');
  for (var i = 0; i < ocrs.length; i++) {
    var o = ocrs[i];
    var ej = o.extracted_json || {};
    var ocr = ej.ocr || {};
    var subs = ocr.subjects || [];
    console.log('  ocr_id=' + o.extraction_id + ' import_id=' + o.import_id + ' status=' + o.extraction_status + ' method=' + ocr.extraction_method);
    for (var j = 0; j < subs.length; j++) {
      var s = subs[j];
      console.log('    sub: code=' + (s.subjectCode||'') + ' name=' + (s.subjectName||'') + ' int=' + s.internalMarks + ' old=' + s.oldMarks + ' oldRes=' + s.oldResult + ' rv=' + s.rvMarks + ' rvRes=' + s.rvResult + ' final=' + s.finalMarks + ' finalRes=' + s.finalResult + ' conf=' + s.confidence + ' match=' + s.match_state);
    }
    var missing = ocr.missing_subjects || [];
    console.log('    missing_subjects: ' + missing.length);
    for (var k = 0; k < missing.length; k++) { console.log('      ' + (missing[k].subject_code||missing[k].code||'') + ' ' + (missing[k].subject_name||'')) }
    var stu = ocr.student_candidates || {};
    console.log('    OCR student: usn=' + JSON.stringify(stu.usn) + ' usn_norm=' + JSON.stringify(stu.usn_normalized));
  }
  sequelize.close();
}
probe().catch(function(e) { console.error(e); process.exit(1); });
probe().catch(function(e){console.error(e);process.exit(1);}); process.exit(1); });

