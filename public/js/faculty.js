var state;
var batch;
var session;
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  var page = document.querySelector('[data-faculty-page]'); if (!page) return;
  var $ = id => document.getElementById(id);
  state = { batches: [], sessions: [], faculty: [], subjects: [], drafts: {}, pending: [], removing: null, removeTarget: null };
  batch = $('facultyBatchSelect'); session = $('facultySessionSelect');
  var sessionRequest = 0, subjectRequest = 0, departmentRequest = 0, facultyLoaded = false;
  function esc(v) { var e = document.createElement('div'); e.textContent = v == null ? '' : String(v); return e.innerHTML; }
  function batchLabel(b) { return b.batch_name + ' (' + b.start_year + '–' + b.end_year + ')'; }
  function sessionLabel(s) {
    if (!s) return '';
    var semester = /^\d+$/.test(String(s.semester)) ? 'Semester ' + s.semester : s.semester;
    return [semester, ExamPeriod.format(s)].filter(Boolean).join(' — ');
  }
  function modal(id, show) { var el = $(id); if (el) bootstrap.Modal.getOrCreateInstance(el)[show ? 'show' : 'hide'](); }
  function error(id, msg) { var el = $(id); el.textContent = msg || ''; el.classList.toggle('d-none', !msg); }
  function toast(type, msg) { var c = $('facultyToastContainer'), el = document.createElement('div'); el.className = 'alert alert-' + type + ' alert-dismissible fade show'; el.innerHTML = esc(msg) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>'; c.appendChild(el); setTimeout(() => bootstrap.Alert.getOrCreateInstance(el).close(), 4500); }
  async function api(url, options) { options = options || {}; var headers = Object.assign({ Accept: 'application/json' }, options.headers || {}); if (options.body) headers['Content-Type'] = 'application/json'; var response; try { response = await fetch(url, Object.assign({}, options, { headers: headers })); } catch (e) { throw new Error('Unable to reach the server. Please try again.'); } var json; try { json = await response.json(); } catch (e) { json = {}; } if (!response.ok) throw new Error(json.message || 'The request could not be completed.'); return json; }
  function currentBatch() { return state.batches.find(b => String(b.batch_id) === batch.value); }
  function currentSession() { return state.sessions.find(s => String(s.exam_session_id) === session.value); }
  function facultyOptions(selected) { return '<option value="">Select Faculty</option>' + state.faculty.map(f => '<option value="' + esc(f.faculty_id) + '"' + (String(f.faculty_id) === String(selected || '') ? ' selected' : '') + '>' + esc((f.faculty_name || '') + (f.designation ? ' — ' + f.designation : '')) + '</option>').join(''); }
  function getSelects(subject) { return Array.from(document.querySelectorAll('[data-faculty-subject="' + subject.subject_id + '"]')); }
  function action(attribute, id, icon, label, kind) { var disabled = attribute === 'data-edit-faculty' && (!facultyLoaded || !state.faculty.length); return '<button type="button" class="btn btn-sm btn-outline-' + kind + '" ' + attribute + '="' + esc(id) + '" title="' + label + '" aria-label="' + label + '"' + (disabled ? ' disabled' : '') + '><span class="material-icons action-icon">' + icon + '</span></button>'; }
  function editableSlots(a) {
    return a.faculty_ids.map((id, index) => {
      var options = facultyOptions(id);
      if (id && !state.faculty.some(f => String(f.faculty_id) === String(id))) options += '<option selected value="' + esc(id) + '">' + esc(facultyName(id) || 'Unavailable faculty') + ' (inactive)</option>';
      return '<label class="faculty-slot"><span class="small text-muted">Faculty ' + (index + 1) + '</span><select class="form-select faculty-select" data-faculty-subject="' + esc(a.subject_id) + '" data-position="' + index + '" aria-label="Faculty ' + (index + 1) + ' for ' + esc(a.subject_code) + '">' + options + '</select></label>';
    }).join('');
  }
  function render() {
    var q = $('facultySearch').value.trim().toLowerCase();
    var rows = state.subjects.map(s => assignment(s)).filter(a => !q || (a.subject_code + ' ' + a.subject_name + ' ' + a.faculty_ids.map(facultyName).join(' ')).toLowerCase().includes(q));
    var assigned = state.subjects.filter(s => assignedFaculty(s).length).length;
    $('facultyTotalSubjects').textContent = state.subjects.length; $('facultyAssignedSubjects').textContent = assigned;
    $('facultyUnassignedSubjects').textContent = state.subjects.length - assigned;
    $('facultyTwoSubjects').textContent = state.subjects.filter(s => assignedFaculty(s).length > 1).length;
    $('saveFacultyAssignmentsBtn').disabled = !Object.keys(state.drafts).length;
    $('facultyTableBody').innerHTML = rows.map(a => {
      var editing = !!state.drafts[a.subject_id], ids = a.faculty_ids;
      var count = editing ? '<input type="number" min="1" max="' + Math.max(1, state.faculty.length, ids.length) + '" step="1" class="form-control faculty-count" data-faculty-count="' + esc(a.subject_id) + '" aria-label="Number of faculty for ' + esc(a.subject_code) + '" value="' + ids.length + '">' : '<span class="faculty-count-value">' + ids.length + '</span>';
      var controls = editing ? editableSlots(a) : ids.length ? '<ul class="faculty-names">' + ids.map(id => '<li>' + esc(facultyName(id) || 'Unavailable faculty') + '</li>').join('') + '</ul>' : '<span class="text-muted">Unassigned</span>';
      var actions = editing ? action('data-review-faculty', a.subject_id, 'check', 'Review assignment', 'success') + action('data-cancel-faculty', a.subject_id, 'close', 'Cancel changes', 'secondary') : action('data-edit-faculty', a.subject_id, 'edit', 'Edit faculty assignment', 'primary') + (assignedFaculty(state.subjects.find(s => String(s.subject_id) === String(a.subject_id))).length ? action('data-delete-faculty', a.subject_id, 'delete', 'Remove faculty assignment', 'danger') : '');
      return '<tr data-subject-row="' + esc(a.subject_id) + '" class="' + (editing ? 'faculty-editing' : '') + '"><td class="fw-semibold">' + esc(a.subject_code) + '</td><td>' + esc(a.subject_name) + '</td><td>' + count + '</td><td><div class="faculty-slots">' + controls + '</div><div class="small text-danger mt-1" data-assignment-error="' + esc(a.subject_id) + '" role="alert"></div></td><td><div class="faculty-actions">' + actions + '</div></td></tr>';
    }).join('');
    $('facultyEmpty').classList.toggle('d-none', rows.length > 0);
    $('facultyEmptyTitle').textContent = state.subjects.length ? 'No matching subjects.' : 'No subjects found for this session.';
    document.querySelector('#facultyDashboard .table-responsive').classList.toggle('d-none', !rows.length);
  }
  function facultyName(id) { var f = state.faculty.find(x => String(x.faculty_id) === String(id)) || state.subjects.flatMap(assignedFaculty).find(x => String(x.faculty_id) === String(id)); return f ? f.faculty_name : ''; }
  function collectAssignments(id) { return state.subjects.filter(s => state.drafts[s.subject_id] && (!id || String(s.subject_id) === String(id))).map(s => ({ subject_id: s.subject_id, faculty_ids: state.drafts[s.subject_id].slice() })); }
  function validateAssignments(rows) {
    if (!rows.length) return 'No assignment changes to save.';
    for (var row of rows) {
      if (!row.faculty_ids.length || row.faculty_ids.some(id => !id)) return 'Select a faculty member for every requested position.';
      if (new Set(row.faculty_ids.map(String)).size !== row.faculty_ids.length) return 'The same faculty member cannot be assigned twice to one subject.';
      if (row.faculty_ids.some(id => !state.faculty.some(f => String(f.faculty_id) === String(id)))) return 'Replace unavailable or inactive faculty before saving.';
    }
    return '';
  }
  function openConfirmation(subjectId) {
    var invalidCount = Array.from(document.querySelectorAll('[data-faculty-count].is-invalid')).some(control => !subjectId || control.dataset.facultyCount === String(subjectId));
    if (invalidCount) { toast('warning', 'Correct the faculty count before reviewing.'); return; }
    var rows = collectAssignments(subjectId), problem = validateAssignments(rows);
    if (problem) { toast('warning', problem); return; }
    state.facultyDraft = null; state.pending = rows;
    state.pendingScope = { batch_id: batch.value, exam_session_id: session.value };
    error('facultyConfirmError', ''); $('facultyConfirmTitle').textContent = subjectId ? 'Confirm Update Faculty Assignment' : 'Confirm Faculty Assignments';
    var context = '<div class="faculty-confirm-context"><strong>Batch:</strong> ' + esc(batchLabel(currentBatch())) + '<br><strong>Exam Session:</strong> ' + esc(sessionLabel(currentSession())) + '</div>';
    $('facultyConfirmSummary').innerHTML = context + rows.map(a => {
      var s = state.subjects.find(x => String(x.subject_id) === String(a.subject_id));
      return '<div class="faculty-confirm-item"><strong>' + esc(s.subject_code) + '</strong><span>' + esc(s.subject_name) + '</span><small>Faculty count: ' + a.faculty_ids.length + '</small>' + a.faculty_ids.map((id, i) => '<small>Faculty ' + (i + 1) + ': ' + esc(facultyName(id)) + '</small>').join('') + '</div>';
    }).join(''); modal('facultyConfirmModal', true);
  }
  function editRow(id) {
    if (!facultyLoaded || !state.faculty.length) return;
    var s = state.subjects.find(x => String(x.subject_id) === String(id)); if (!s) return;
    if (!state.drafts[id]) state.drafts[id] = assignedFaculty(s).map(f => String(f.faculty_id));
    if (!state.drafts[id].length) state.drafts[id].push('');
    render(); document.querySelector('[data-faculty-count="' + id + '"]').focus();
  }
  async function loadDepartments() { var request = ++departmentRequest; $('facultyDepartment').disabled = true; try { var j = await api('/faculty/api/departments'); if (request !== departmentRequest) return; var data = j.data || []; $('facultyDepartment').innerHTML = '<option value="">Select Department</option>' + data.map(d => '<option value="' + esc(d.department_id) + '">' + esc(d.department_name) + '</option>').join(''); var mca = data.find(d => String(d.department_code || '').trim().toUpperCase() === 'MCA'); $('facultyDepartment').value = mca ? String(mca.department_id) : ''; $('facultyDepartment').disabled = false; } catch (e) { if (request === departmentRequest) error('addFacultyError', e.message); } }
  function facultyDraft() { return { department_id: $('facultyDepartment').value, faculty_code: $('facultyCodeInput').value.trim().toUpperCase(), faculty_name: $('facultyNameInput').value.trim(), designation: $('facultyDesignationInput').value.trim() }; }
  function reviewFaculty(event) { event.preventDefault(); var draft = facultyDraft(); if (!draft.department_id || !draft.faculty_code || !draft.faculty_name) { error('addFacultyError', 'Department, faculty code, and faculty name are required.'); return; } error('addFacultyError', ''); state.facultyDraft = draft; state.pending = []; $('facultyConfirmTitle').textContent = 'Confirm Add Faculty'; $('facultyConfirmSummary').innerHTML = '<div class="faculty-confirm-item"><strong>' + esc(draft.faculty_name) + '</strong><span>' + esc(draft.faculty_code) + '</span><small>Department: ' + esc($('facultyDepartment').selectedOptions[0].textContent) + '</small><small>Designation: ' + esc(draft.designation || 'None') + '</small></div>'; modal('addFacultyModal', false); setTimeout(() => modal('facultyConfirmModal', true), 180); }
  function openFacultyForm() { $('addFacultyForm').reset(); error('addFacultyError', ''); modal('addFacultyModal', true); loadDepartments(); }
  async function confirmSave() {
    var button = $('facultyConfirmSaveBtn'); button.disabled = true; error('facultyConfirmError', '');
    try {
      if (state.facultyDraft) {
        await api('/faculty/api', { method: 'POST', body: JSON.stringify(state.facultyDraft) }); state.facultyDraft = null;
        modal('facultyConfirmModal', false); toast('success', 'Faculty added successfully.'); await loadFaculty();
      } else {
        if (!state.pending.length || state.pendingScope.batch_id !== batch.value || state.pendingScope.exam_session_id !== session.value) throw new Error('The selected batch or session changed. Review the assignments again.');
        var saved = state.pending.slice();
        await api('/faculty/api/assignments', { method: 'PUT', body: JSON.stringify({ ...state.pendingScope, assignments: saved }) });
        saved.forEach(row => { delete state.drafts[row.subject_id]; }); state.pending = [];
        modal('facultyConfirmModal', false); toast('success', 'Faculty assignments saved successfully.'); await loadSubjects(true);
      }
    } catch (e) { error('facultyConfirmError', e.message); } finally { button.disabled = false; }
  }
  function removeTargetLabel() { return state.removeTarget ? 'Remove Faculty ' + state.removeTarget.position : 'Remove Assignment'; }
  function renderRemoveSummary() { var subject = state.removing; if (!subject) return; var a = assignment(subject, true); var context = '<div class="faculty-confirm-context"><strong>Subject:</strong> ' + esc(a.subject_code + ' - ' + a.subject_name) + '<br><strong>Batch:</strong> ' + esc(batchLabel(currentBatch())) + '<br><strong>Exam Session:</strong> ' + esc(sessionLabel(currentSession())) + '</div>'; var items = a.faculty_ids.map(function (id, index) { var position = index + 1; var selected = !!state.removeTarget && String(state.removeTarget.faculty_id) === String(id); return '<div class="faculty-confirm-item' + (selected ? ' faculty-remove-selected' : '') + '"><strong>Faculty ' + position + ':</strong><span>' + esc(facultyName(id) || 'None') + '</span><button type="button" class="btn btn-sm btn-outline-danger faculty-remove-one" data-remove-faculty="' + esc(id) + '" data-remove-position="' + position + '">Remove Faculty ' + position + '</button></div>'; }).join(''); $('facultyRemoveSummary').innerHTML = context + items; $('facultyRemoveQuestion').textContent = state.removeTarget ? 'Are you sure you want to remove Faculty ' + state.removeTarget.position + ' (' + (facultyName(state.removeTarget.faculty_id) || 'Unassigned') + ') from this subject?' : 'Are you sure you want to remove all faculty assignments from this subject?'; $('facultyRemoveBtn').textContent = removeTargetLabel(); }
  function selectRemoveTarget(facultyId, position) { state.removeTarget = state.removeTarget && String(state.removeTarget.faculty_id) === String(facultyId) ? null : { faculty_id: facultyId, position: Number(position) }; error('facultyRemoveError', ''); renderRemoveSummary(); }
  function openRemove(subjectId) { var subject = state.subjects.find(x => String(x.subject_id) === String(subjectId)); if (!subject) return; if (!assignedFaculty(subject).length) { toast('warning', 'This subject has no faculty assigned to remove.'); return; } state.removing = subject; state.removeTarget = null; error('facultyRemoveError', ''); $('facultyRemoveBtn').disabled = false; renderRemoveSummary(); modal('facultyRemoveModal', true); }
  function closeRemove() { state.removing = null; state.removeTarget = null; error('facultyRemoveError', ''); var button = $('facultyRemoveBtn'); button.disabled = false; button.textContent = 'Remove Assignment'; }
  async function confirmRemove() { if (!state.removing) return; var button = $('facultyRemoveBtn'), subjectId = state.removing.subject_id, target = state.removeTarget; var url = '/faculty/api/assignments/' + encodeURIComponent(subjectId) + (target ? '/faculty/' + encodeURIComponent(target.faculty_id) : ''); button.disabled = true; button.textContent = 'Removing Assignment...'; error('facultyRemoveError', ''); try { await api(url, { method: 'DELETE' }); state.removing = null; state.removeTarget = null; modal('facultyRemoveModal', false); toast('success', 'Faculty assignment removed successfully.'); delete state.drafts[subjectId]; await loadSubjects(true); } catch (e) { error('facultyRemoveError', e.message); } finally { button.disabled = false; button.textContent = removeTargetLabel(); } }

  $('addFacultyBtn').addEventListener('click', openFacultyForm); $('addAssignmentFacultyBtn').addEventListener('click', openFacultyForm); $('addFacultyForm').addEventListener('submit', reviewFaculty);
  document.addEventListener('faculty-status-changed', loadFaculty);
  batch.addEventListener('change', loadSessions); session.addEventListener('change', () => loadSubjects()); $('facultySearch').addEventListener('input', render);
  $('saveFacultyAssignmentsBtn').addEventListener('click', () => openConfirmation()); $('facultyConfirmSaveBtn').addEventListener('click', confirmSave);
  function updateFacultyCount(e) {
    var countId = e.target.dataset.facultyCount;
    if (countId) {
      var count = Number(e.target.value), maximum = Number(e.target.max);
      if (!Number.isInteger(count) || count < 1 || count > maximum) {
        e.target.classList.add('is-invalid');
        e.target.setAttribute('aria-invalid', 'true');
        document.querySelector('[data-assignment-error="' + countId + '"]').textContent = 'Choose a faculty count between 1 and ' + maximum + '.';
        return;
      }
      var ids = state.drafts[countId]; ids.length = count;
      state.drafts[countId] = Array.from(ids, id => id || '');
      e.target.classList.remove('is-invalid');
      e.target.setAttribute('aria-invalid', 'false');
      var row = document.querySelector('[data-subject-row="' + countId + '"]');
      row.querySelector('.faculty-slots').innerHTML = editableSlots(assignment(state.subjects.find(s => String(s.subject_id) === countId)));
      row.querySelector('[data-assignment-error]').textContent = '';
    }
  }
  $('facultyTableBody').addEventListener('input', updateFacultyCount);
  $('facultyTableBody').addEventListener('change', function (e) {
    updateFacultyCount(e);
    if (e.target.classList.contains('faculty-select')) {
      var id = e.target.dataset.facultySubject;
      state.drafts[id][Number(e.target.dataset.position)] = e.target.value;
      var ids = state.drafts[id], duplicate = ids.filter(Boolean).length !== new Set(ids.filter(Boolean)).size;
      getSelects({ subject_id: id }).forEach(control => { control.classList.toggle('is-invalid', duplicate); control.setAttribute('aria-invalid', String(duplicate)); });
      document.querySelector('[data-assignment-error="' + id + '"]').textContent = duplicate ? 'Select different faculty members for this subject.' : '';
    }
  });
  $('facultyTableBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-edit-faculty]'); if (b) editRow(b.dataset.editFaculty);
    var review = e.target.closest('[data-review-faculty]'); if (review) openConfirmation(review.dataset.reviewFaculty);
    var cancel = e.target.closest('[data-cancel-faculty]'); if (cancel) { delete state.drafts[cancel.dataset.cancelFaculty]; render(); }
    var d = e.target.closest('[data-delete-faculty]'); if (d) openRemove(d.dataset.deleteFaculty);
  });
  $('facultyRemoveBtn').addEventListener('click', confirmRemove); $('facultyRemoveModal').addEventListener('hidden.bs.modal', closeRemove); $('facultyRemoveSummary').addEventListener('click', function (e) { var b = e.target.closest('[data-remove-faculty]'); if (b) selectRemoveTarget(b.dataset.removeFaculty, b.dataset.removePosition); }); loadBatches(); loadFaculty();
  function assignedFaculty(subject) { return subject.Faculties || subject.Faculty || []; }
  function assignment(subject, savedOnly) { return { subject_id: subject.subject_id, subject_code: subject.subject_code, subject_name: subject.subject_name, faculty_ids: (!savedOnly && state.drafts[subject.subject_id]) || assignedFaculty(subject).map(f => String(f.faculty_id)) }; }
  function reset() { state.subjects = []; state.drafts = {}; state.pending = []; $('facultyDashboard').classList.add('d-none'); $('facultyPrompt').classList.remove('d-none'); $('saveFacultyAssignmentsBtn').disabled = true; }
  async function loadBatches() { try { var j = await api('/batches?format=json'); const json = Array.isArray(j) ? j : (j.data || []); state.batches = AcademicFormOptions.sortBatches(json); batch.innerHTML = '<option value="">Select Batch</option>' + state.batches.map(b => '<option value="' + esc(b.batch_id) + '">' + esc(batchLabel(b)) + '</option>').join(''); batch.disabled = !state.batches.length; batch.value = state.batches.length ? String(state.batches[0].batch_id) : ''; await loadSessions(); } catch (e) { batch.innerHTML = '<option value="">Unable to load batches</option>'; error('facultySelectionError', e.message); } }
  async function loadSessions() { var request = ++sessionRequest, selected = batch.value; subjectRequest++; state.sessions = []; session.disabled = true; reset(); if (!selected) { session.innerHTML = '<option value="">Select Batch first</option>'; return; } session.innerHTML = '<option value="">Loading sessions...</option>'; try { var j = await api('/exam-sessions?format=json&batch_id=' + encodeURIComponent(selected)); if (request !== sessionRequest || selected !== batch.value) return; const json = Array.isArray(j) ? j : (j.data || []); state.sessions = json; session.innerHTML = '<option value="">Select Exam Session</option>' + state.sessions.map(s => '<option value="' + esc(s.exam_session_id) + '">' + esc(sessionLabel(s)) + '</option>').join(''); session.disabled = false; } catch (e) { if (request === sessionRequest) error('facultySelectionError', e.message); } }
  async function loadFaculty() { try { var j = await api('/faculty/api'); const json = Array.isArray(j) ? j : (j.data || []); state.faculty = json; facultyLoaded = true; $('facultyAvailabilityNotice').classList.toggle('d-none', state.faculty.length > 0); if (state.subjects.length) render(); } catch (e) { error('facultySelectionError', e.message); toast('danger', e.message); } }
  async function loadSubjects(preserveDrafts) { var request = ++subjectRequest, selected = session.value; if (!preserveDrafts) { state.drafts = {}; state.pending = []; } state.subjects = []; $('saveFacultyAssignmentsBtn').disabled = true; error('facultySelectionError', ''); if (!batch.value || !selected) return reset(); $('facultyPrompt').classList.add('d-none'); $('facultyDashboard').classList.remove('d-none'); $('facultySubjectsTitle').textContent = 'Subjects for ' + sessionLabel(currentSession()); var tbody = $('facultyTableBody'); tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><span class="spinner-border spinner-border-sm text-primary me-2"></span>Loading subjects...</td></tr>'; try { var j = await api('/subjects/session/' + encodeURIComponent(selected)); if (request !== subjectRequest || selected !== session.value) return; const json = Array.isArray(j) ? j : (j.data || []); state.subjects = json; render(); } catch (e) { if (request !== subjectRequest) return; error('facultySelectionError', e.message); toast('danger', e.message); } }
});

