/* Student Management Dashboard — list, search, filters, modals, import. */
document.addEventListener('DOMContentLoaded', function () {
  var tbody = document.querySelector('#studentsTable tbody');
  var searchInput = document.getElementById('studentSearch');
  var batchSelect = document.getElementById('filterBatch');
  var categorySelect = document.getElementById('filterCategory');
  var statusSelect = document.getElementById('filterStatus');
  var resetBtn = document.getElementById('resetStudentFilterBtn');
  var addBtn = document.getElementById('addStudentBtn');
  var importBtn = document.getElementById('importStudentsBtn');
  var batchesEl = document.getElementById('batchesData');
  var batches = [];
  try { batches = JSON.parse((batchesEl && batchesEl.dataset.batches) || '[]'); } catch (e) { batches = []; }

  var formModal = new bootstrap.Modal(document.getElementById('studentFormModal'));
  var confirmModal = new bootstrap.Modal(document.getElementById('studentConfirmModal'));
  var importModal = new bootstrap.Modal(document.getElementById('importModal'));
  var resultModal = new bootstrap.Modal(document.getElementById('importResultModal'));
  var pendingAction = null;
  var importRows = [];

  function batchName(id, fallback) {
    var hit = batches.find(function (b) { return String(b.id) === String(id); });
    return hit ? hit.name : (fallback || id || '--');
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  async function api(url, opts) {
    var res = await fetch(url, opts);
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error((json && json.message) || ('Request failed: ' + res.status));
    return json;
  }
  function toast(type, text) {
    var container = document.querySelector('.alert-container');
    if (!container) { alert(text); return; }
    var div = document.createElement('div');
    div.className = 'alert alert-' + type + ' alert-dismissible fade show';
    div.setAttribute('role', 'alert');
    div.innerHTML = esc(text) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    container.appendChild(div);
    setTimeout(function () { try { bootstrap.Alert.getOrCreateInstance(div).close(); } catch (e) { div.remove(); } }, 5000);
  }


  function rowHtml(s) {
    var batch = (s.Batch && s.Batch.batch_name) || batchName(s.batch_id, '');
    var statusCls = s.status === 'active' ? 'badge-active' : 'badge-inactive';
    return '<tr>' +
      '<td>' + esc(s.student_id) + '</td>' +
      '<td>' + esc(s.usn) + '</td>' +
      '<td>' + esc(s.student_name) + '</td>' +
      '<td>' + esc(s.email || '--') + '</td>' +
      '<td>' + esc(batch) + '</td>' +
      '<td><span class="badge-status badge-category">' + esc(s.category || '--') + '</span></td>' +
      '<td><span class="badge-status ' + statusCls + '">' + esc(s.status) + '</span></td>' +
      '<td><div class="students-actions">' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="edit" data-id="' + s.student_id + '">Edit</button>' +
      '<button type="button" class="btn btn-sm btn-outline-danger" data-act="delete" data-id="' + s.student_id + '">Delete</button>' +
      '</div></td></tr>';
  }

  async function loadStudents() {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center table-loading">' +
      '<div class="spinner-border spinner-border-sm text-primary" role="status"></div>' +
      '<span class="ms-2 text-muted">Loading students...</span></td></tr>';
    try {
      var params = new URLSearchParams();
      if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
      if (batchSelect.value) params.set('batch_id', batchSelect.value);
      if (categorySelect.value) params.set('category', categorySelect.value);
      if (statusSelect.value) params.set('status', statusSelect.value);
      var qs = params.toString();
      var json = await api('/students/api/list' + (qs ? '?' + qs : ''));
      var rows = (json.data || []);
      tbody.innerHTML = rows.length ? rows.map(rowHtml).join('')
        : '<tr><td colspan="8" class="text-center text-muted">No students found.</td></tr>';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">' + esc(e.message) + '</td></tr>';
    }
  }

  async function loadStats() {
    try {
      var json = await api('/students/api/stats');
      var d = json.data || {};
      document.getElementById('statTotal').textContent = d.total != null ? d.total : '--';
      document.getElementById('statActive').textContent = d.active != null ? d.active : '--';
      document.getElementById('statInactive').textContent = d.inactive != null ? d.inactive : '--';
      document.getElementById('statPgcet').textContent = d.pgcet != null ? d.pgcet : '--';
      document.getElementById('statMgt').textContent = d.mgt != null ? d.mgt : '--';
    } catch (e) { /* keep placeholders */ }
  }
  function reloadAll() { loadStudents(); loadStats(); }

  var debounce;
  searchInput.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(loadStudents, 300);
  });
  [batchSelect, categorySelect, statusSelect].forEach(function (el) {
    el.addEventListener('change', loadStudents);
  });
  resetBtn.addEventListener('click', function () {
    searchInput.value = '';
    batchSelect.value = '';
    categorySelect.value = '';
    statusSelect.value = '';
    loadStudents();
  });

  function formValues() {
    return {
      batch_id: document.getElementById('studentBatch').value,
      usn: document.getElementById('studentUsn').value.trim(),
      student_name: document.getElementById('studentName').value.trim(),
      email: document.getElementById('studentEmail').value.trim(),
      category: document.getElementById('studentCategory').value.trim().toUpperCase(),
      status: document.getElementById('studentStatus').value
    };
  }
  function showFormError(msg) {
    var el = document.getElementById('studentFormError');
    if (!msg) { el.classList.add('d-none'); el.textContent = ''; return; }
    el.classList.remove('d-none');
    el.textContent = msg;
  }
  addBtn.addEventListener('click', function () {
    document.getElementById('studentFormTitle').textContent = 'Add Student';
    document.getElementById('studentId').value = '';
    document.getElementById('studentForm').reset();
    document.getElementById('studentStatus').value = 'active';
    showFormError('');
    formModal.show();
  });

  tbody.addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    if (btn.getAttribute('data-act') === 'edit') {
      try {
        var json = await api('/students/api/' + id);
        var s = json.data;
        document.getElementById('studentFormTitle').textContent = 'Edit Student';
        document.getElementById('studentId').value = s.student_id;
        document.getElementById('studentBatch').value = s.batch_id;
        document.getElementById('studentUsn').value = s.usn || '';
        document.getElementById('studentName').value = s.student_name || '';
        document.getElementById('studentEmail').value = s.email || '';
        document.getElementById('studentCategory').value = s.category || '';
        document.getElementById('studentStatus').value = s.status || 'active';
        showFormError('');
        formModal.show();
      } catch (err) { toast('danger', err.message); }
    } else if (btn.getAttribute('data-act') === 'delete') {
      try {
        var one = await api('/students/api/' + id);
        askDelete(one.data);
      } catch (err) { toast('danger', err.message); }
    }
  });

  function confirmDetails(pairs) {
    document.getElementById('studentConfirmDetails').innerHTML = pairs.map(function (p) {
      return '<dt class="col-sm-4">' + esc(p[0]) + '</dt><dd class="col-sm-8">' + esc(p[1] || '--') + '</dd>';
    }).join('');
  }

  function askCreateOrUpdate(values, isEdit) {
    document.getElementById('studentConfirmTitle').textContent = isEdit ? 'Confirm Changes' : 'Confirm New Student';
    document.getElementById('studentConfirmText').textContent = isEdit
      ? 'Are you sure you want to save these changes to this student?'
      : 'Are you sure you want to add this student?';
    var cb = document.getElementById('studentConfirmBtn');
    cb.textContent = isEdit ? 'Save Changes' : 'Add Student';
    cb.className = 'btn btn-primary';
    confirmDetails([
      ['Batch', batchName(values.batch_id, values.batch_id)],
      ['USN', values.usn], ['Student Name', values.student_name],
      ['Email', values.email], ['Category', values.category], ['Status', values.status]
    ]);
    pendingAction = function () { return isEdit ? doUpdate(values) : doCreate(values); };
    formModal.hide();
    confirmModal.show();
  }
  function askDelete(s) {
    document.getElementById('studentConfirmTitle').textContent = 'Delete Student';
    document.getElementById('studentConfirmText').textContent = 'Are you sure you want to delete this student?';
    var cb = document.getElementById('studentConfirmBtn');
    cb.textContent = 'Delete';
    cb.className = 'btn btn-danger';
    confirmDetails([['Student Name', s.student_name], ['USN', s.usn], ['Category', s.category || '--']]);
    pendingAction = function () { return doDelete(s.student_id); };
    confirmModal.show();
  }
  document.getElementById('studentFormNextBtn').addEventListener('click', function () {
    var values = formValues();
    if (!values.batch_id) return showFormError('Batch is required');
    if (!values.usn) return showFormError('USN is required');
    if (!values.student_name) return showFormError('Student Name is required');
    if (!values.category) return showFormError('Category is required');
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return showFormError('Email is invalid');
    showFormError('');
    askCreateOrUpdate(values, Boolean(document.getElementById('studentId').value));
  });
  document.getElementById('studentConfirmBtn').addEventListener('click', async function () {
    var fn = pendingAction;
    pendingAction = null;
    confirmModal.hide();
    if (fn) await fn();
  });
  async function doCreate(values) {
    try {
      await api('/students/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      toast('success', 'Student created successfully');
      reloadAll();
    } catch (e) { toast('danger', e.message); }
  }
  async function doUpdate(values) {
    var id = document.getElementById('studentId').value;
    try {
      await api('/students/api/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      toast('success', 'Student updated successfully');
      reloadAll();
    } catch (e) { toast('danger', e.message); }
  }
  async function doDelete(id) {
    try {
      await api('/students/api/' + id, { method: 'DELETE' });
      toast('success', 'Student deleted successfully');
      reloadAll();
    } catch (e) { toast('danger', e.message); }
  }

  importBtn.addEventListener('click', function () {
    document.getElementById('importFile').value = '';
    hideImportError();
    document.getElementById('importSummary').classList.add('d-none');
    document.getElementById('importPreviewWrap').classList.add('d-none');
    document.getElementById('importConfirmBtn').classList.add('d-none');
    importRows = [];
    importModal.show();
  });
  function hideImportError() {
    var el = document.getElementById('importError');
    el.classList.add('d-none');
    el.textContent = '';
  }
  function showImportError(msg) {
    var el = document.getElementById('importError');
    el.classList.remove('d-none');
    el.textContent = msg;
  }
  document.getElementById('importParseBtn').addEventListener('click', async function () {
    hideImportError();
    var file = document.getElementById('importFile').files[0];
    if (!file) return showImportError('Please choose an .xlsx, .xls or .csv file');
    var fd = new FormData();
    fd.append('file', file);
    try {
      var res = await fetch('/students/api/import/preview', { method: 'POST', body: fd });
      var json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Parse failed');
      importRows = json.data.rows || [];
      document.getElementById('importTotal').textContent = json.data.total;
      document.getElementById('importValid').textContent = json.data.valid;
      document.getElementById('importInvalid').textContent = json.data.invalid;
      document.getElementById('importSummary').classList.remove('d-none');
      var body = document.querySelector('#importPreviewTable tbody');
      body.innerHTML = importRows.map(function (r) {
        return '<tr><td>' + r.row + '</td><td>' + esc(r.batch || batchName(r.batch_id, '')) + '</td>' +
          '<td>' + esc(r.usn) + '</td><td>' + esc(r.student_name) + '</td>' +
          '<td>' + esc(r.email) + '</td><td>' + esc(r.category) + '</td><td>' + esc(r.status) + '</td>' +
          '<td><span class="badge-status ' + (r.valid ? 'badge-valid' : 'badge-invalid') + '">' + esc(r.message) + '</span></td></tr>';
      }).join('');
      document.getElementById('importPreviewWrap').classList.remove('d-none');
      var cbtn = document.getElementById('importConfirmBtn');
      if (json.data.valid > 0) {
        cbtn.classList.remove('d-none');
        cbtn.textContent = 'Confirm Import (' + json.data.valid + ' valid)';
      } else { cbtn.classList.add('d-none'); }
    } catch (e) { showImportError(e.message); }
  });
  document.getElementById('importConfirmBtn').addEventListener('click', function () {
    var valid = importRows.filter(function (r) { return r.valid; }).length;
    var invalid = importRows.length - valid;
    document.getElementById('studentConfirmTitle').textContent = 'Confirm Import';
    document.getElementById('studentConfirmText').textContent =
      'Student Import — Total Records: ' + importRows.length + ', Valid Records: ' + valid +
      ', Invalid Records: ' + invalid + '. Are you sure you want to import the ' + valid + ' valid records?';
    var cb = document.getElementById('studentConfirmBtn');
    cb.textContent = 'Confirm Import';
    cb.className = 'btn btn-primary';
    confirmDetails([[ 'Total Records', String(importRows.length)], ['Valid Records', String(valid)], ['Invalid Records', String(invalid)]]);
    pendingAction = doImport;
    importModal.hide();
    confirmModal.show();
  });
  async function doImport() {
    try {
      var json = await api('/students/api/import/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importRows })
      });
      document.getElementById('importResultOk').textContent = json.data.imported;
      document.getElementById('importResultSkipped').textContent = json.data.skipped;
      document.getElementById('importResultReasons').innerHTML =
        (json.data.skippedRows || []).map(function (s) {
          return '<li>Row ' + esc(s.row) + ' (' + esc(s.usn || '--') + '): ' + esc(s.reason) + '</li>';
        }).join('') || '<li>All valid records imported.</li>';
      resultModal.show();
      toast('success', json.message);
      reloadAll();
    } catch (e) { toast('danger', e.message); }
  }

  reloadAll();
});



