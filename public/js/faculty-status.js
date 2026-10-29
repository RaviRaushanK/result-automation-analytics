(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var page = document.querySelector('[data-faculty-page]');
    if (!page) return;
    var $ = id => document.getElementById(id);
    var rows = [], pending = null, saving = false, requestId = 0;
    var dialog = $('facultyRegistryModal');
    function message(id, text) { $(id).textContent = text || ''; $(id).classList.toggle('d-none', !text); }
    function escape(value) { var element = document.createElement('span'); element.textContent = value == null ? '' : String(value); return element.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    async function api(url, options) {
      var response = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, options));
      var json = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(json.message || 'Unable to complete this request. Please try again.'), { status: response.status });
      return json;
    }
    function render() {
      var search = $('facultyRegistrySearch').value.trim().toLowerCase(), status = $('facultyRegistryFilter').value;
      var visible = rows.filter(row => (status === 'all' || row.status === status) && (row.faculty_name + ' ' + row.faculty_code).toLowerCase().includes(search));
      $('facultyRegistryRows').innerHTML = visible.map(row => {
        var active = row.status === 'active';
        return '<tr><td>' + escape(row.faculty_name) + '</td><td>' + escape(row.faculty_code) + '</td><td><span class="badge text-bg-' + (active ? 'success' : 'secondary') + '">' + (active ? 'Active' : 'Inactive') + '</span></td><td><button type="button" class="btn btn-sm btn-outline-' + (active ? 'danger' : 'success') + '" data-faculty-status-id="' + escape(row.faculty_id) + '" aria-label="' + (active ? 'Deactivate ' : 'Activate ') + escape(row.faculty_name) + '">' + (active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
      }).join('');
      $('facultyRegistryEmpty').classList.toggle('d-none', visible.length > 0);
    }
    function showList() {
      pending = null; $('facultyRegistryTitle').textContent = 'Manage Faculty';
      $('facultyRegistryList').classList.remove('d-none'); $('facultyStatusConfirmation').classList.add('d-none');
      $('facultyStatusCancelBtn').hidden = true; $('facultyStatusConfirmBtn').hidden = true;
      $('facultyRegistryCloseBtn').hidden = false;
    }
    async function load() {
      var current = ++requestId;
      rows = []; render(); $('facultyRegistryEmpty').classList.add('d-none'); $('facultyRegistryLoading').hidden = false;
      try { var json = await api('/faculty/api/registry'); if (current !== requestId) return; rows = json.data; render(); }
      catch (error) { if (current === requestId) message('facultyRegistryError', error.message); }
      finally { if (current === requestId) $('facultyRegistryLoading').hidden = true; }
    }
    $('manageFacultyBtn').addEventListener('click', function () {
      showList(); message('facultyRegistryError', ''); message('facultyRegistryNotice', '');
      bootstrap.Modal.getOrCreateInstance(dialog).show(); load();
    });
    $('facultyRegistrySearch').addEventListener('input', render); $('facultyRegistryFilter').addEventListener('change', render);
    $('facultyRegistryRows').addEventListener('click', function (event) {
      var button = event.target.closest('[data-faculty-status-id]'); if (!button || saving) return;
      var row = rows.find(item => String(item.faculty_id) === button.dataset.facultyStatusId); if (!row) return;
      pending = { id: String(row.faculty_id), expectedStatus: row.status, status: row.status === 'active' ? 'inactive' : 'active' };
      var deactivate = pending.status === 'inactive';
      message('facultyRegistryError', ''); message('facultyRegistryNotice', '');
      $('facultyRegistryTitle').textContent = deactivate ? 'Deactivate faculty?' : 'Activate faculty?';
      $('facultyStatusIdentity').textContent = row.faculty_name + ' (' + row.faculty_code + ')';
      $('facultyStatusExplanation').textContent = deactivate ? 'This faculty member will not be able to sign in. Existing sessions will be blocked on the next request. Previous assignments and reports will remain unchanged.' : 'This restores faculty eligibility for system access and new teaching assignments. Their registered login account must also be active; separate account restrictions remain unchanged.';
      $('facultyRegistryList').classList.add('d-none'); $('facultyStatusConfirmation').classList.remove('d-none');
      $('facultyStatusCancelBtn').hidden = false; $('facultyStatusConfirmBtn').hidden = false; $('facultyRegistryCloseBtn').hidden = true;
      $('facultyStatusConfirmBtn').textContent = deactivate ? 'Deactivate Faculty' : 'Activate Faculty';
      $('facultyStatusConfirmBtn').className = 'btn ' + (deactivate ? 'btn-danger' : 'btn-success');
      $('facultyStatusCancelBtn').focus();
    });
    $('facultyStatusCancelBtn').addEventListener('click', function () { if (!saving) { showList(); $('facultyRegistrySearch').focus(); } });
    $('facultyStatusConfirmBtn').addEventListener('click', async function () {
      if (!pending || saving) return;
      saving = true; $('facultyStatusConfirmBtn').disabled = true; $('facultyStatusCancelBtn').disabled = true;
      var action = pending;
      try {
        var json = await api('/faculty/api/' + encodeURIComponent(action.id) + '/status', {
          method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': page.dataset.csrfToken },
          body: JSON.stringify({ status: action.status, expectedStatus: action.expectedStatus })
        });
        rows = rows.map(row => String(row.faculty_id) === action.id ? json.data : row);
        showList(); render(); message('facultyRegistryNotice', json.message);
        document.dispatchEvent(new CustomEvent('faculty-status-changed'));
      } catch (error) {
        if (error.status === 409 || error.status === 404) { showList(); await load(); }
        message('facultyRegistryError', error.message);
      } finally { saving = false; $('facultyStatusConfirmBtn').disabled = false; $('facultyStatusCancelBtn').disabled = false; }
    });
    dialog.addEventListener('hide.bs.modal', function (event) { if (saving) event.preventDefault(); });
    dialog.addEventListener('hidden.bs.modal', function () { requestId++; showList(); });
  });
})();
