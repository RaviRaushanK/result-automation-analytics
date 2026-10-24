'use strict';
// Explicit, evidence-checked maintenance only. Defaults to read-only dry run.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const db = require('../database/models');
const integrity = require('../services/revaluationIntegrity');
const components = require('../services/revaluationComponentEvidence');
const policy = require('../services/academicPolicy');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
async function correct(eventId, apply = false) {
  assert.ok(Number.isSafeInteger(eventId) && eventId > 0, 'Supply a positive revaluation event ID.');
  return db.sequelize.transaction(async transaction => {
    const query = async (sql, replacements = {}) => (await db.sequelize.query(sql, { replacements, transaction }))[0];
    const [peek] = await query('SELECT sr.result_id FROM revaluation_results rv JOIN subject_results sr ON sr.subject_result_id=rv.subject_result_id WHERE rv.revaluation_id=:id', { id: eventId });
    assert.ok(peek, 'Approved event no longer exists.');
    const result = await db.Result.findByPk(peek.result_id, { transaction, lock: true,
      include: [
        { model: db.Student, attributes: ['student_name', 'usn', 'batch_id'] },
        { model: db.ExamSession, attributes: ['semester', 'exam_session', 'exam_year', 'exam_start_month', 'exam_start_year', 'exam_end_month', 'exam_end_year', 'batch_id'] },
        { model: db.SubjectResult, attributes: ['subject_result_id', 'result_id', 'subject_id', 'internal_marks', 'external_marks', 'marks', 'grade', 'result_status'],
          include: [{ model: db.Subject, attributes: ['subject_code', 'subject_name', 'subject_type', 'credits', 'exam_session_id', 'course_id', 'max_internal', 'max_external', 'max_marks'] }] }
      ] });
    const [event] = await query('SELECT * FROM revaluation_results WHERE revaluation_id=:id FOR UPDATE', { id: eventId });
    assert.equal(event.revaluation_status, 'approved'); assert.equal(Number(event.is_effective), 1);
    assert.equal(event.revised_internal_marks, null); assert.equal(event.revised_external_marks, null);
    const [latest] = await query("SELECT MAX(revaluation_no) AS no FROM revaluation_results WHERE subject_result_id=:sr AND is_effective=1 AND revaluation_status='approved'", { sr: event.subject_result_id });
    assert.equal(Number(event.revaluation_no), Number(latest.no));
    const importId = parse(event.remarks).import_id;
    const [log] = await query('SELECT status FROM import_logs WHERE import_id=:id FOR UPDATE', { id: importId });
    assert.equal(log.status, 'success');
    const extractions = await query('SELECT extracted_json FROM ocr_extractions WHERE import_id=:id FOR UPDATE', { id: importId });
    assert.equal(extractions.length, 1);
    const saved = parse(extractions[0].extracted_json), review = saved.review;
    assert.equal(Number(saved.result_id), Number(result.result_id));
    assert.ok(review.event_ids.map(Number).includes(Number(eventId)));
    const proposals = review.proposal.filter(p => p.decision === 'accept' && Number(p.bound_to_srid || p.subject_result_id) === Number(event.subject_result_id));
    assert.equal(proposals.length, 1);
    const proposal = proposals[0], sr = result.SubjectResults.find(s => Number(s.subject_result_id) === Number(event.subject_result_id));
    assert.ok(sr && sr.Subject);
    assert.equal(Number(sr.marks), Number(event.original_marks)); assert.equal(sr.result_status, event.original_status);
    assert.equal(integrity.snapshotDigest(review.target_snapshot), integrity.snapshotDigest(integrity.snapshot(result)), 'Original academic configuration changed since approval.');
    assert.deepEqual(integrity.verify(saved, result, [proposal], review.identity_verified).errors, []);
    assert.equal(parse(event.remarks).event_fingerprint, integrity.eventFingerprint(saved, sr.subject_result_id));
    const sources = saved.ocr.subjects.filter(s => Number(s.subject_result_id) === Number(proposal.subject_result_id));
    assert.equal(sources.length, 1);
    const values = components.fromApprovedReview(sources[0], proposal, sr.Subject, saved.ocr.raw_text);
    assert.equal(values.revised_internal_marks, null, 'This maintenance correction must not manufacture revised IA.');
    assert.ok(values.revised_external_marks !== null, 'No explicit revised external evidence.');
    assert.equal(Number(proposal.proposed_revised_internal_marks), Number(sr.internal_marks));
    assert.equal(Number(proposal.proposed_revised_total_marks), Number(event.revised_marks));
    assert.equal(Number(sr.internal_marks) + values.revised_external_marks, Number(event.revised_marks));
    const grade = policy.gradeFromComponents(Number(sr.internal_marks), values.revised_external_marks, sr.Subject);
    assert.equal(grade.status, event.revised_status); assert.equal(grade.grade, event.revised_grade);
    const doc = saved.documents[0], file = path.resolve(doc.file_path), root = path.resolve(__dirname, '../uploads') + path.sep;
    assert.ok(file.toLowerCase().startsWith(root.toLowerCase()), 'Document must remain under the upload directory.');
    assert.match(doc.sha256, /^[a-f0-9]{64}$/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), doc.sha256, 'Source document changed.');
    const [actor] = await query("SELECT admin_id FROM admin_users WHERE admin_id=:id AND role='admin' AND status='active' AND deleted_at IS NULL FOR UPDATE", { id: event.reviewed_by });
    assert.ok(actor, 'Original reviewing administrator is unavailable.');
    const plan = { revaluation_id: Number(eventId), import_id: Number(importId), original_subject_result: Number(sr.subject_result_id),
      actor: Number(actor.admin_id), old_external: null, revised_external_marks: values.revised_external_marks,
      revised_internal_marks: null, total: Number(event.revised_marks), apply };
    if (!apply) return plan;
    const [beforeResult] = await query('SELECT * FROM results WHERE result_id=:id', { id: result.result_id });
    const [beforeSubject] = await query('SELECT * FROM subject_results WHERE subject_result_id=:id', { id: sr.subject_result_id });
    await query('UPDATE revaluation_results SET revised_external_marks=:marks WHERE revaluation_id=:id AND revised_external_marks IS NULL AND revised_internal_marks IS NULL', { marks: values.revised_external_marks, id: eventId });
    const [after] = await query('SELECT * FROM revaluation_results WHERE revaluation_id=:id', { id: eventId });
    for (const key of Object.keys(event)) assert.deepEqual(after[key], key === 'revised_external_marks' ? values.revised_external_marks : event[key], 'Unexpected event change: ' + key);
    const [afterResult] = await query('SELECT * FROM results WHERE result_id=:id', { id: result.result_id });
    const [afterSubject] = await query('SELECT * FROM subject_results WHERE subject_result_id=:id', { id: sr.subject_result_id });
    assert.deepEqual(afterResult, beforeResult); assert.deepEqual(afterSubject, beforeSubject);
    const activity = `revaluation_component_evidence_correction event=${eventId} import=${importId} sr=${sr.subject_result_id} revised_external=NULL->${values.revised_external_marks}; reason=verified approved VTU card and frozen review; source=maintenance`;
    assert.ok(activity.length <= 255);
    await query('INSERT INTO activity_logs (admin_id,activity,ip_address,created_at) VALUES (:actor,:activity,\'maintenance\',CURRENT_TIMESTAMP)', { actor: actor.admin_id, activity });
    const [audit] = await query('SELECT LAST_INSERT_ID() AS id');
    return { ...plan, audit_log_id: Number(audit.id) };
  });
}
module.exports = { correct };
if (require.main === module) {
  const args = process.argv.slice(2), position = args.indexOf('--event');
  correct(Number(args[position + 1]), args.includes('--apply')).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.sequelize.close());
}
