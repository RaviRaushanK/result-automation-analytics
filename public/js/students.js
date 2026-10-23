/* Student Management Dashboard — list, search, filters, modals, import. */
document.addEventListener('DOMContentLoaded', function () {
  var tbody = document.querySelector('#studentsTable tbody');
  var searchInput = document.getElementById('studentSearch');
  var batchSelect = document.getElementById('filterBatch');
  var listing = document.getElementById('studentListing');
  var defaultBatch = listing.dataset.defaultBatch;
  var pagination = JSON.parse(listing.dataset.pagination);
  var page = pagination.page;
  var pageSize = document.getElementById('studentPageSize');
  var previous = document.getElementById('studentPrevPage');
  var next = document.getElementById('studentNextPage');
  var count = document.getElementById('studentResultCount');
  var pageInfo = document.getElementById('studentPageInfo');
  var loading = document.getElementById('studentSearchLoading');
  var searchError = document.getElementById('studentSearchError');
  var clearSearch = document.getElementById('clearStudentSearch');
  var requestVersion = 0, requestController, statsVersion = 0, statsController, categoriesVersion = 0;
  var debounce;
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
    var container = document.getElementById('studentMessages');
    var div = document.createElement('div');
    div.className = 'alert alert-' + type + ' alert-dismissible fade show';
    div.setAttribute('role', 'alert');
    div.innerHTML = esc(text) + '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>';
    container.appendChild(div);
    if (type === 'success') {
      setTimeout(function () { try { bootstrap.Alert.getOrCreateInstance(div).close(); } catch (e) { div.remove(); } }, 5000);
    }
  }


  function rowHtml(s, index) {
    var batch = (s.Batch && s.Batch.batch_name) || batchName(s.batch_id, '');
    var statusCls = s.status === 'active' ? 'badge-active' : 'badge-inactive';
    return '<tr>' +
      '<td>' + ((pagination.page - 1) * pagination.pageSize + index + 1) + '</td>' +
      '<td>' + esc(s.usn) + '</td>' +
      '<td>' + esc(s.student_name) + '</td>' +
      '<td>' + esc(s.email || '--') + '</td>' +
      '<td>' + esc(batch) + '</td>' +
      '<td><span class="badge-status badge-category">' + esc(s.category || '--') + '</span></td>' +
      '<td><span class="badge-status ' + statusCls + '">' + esc(s.status) + '</span></td>' +
      '<td><div class="students-actions">' +
      (s.has_results ? '<a class="btn btn-sm btn-outline-primary students-results-link" href="/reports/student?' + esc(new URLSearchParams({ batch_id: s.batch_id, student_id: s.student_id }).toString()) + '" title="View results for ' + esc(s.usn) + '" aria-label="View results for ' + esc(s.usn) + '"><span class="material-icons" aria-hidden="true">assessment</span>View Results</a>' : '<button type="button" class="btn btn-sm btn-outline-primary students-results-link" disabled aria-disabled="true" title="No results uploaded for ' + esc(s.usn) + '" aria-label="View results unavailable: no results uploaded for ' + esc(s.usn) + '"><span class="material-icons" aria-hidden="true">assessment</span>View Results</button>') +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="edit" data-id="' + s.student_id + '" title="Edit ' + esc(s.usn) + '" aria-label="Edit ' + esc(s.usn) + '"><span class="material-icons" aria-hidden="true">edit</span></button>' +
      '<button type="button" class="btn btn-sm btn-outline-danger" data-act="delete" data-id="' + s.student_id + '" title="Delete ' + esc(s.usn) + '" aria-label="Delete ' + esc(s.usn) + '"><span class="material-icons" aria-hidden="true">delete_outline</span></button>' +
      '</div></td></tr>';
  }

  function parameters() {
    var params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    params.set('batch_id', batchSelect.value || 'all');
    if (categorySelect.value) params.set('category', categorySelect.value);
    if (statusSelect.value) params.set('status', statusSelect.value);
    params.set('page', page);
    params.set('pageSize', pageSize.value);
    return params;
  }
  function syncUrl(push) {
    var url = '/students?' + parameters();
    if (location.pathname + location.search !== url) history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  function busy(value) {
    loading.hidden = !value;
    tbody.setAttribute('aria-busy', String(value));
    previous.disabled = value || pagination.page <= 1;
    next.disabled = value || pagination.page >= pagination.totalPages;
  }
  function invalidate() {
    clearTimeout(debounce);
    requestVersion++;
    if (requestController) requestController.abort();
  }
  async function loadStudents(push) {
    invalidate();
    var version = requestVersion;
    requestController = new AbortController();
    var params = parameters();
    var search = params.get('search') || '';
    syncUrl(push === true);
    searchError.hidden = true;
    busy(true);
    try {
      var json = await api('/students/api/list?' + params, { signal: requestController.signal });
      if (version !== requestVersion) return;
      if (!json.success || !Array.isArray(json.data) || !json.pagination) throw new Error('Unable to search students. Please try again.');
      pagination = json.pagination;
      page = pagination.page;
      var rows = json.data;
      tbody.innerHTML = rows.length ? rows.map(rowHtml).join('')
        : '<tr><td colspan="8" class="text-center text-muted">' + esc(search ? 'No students matched "' + search + '".' : 'No students found for the selected filters.') + '</td></tr>';
      count.textContent = pagination.totalRows ? 'Showing ' + ((page - 1) * pagination.pageSize + 1) + '-' + Math.min(page * pagination.pageSize, pagination.totalRows) + ' of ' + pagination.totalRows + ' students' : '0 students found';
      pageInfo.textContent = 'Page ' + page + ' of ' + Math.max(pagination.totalPages, 1);
      syncUrl(false);
    } catch (e) {
      if (version !== requestVersion || e.name === 'AbortError') return;
      searchError.textContent = e.message + ' Previous results have been kept.';
      searchError.hidden = false;
    } finally { if (version === requestVersion) busy(false); }
  }

  async function loadStats() {
    var version = ++statsVersion;
    if (statsController) statsController.abort();
    statsController = new AbortController();
    try {
      var params = new URLSearchParams();
      if (batchSelect.value) params.set('batch_id', batchSelect.value);
      var json = await api('/students/api/stats?' + params.toString(), { signal: statsController.signal });
      if (version !== statsVersion) return;
      var d = json.data || {};
      document.getElementById('statTotal').textContent = d.total != null ? d.total : '--';
      document.getElementById('statActive').textContent = d.active != null ? d.active : '--';
      document.getElementById('statInactive').textContent = d.inactive != null ? d.inactive : '--';
      document.getElementById('statCategories').textContent = d.categories != null ? d.categories : '--';
    } catch (e) {
      if (version !== statsVersion || e.name === 'AbortError') return;
      ['statTotal', 'statActive', 'statInactive', 'statCategories'].forEach(function (id) { document.getElementById(id).textContent = '--'; });
    }
  }
  function reloadAll() { loadStudents(); loadStats(); }
  async function loadCategories() {
    var version = ++categoriesVersion;
    try {
      var json = await api('/students/api/categories');
      if (version !== categoriesVersion) return;
      if (!json.success || !Array.isArray(json.data)) throw new Error('Invalid category response.');
      var categories = Array.from(new Set(json.data.filter(function (value) { return typeof value === 'string' && value.trim(); })));
      var selected = categorySelect.value;
      var options = categories.slice();
      if (selected && !options.includes(selected)) options.push(selected);
      categorySelect.innerHTML = '<option value="">All Categories</option>' + options.map(function (value) {
        return '<option value="' + esc(value) + '">' + esc(value) + '</option>';
      }).join('');
      categorySelect.value = selected;
      document.getElementById('studentCategoryList').innerHTML = categories.map(function (value) {
        return '<option value="' + esc(value) + '"></option>';
      }).join('');
    } catch (e) {
      if (version === categoriesVersion) toast('warning', 'Student data was saved, but categories could not be refreshed. Please refresh the page to retry.');
    }
  }
  function reloadAfterMutation() { reloadAll(); loadCategories(); }

  searchInput.addEventListener('input', function () {
    invalidate();
    page = 1;
    clearSearch.hidden = !searchInput.value;
    busy(true);
    debounce = setTimeout(function () { loadStudents(true); }, 300);
  });
  [batchSelect, categorySelect, statusSelect].forEach(function (el) {
    el.addEventListener('change', function () { page = 1; loadStudents(true); });
  });
  batchSelect.addEventListener('change', loadStats);
  resetBtn.addEventListener('click', function () {
    searchInput.value = '';
    clearSearch.hidden = true;
    batchSelect.value = defaultBatch;
    categorySelect.value = '';
    statusSelect.value = '';
    page = 1;
    pageSize.value = '25';
    loadStudents(true); loadStats();
  });
  clearSearch.addEventListener('click', function () { searchInput.value = ''; clearSearch.hidden = true; page = 1; searchInput.focus(); loadStudents(true); });
  pageSize.addEventListener('change', function () { page = 1; loadStudents(true); });
  previous.addEventListener('click', function () { if (!previous.disabled) { page = pagination.page - 1; loadStudents(true); } });
  next.addEventListener('click', function () { if (!next.disabled) { page = pagination.page + 1; loadStudents(true); } });
  window.addEventListener('popstate', function () {
    var params = new URLSearchParams(location.search);
    searchInput.value = params.get('search') || params.get('q') || '';
    batchSelect.value = params.get('batch_id') || defaultBatch;
    categorySelect.value = params.get('category') || '';
    statusSelect.value = (params.get('status') || '').toLowerCase();
    pageSize.value = params.get('pageSize') || '25';
    page = Number(params.get('page')) || 1;
    clearSearch.hidden = !searchInput.value;
    reloadAll();
  });

  function formValues() {
    return {
      batch_id: document.getElementById('studentBatch').value,
      usn: document.getElementById('studentUsn').value.trim().toUpperCase(),
      student_name: document.getElementById('studentName').value.trim().toUpperCase(),
      email: document.getElementById('studentEmail').value.trim().toLowerCase(),
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
  var studentEmail = document.getElementById('studentEmail');
  var emailTouched = false;
  function validateStudentEmail(showError) {
    var problem = StudentEmailValidation.getError(studentEmail.value.trim().toLowerCase());
    studentEmail.setCustomValidity(problem);
    if (showError) {
      studentEmail.classList.toggle('is-invalid', !!problem);
      studentEmail.setAttribute('aria-invalid', String(!!problem));
      document.getElementById('studentEmailFeedback').textContent = problem;
    }
    return !problem;
  }
  function resetEmailValidation() {
    emailTouched = false;
    studentEmail.setCustomValidity('');
    studentEmail.classList.remove('is-invalid');
    studentEmail.setAttribute('aria-invalid', 'false');
    document.getElementById('studentEmailFeedback').textContent = '';
  }
  studentEmail.addEventListener('blur', function () { emailTouched = true; validateStudentEmail(true); });
  studentEmail.addEventListener('input', function () { validateStudentEmail(emailTouched); });
  function protectAcademicIdentity(hasHistory) {
    document.getElementById('studentUsn').readOnly = hasHistory;
    document.getElementById('studentBatch').disabled = hasHistory;
    document.getElementById('studentIdentityNotice').hidden = !hasHistory;
  }
  addBtn.addEventListener('click', function () {
    document.getElementById('studentFormTitle').textContent = 'Add Student';
    document.getElementById('studentId').value = '';
    document.getElementById('studentForm').reset();
    protectAcademicIdentity(false);
    document.getElementById('studentBatch').value = batches.length ? String(batches[0].id) : '';
    document.getElementById('studentStatus').value = 'active';
    resetEmailValidation();
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
        protectAcademicIdentity(json.has_academic_history === true);
        resetEmailValidation();
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
    emailTouched = true;
    if (!validateStudentEmail(true)) {
      studentEmail.focus();
      return;
    }
    if (!values.category) return showFormError('Category is required');
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
      var json = await api('/students/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      toast('success', json.message || 'Student created successfully');
      reloadAfterMutation();
    } catch (e) { showFormError(e.message); formModal.show(); }
  }
  async function doUpdate(values) {
    var id = document.getElementById('studentId').value;
    try {
      await api('/students/api/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      toast('success', 'Student updated successfully');
      reloadAfterMutation();
    } catch (e) { showFormError(e.message); formModal.show(); }
  }
  async function doDelete(id) {
    try {
      await api('/students/api/' + id, { method: 'DELETE' });
      toast('success', 'Student deleted successfully');
      reloadAfterMutation();
    } catch (e) { toast('danger', e.message); }
  }

  importBtn.addEventListener('click', function () {
    document.getElementById('importBatch').value = batches.length ? String(batches[0].id) : '';
    document.getElementById('importStatus').value = 'active';
    document.getElementById('importFile').value = '';
    hideImportError();
    showImportWarning('');
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
  function showImportWarning(msg) {
    var el = document.getElementById('importWarning');
    if (!msg) { el.classList.add('d-none'); el.textContent = ''; return; }
    el.classList.remove('d-none');
    el.textContent = msg;
  }
  document.getElementById('importParseBtn').addEventListener('click', async function () {
    hideImportError();
    showImportWarning('');
    document.getElementById('importSummary').classList.add('d-none');
    document.getElementById('importPreviewWrap').classList.add('d-none');
    document.getElementById('importConfirmBtn').classList.add('d-none');
    var importBatch = document.getElementById('importBatch').value;
    var importStatus = document.getElementById('importStatus').value;
    if (!importBatch) return showImportError('Please select a batch before importing');
    if (!importStatus) return showImportError('Please select a status before importing');
    var file = document.getElementById('importFile').files[0];
    if (!file) return showImportError('Please choose an .xlsx, .xls or .csv file');
    var fd = new FormData();
    fd.append('file', file);
    fd.append('batch_id', importBatch);
    fd.append('status', importStatus);
    try {
      var res = await fetch('/students/api/import/preview', { method: 'POST', body: fd });
      var json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Parse failed');
      importRows = (json.data.rows || []).map(function (row) {
        var emailError = StudentEmailValidation.getError(row.email);
        if (!emailError) return row;
        return Object.assign({}, row, {
          valid: false,
          message: row.valid ? emailError : (row.message || emailError)
        });
      });
      var validCount = importRows.filter(function (row) { return row.valid; }).length;
      var invalidCount = importRows.length - validCount;
      document.getElementById('importTotal').textContent = importRows.length;
      document.getElementById('importValid').textContent = validCount;
      document.getElementById('importInvalid').textContent = invalidCount;
      document.getElementById('importSummary').classList.remove('d-none');
      if (invalidCount > 0) {
        showImportWarning('Some rows have missing or incorrect data. Please cross verify the highlighted rows before confirming. Only valid rows will be imported.');
      }
      var body = document.querySelector('#importPreviewTable tbody');
      body.innerHTML = importRows.map(function (r) {
        return '<tr><td>' + r.row + '</td><td>' + esc(r.batch || batchName(r.batch_id, '')) + '</td>' +
          '<td>' + esc(r.usn) + '</td><td>' + esc(r.student_name) + '</td>' +
          '<td>' + esc(r.email) + '</td><td>' + esc(r.category) + '</td><td>' + esc(r.status) + '</td>' +
          '<td><span class="badge-status ' + (r.valid ? 'badge-valid' : 'badge-invalid') + '">' + esc(r.message) + '</span></td></tr>';
      }).join('');
      document.getElementById('importPreviewWrap').classList.remove('d-none');
      var cbtn = document.getElementById('importConfirmBtn');
      if (validCount > 0) {
        cbtn.classList.remove('d-none');
        cbtn.textContent = 'Confirm Import (' + validCount + ' valid)';
      } else { cbtn.classList.add('d-none'); }
    } catch (e) { showImportError(e.message); }
  });
  document.getElementById('importConfirmBtn').addEventListener('click', function () {
    var valid = importRows.filter(function (r) { return r.valid; }).length;
    var invalid = importRows.length - valid;
    var importBatch = document.getElementById('importBatch').value;
    var importStatus = document.getElementById('importStatus').value;
    document.getElementById('studentConfirmTitle').textContent = 'Confirm Import';
    document.getElementById('studentConfirmText').textContent =
      'Student Import - Batch: ' + batchName(importBatch, importBatch) + ', Status: ' + importStatus +
      ', Total Records: ' + importRows.length + ', Valid Records: ' + valid +
      ', Invalid Records: ' + invalid + '. Are you sure you want to import the ' + valid + ' valid records?';
    var cb = document.getElementById('studentConfirmBtn');
    cb.textContent = 'Confirm Import';
    cb.className = 'btn btn-primary';
    confirmDetails([
      ['Batch', batchName(importBatch, importBatch)], ['Status', importStatus],
      ['Total Records', String(importRows.length)], ['Valid Records', String(valid)], ['Invalid Records', String(invalid)]
    ]);
    pendingAction = doImport;
    importModal.hide();
    confirmModal.show();
  });
  async function doImport() {
    try {
      var json = await api('/students/api/import/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: document.getElementById('importBatch').value,
          status: document.getElementById('importStatus').value,
          rows: importRows
        })
      });
      document.getElementById('importResultOk').textContent = json.data.imported;
      document.getElementById('importResultSkipped').textContent = json.data.skipped;
      document.getElementById('importResultReasons').innerHTML =
        (json.data.skippedRows || []).map(function (s) {
          return '<li>Row ' + esc(s.row) + ' (' + esc(s.usn || '--') + '): ' + esc(s.reason) + '</li>';
        }).join('') || '<li>All valid records imported.</li>';
      resultModal.show();
      toast(json.data.skipped > 0 ? 'warning' : 'success', json.message);
      reloadAfterMutation();
    } catch (e) { toast('danger', e.message); }
  }

  syncUrl(false);
  busy(false);
  loadStats();
});



