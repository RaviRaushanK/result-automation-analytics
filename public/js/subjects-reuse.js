document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  const $ = id => document.getElementById(id), button = $('reuseSubjectsBtn');
  if (!button) return;
  const batch = $('subjectBatchSelect'), session = $('subjectSessionSelect'), modal = $('reuseSubjectsModal');
  const rows = $('reuseSubjectsRows'), all = $('reuseSubjectsAll'), save = $('reuseSubjectsSave');
  let version = 0, snapshot = null, target = null, busy = false;
  const selected = () => Array.from(rows.querySelectorAll('input[data-course-id]:checked')).map(input => input.dataset.courseId);
  const choices = () => Array.from(rows.querySelectorAll('input[data-course-id]:not(:disabled)'));
  function message(text) { $('reuseSubjectsError').textContent = text || ''; $('reuseSubjectsError').classList.toggle('d-none', !text); }
  function count() {
    const chosen = selected().length, available = choices().length;
    save.disabled = busy || !snapshot || !chosen;
    all.disabled = busy || !snapshot || !available;
    all.checked = chosen > 0 && chosen === available; all.indeterminate = chosen > 0 && chosen < available;
    $('reuseSubjectsCount').textContent = chosen ? chosen + ' subject(s) selected.' : 'No subjects selected.';
  }
  function available() { button.disabled = !batch.value || !session.value || session.disabled; }
  function reset() { version++; snapshot = null; target = null; all.checked = false; all.indeterminate = false; count(); available(); }
  async function api(url, options) {
    const response = await fetch(url, Object.assign({ headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }, options));
    const json = await response.json();
    if (!response.ok) { const error = new Error(json.message || 'The request could not be completed.'); error.status = response.status; throw error; }
    return json;
  }
  function cell(row, value) { const td = document.createElement('td'); td.textContent = String(value ?? ''); row.appendChild(td); return td; }
  function placeholder(text) { rows.replaceChildren(); const tr = document.createElement('tr'); const td = cell(tr, text); td.colSpan = 8; rows.appendChild(tr); }
  async function open() {
    const request = ++version, sessionId = session.value, batchId = batch.value;
    if (!sessionId || !batchId) return;
    snapshot = null; target = null; message(''); placeholder('Loading existing semester subjects...'); count();
    $('reuseSubjectsScope').textContent = batch.selectedOptions[0].textContent + ' | ' + session.selectedOptions[0].textContent;
    bootstrap.Modal.getOrCreateInstance(modal).show();
    try {
      const data = await api('/subjects/session/' + encodeURIComponent(sessionId) + '/reusable?batch_id=' + encodeURIComponent(batchId));
      if (request !== version || sessionId !== session.value || batchId !== batch.value) return;
      snapshot = data.snapshot; target = { sessionId, batchId, label: data.session.label }; rows.replaceChildren();
      data.courses.forEach(course => {
        const tr = document.createElement('tr'), td = cell(tr, ''), input = document.createElement('input');
        input.type = 'checkbox'; input.className = 'form-check-input'; input.dataset.courseId = String(course.course_id);
        input.disabled = course.already_added; input.setAttribute('aria-label', 'Use ' + course.subject_code + ' - ' + course.subject_name);
        input.addEventListener('change', count); td.appendChild(input);
        cell(tr, course.subject_code).className = 'reuse-subject-code';
        cell(tr, course.subject_name).className = 'reuse-subject-name';
        [course.credits, course.max_internal, course.max_external, course.max_marks].forEach(value => { cell(tr, value).className = 'reuse-subject-number'; });
        const status = document.createElement('span'); status.className = 'reuse-availability' + (course.already_added ? ' is-added' : '');
        status.textContent = course.already_added ? 'Already added' : 'Available'; cell(tr, '').appendChild(status);
        rows.appendChild(tr);
      });
      if (!data.courses.length) placeholder('No existing courses are configured for this batch and semester. Use Create Subject to define them.');
      count();
    } catch (error) { if (request === version) { placeholder('Existing subjects could not be loaded.'); message(error.message); count(); } }
  }
  button.addEventListener('click', open); $('reuseSubjectsReload').addEventListener('click', open);
  all.addEventListener('change', function () { choices().forEach(input => { input.checked = all.checked; }); count(); });
  save.addEventListener('click', async function () {
    if (!snapshot || !target || !selected().length || busy) return;
    const current = target, payload = { batch_id: current.batchId, course_ids: selected(), snapshot };
    busy = true; count(); message('');
    try {
      const data = await api('/subjects/session/' + encodeURIComponent(current.sessionId) + '/reuse', { method: 'POST', body: JSON.stringify(payload) });
      bootstrap.Modal.getOrCreateInstance(modal).hide();
      const notice = document.createElement('div'); notice.className = 'alert alert-success alert-dismissible fade show'; notice.setAttribute('role', 'status');
      const text = document.createElement('span'); text.textContent = data.count + ' existing subject(s) added to ' + current.label + '.'; notice.appendChild(text);
      const close = document.createElement('button'); close.type = 'button'; close.className = 'btn-close';
      close.setAttribute('data-bs-dismiss', 'alert'); close.setAttribute('aria-label', 'Dismiss notification'); notice.appendChild(close);
      $('subjectsToastContainer').replaceChildren(notice);
      setTimeout(() => { if (notice.isConnected) bootstrap.Alert.getOrCreateInstance(notice).close(); }, 5000);
      if (session.value === current.sessionId && batch.value === current.batchId) session.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) { message(error.message); if (error.status === 409) snapshot = null; }
    finally { busy = false; count(); }
  });
  [batch, session].forEach(control => control.addEventListener('change', function () { reset(); bootstrap.Modal.getOrCreateInstance(modal).hide(); }));
  modal.addEventListener('hidden.bs.modal', reset);
  available();
});
