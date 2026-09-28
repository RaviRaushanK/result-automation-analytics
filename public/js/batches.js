/* ============================================
   Batches Management - SRAAS
   Loads batches and departments, and handles
   view / create / edit with confirmations.
   ============================================ */

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // =====================
    // Configuration
    // =====================
    var YEAR_MIN = 1900;
    var YEAR_MAX = 2200;

    var CREATE_FIELDS = {
        batch_name: 'createBatchName',
        department_id: 'createBatchDepartment',
        start_year: 'createBatchStartYear',
        end_year: 'createBatchEndYear',
        status: 'createBatchStatus'
    };

    var EDIT_FIELDS = {
        batch_name: 'editBatchName',
        department_id: 'editBatchDepartment',
        start_year: 'editBatchStartYear',
        end_year: 'editBatchEndYear',
        status: 'editBatchStatus'
    };

    // =====================
    // State
    // =====================
    var batches = [];
    var departments = [];
    var pendingCreate = null;
    var pendingUpdate = null;
    var createConfirmed = false;
    var updateConfirmed = false;
    var reopenCreateAfterCancel = false;
    var reopenEditAfterCancel = false;

    // =====================
    // DOM References
    // =====================
    var pageDataEl = document.getElementById('batchesPageData');
    var tableWrapper = document.getElementById('batchesTableWrapper');
    var tableBody = document.getElementById('batchesTableBody');
    var emptyState = document.getElementById('batchesEmptyState');
    var emptyTitle = document.getElementById('batchesEmptyTitle');
    var emptyText = document.getElementById('batchesEmptyText');
    var emptyCreateBtn = document.getElementById('emptyStateCreateBtn');
    var searchInput = document.getElementById('batchSearchInput');
    var statusFilter = document.getElementById('batchStatusFilter');
    var toastContainer = document.getElementById('batchesToastContainer');

    var createModal = document.getElementById('createBatchModal');
    var createForm = document.getElementById('createBatchForm');
    var confirmCreateModal = document.getElementById('confirmCreateModal');
    var editModal = document.getElementById('editBatchModal');
    var editForm = document.getElementById('editBatchForm');
    var confirmEditModal = document.getElementById('confirmEditModal');
    var detailsModal = document.getElementById('batchDetailsModal');
    // =====================
    // Small Helpers
    // =====================
    function escapeHtml(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function capitalize(value) {
        var str = value == null ? '' : String(value);
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function safeParse(json, fallback) {
        try {
            var parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function getModal(element) {
        return bootstrap.Modal.getOrCreateInstance(element);
    }

    function showModal(element) {
        getModal(element).show();
    }

    function hideModal(element) {
        var instance = bootstrap.Modal.getInstance(element);
        if (instance) instance.hide();
    }

    // Hide one modal, then show the next (avoids stacked Bootstrap backdrops)
    function showModalAfterHide(currentEl, nextEl) {
        var onHidden = function () {
            currentEl.removeEventListener('hidden.bs.modal', onHidden);
            showModal(nextEl);
        };
        currentEl.addEventListener('hidden.bs.modal', onHidden);
        var instance = bootstrap.Modal.getInstance(currentEl);
        if (instance) {
            instance.hide();
        } else {
            showModal(nextEl);
        }
    }

    function generateUuid() {
        if (window.crypto && window.crypto.randomUUID) {
            return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            var v = c === 'x' ? r : ((r & 0x3) | 0x8);
            return v.toString(16);
        });
    }
    // =====================
    // Formatting
    // =====================
    function formatDate(value) {
        if (!value) return '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatDateTime(value) {
        if (!value) return '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function formatDuration(batch) {
        var start = Number(batch && batch.start_year);
        var end = Number(batch && batch.end_year);
        if (!start || !end) return '—';
        var years = end - start;
        if (years <= 0) return '—';
        return years + (years === 1 ? ' Year' : ' Years');
    }

    function departmentNameFor(batch) {
        if (!batch) return '—';
        if (batch.Department && batch.Department.department_name) {
            return batch.Department.department_name;
        }
        var match = departments.filter(function (d) {
            return Number(d.department_id) === Number(batch.department_id);
        })[0];
        return match ? match.department_name : '—';
    }

    function findBatch(id) {
        return batches.filter(function (b) {
            return String(b.batch_id) === String(id);
        })[0] || null;
    }

    // =====================
    // Notifications (existing alert-container design)
    // =====================
    function showToast(type, message) {
        if (!toastContainer) return;
        var allowed = ['success', 'danger', 'warning', 'info'];
        var alertType = allowed.indexOf(type) === -1 ? 'info' : type;

        var alertEl = document.createElement('div');
        alertEl.className = 'alert alert-' + alertType + ' alert-dismissible fade show';
        alertEl.setAttribute('role', 'alert');
        alertEl.innerHTML = escapeHtml(message) +
            '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>';
        toastContainer.appendChild(alertEl);

        // Auto-dismiss after 5s (same behaviour as the app's flash alerts)
        var timeout = setTimeout(function () {
            try {
                bootstrap.Alert.getOrCreateInstance(alertEl).close();
            } catch (e) {
                alertEl.remove();
            }
        }, 5000);

        alertEl.addEventListener('closed.bs.alert', function () {
            clearTimeout(timeout);
        });
    }
    // =====================
    // API Helpers
    // =====================
    async function fetchJSON(url, options) {
        options = options || {};
        var headers = Object.assign({ 'Accept': 'application/json' }, options.headers || {});
        if (options.body) headers['Content-Type'] = 'application/json';

        var res;
        try {
            res = await fetch(url, Object.assign({}, options, { headers: headers }));
        } catch (e) {
            throw makeError('NETWORK_ERROR', null, 'Unable to reach the server.');
        }

        var contentType = (res.headers.get('content-type') || '');
        if (contentType.indexOf('application/json') === -1) {
            // Session expired / server error pages return HTML
            throw makeError(res.status === 401 ? 'AUTH_ERROR' : 'BAD_RESPONSE', res.status, null);
        }

        var json = await res.json().catch(function () { return null; });
        if (!res.ok) {
            throw makeError('REQUEST_FAILED', res.status, json && json.message);
        }
        return json;
    }

    function makeError(code, status, serverMessage) {
        var err = new Error(code);
        err.code = code;
        err.status = status || null;
        err.serverMessage = serverMessage || null;
        return err;
    }

    // Map API / database errors to user-friendly messages.
    // Raw Sequelize messages are never shown to the user.
    function friendlyErrorMessage(err) {
        if (!err) return 'Something went wrong. Please try again.';
        if (err.code === 'NETWORK_ERROR') {
            return 'Unable to reach the server. Please check your connection and try again.';
        }
        if (err.code === 'AUTH_ERROR' || err.status === 401) {
            return 'Your session has expired. Please log in again.';
        }
        if (err.code === 'BAD_RESPONSE') {
            return 'Unexpected response from the server. Please try again.';
        }

        var raw = String(err.serverMessage || err.message || '').toLowerCase();

        if (err.status === 404) return 'Batch not found. It may have already been updated or removed.';
        if (raw.indexOf('duplicate') !== -1 || raw.indexOf('unique') !== -1 ||
            raw.indexOf('er_dup_entry') !== -1 || raw.indexOf('sequelizeunique') !== -1) {
            return 'A batch with these details already exists.';
        }
        if (raw.indexOf('foreign key') !== -1 || raw.indexOf('sequelizeforeignkey') !== -1) {
            return 'Selected department is invalid.';
        }
        if (raw.indexOf('notnull') !== -1 || raw.indexOf('null constraint') !== -1) {
            return 'Please fill in all required fields.';
        }
        if (raw.indexOf('validation') !== -1 || raw.indexOf('sequelize') !== -1) {
            return 'Please check the form fields and try again.';
        }
        if (err.status === 400 || err.status === 422) {
            return 'The submitted data is invalid. Please review the form and try again.';
        }
        if (err.status >= 500) {
            return 'Something went wrong on the server. Please try again later.';
        }
        return 'Request failed. Please try again.';
    }

    function showFormError(id, message) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.classList.remove('d-none');
    }

    function hideFormError(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = '';
        el.classList.add('d-none');
    }

    function setButtonLoading(button, loading, label) {
        if (!button) return;
        if (loading) {
            button.dataset.originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>' +
                '<span>' + escapeHtml(label) + '</span>';
        } else {
            button.disabled = false;
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
                delete button.dataset.originalHtml;
            }
        }
    }
    // =====================
    // Loading Data
    // =====================
    function loadingRow(message) {
        return '<tr><td colspan="8" class="text-center table-loading">' +
            '<div class="spinner-border spinner-border-sm text-primary" role="status">' +
            '<span class="visually-hidden">Loading...</span></div>' +
            '<span class="ms-2 text-muted">' + escapeHtml(message) + '</span>' +
            '</td></tr>';
    }

    // Refresh the batch list from the existing GET /batches API
    function loadBatches() {
        tableWrapper.classList.remove('d-none');
        emptyState.classList.add('d-none');
        tableBody.innerHTML = loadingRow('Loading batches...');

        return fetchJSON('/batches').then(function (json) {
            batches = Array.isArray(json.data) ? json.data : [];
            renderAll();
        }).catch(function (err) {
            console.error('Failed to load batches:', err);
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center table-message text-danger">' +
                escapeHtml(friendlyErrorMessage(err)) +
                ' <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-action="retry-load">Retry</button>' +
                '</td></tr>';
        });
    }

    // Populate the department dropdowns from the server-rendered department list
    function loadDepartments() {
        var selectIds = [CREATE_FIELDS.department_id, EDIT_FIELDS.department_id];
        selectIds.forEach(function (id) {
            var select = document.getElementById(id);
            if (!select) return;
            var current = select.value;
            var options = '<option value="">Select department</option>' +
                departments.map(function (dept) {
                    return '<option value="' + escapeHtml(dept.department_id) + '">' +
                        escapeHtml(dept.department_name) + '</option>';
                }).join('');
            select.innerHTML = options;
            if (current) select.value = current;
        });
    }
    // =====================
    // Rendering
    // =====================
    function renderSummaryCards() {
        var active = batches.filter(function (b) { return b.status === 'active'; });
        var inactive = batches.filter(function (b) { return b.status === 'inactive'; });
        var latest = active.slice().sort(function (a, b) {
            return new Date(b.created_at || 0) - new Date(a.created_at || 0) ||
                Number(b.batch_id) - Number(a.batch_id);
        })[0];

        setText('totalBatchesCount', String(batches.length));
        setText('activeBatchesCount', String(active.length));
        setText('inactiveBatchesCount', String(inactive.length));
        setText('latestBatchName', latest ? latest.batch_name : '—');

        var latestEl = document.getElementById('latestBatchName');
        if (latestEl) {
            latestEl.title = latest ? latest.batch_name : '';
        }
    }

    function getFilteredBatches() {
        var query = (searchInput.value || '').trim().toLowerCase();
        var status = statusFilter.value;

        return batches.filter(function (b) {
            if (status && b.status !== status) return false;
            if (!query) return true;
            var haystack = [
                b.batch_name,
                departmentNameFor(b),
                b.Department ? b.Department.department_code : '',
                b.start_year,
                b.end_year
            ].join(' ').toLowerCase();
            return haystack.indexOf(query) !== -1;
        });
    }
    function batchRowHtml(b) {
        var statusClass = b.status === 'active' ? 'bg-success' : 'bg-warning text-dark';
        return '<tr>' +
            '<td class="fw-medium">' + escapeHtml(b.batch_name) + '</td>' +
            '<td>' + escapeHtml(departmentNameFor(b)) + '</td>' +
            '<td class="text-nowrap">' + escapeHtml(String(b.start_year != null ? b.start_year : '—')) + '</td>' +
            '<td class="text-nowrap">' + escapeHtml(String(b.end_year != null ? b.end_year : '—')) + '</td>' +
            '<td class="text-nowrap">' + escapeHtml(formatDuration(b)) + '</td>' +
            '<td><span class="badge ' + statusClass + '">' + escapeHtml(capitalize(b.status)) + '</span></td>' +
            '<td class="text-nowrap">' + escapeHtml(formatDate(b.created_at)) + '</td>' +
            '<td class="text-center text-nowrap">' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="view" data-id="' +
                    escapeHtml(String(b.batch_id)) + '" title="View batch" aria-label="View batch">' +
                    '<span class="material-icons action-icon">visibility</span></button>' +
                '<button type="button" class="btn btn-sm btn-outline-primary" data-action="edit" data-id="' +
                    escapeHtml(String(b.batch_id)) + '" title="Edit batch" aria-label="Edit batch">' +
                    '<span class="material-icons action-icon">edit</span></button>' +
            '</td>' +
        '</tr>';
    }

    function renderTable() {
        var rows = getFilteredBatches();

        if (!rows.length) {
            tableWrapper.classList.add('d-none');
            emptyState.classList.remove('d-none');
            emptyTitle.textContent = 'No batches found';

            if (batches.length === 0) {
                emptyText.textContent = 'Create your first academic batch to get started.';
                emptyCreateBtn.classList.remove('d-none');
            } else {
                emptyText.textContent = 'No batches match your current search or filter.';
                emptyCreateBtn.classList.add('d-none');
            }
            return;
        }

        emptyState.classList.add('d-none');
        tableWrapper.classList.remove('d-none');
        tableBody.innerHTML = rows.map(batchRowHtml).join('');
    }

    function renderAll() {
        renderSummaryCards();
        renderTable();
    }

    // Filter the currently loaded records by the search box
    function searchBatches() {
        renderTable();
    }

    // Filter the loaded records by status
    function filterByStatus() {
        renderTable();
    }
    // =====================
    // Form Validation
    // =====================
    function applyFieldError(controlId, message) {
        var control = document.getElementById(controlId);
        if (!control) return;
        var feedback = control.parentElement
            ? control.parentElement.querySelector('.invalid-feedback')
            : null;

        if (message) {
            control.classList.add('is-invalid');
            if (feedback) feedback.textContent = message;
        } else {
            control.classList.remove('is-invalid');
        }
    }

    function clearFieldError(controlId) {
        applyFieldError(controlId, null);
    }

    function clearFormErrors(fields) {
        Object.keys(fields).forEach(function (key) {
            clearFieldError(fields[key]);
        });
    }

    // Validate a batch form. Returns { valid, data, errors }.
    function validateForm(fields) {
        var batchName = document.getElementById(fields.batch_name).value.trim();
        var departmentId = document.getElementById(fields.department_id).value;
        var startRaw = document.getElementById(fields.start_year).value.trim();
        var endRaw = document.getElementById(fields.end_year).value.trim();
        var status = document.getElementById(fields.status).value;

        var errors = {};
        var startYear = null;
        var endYear = null;
        var validDepartmentIds = departments.map(function (d) { return String(d.department_id); });

        if (!batchName) {
            errors[fields.batch_name] = 'Batch name is required.';
        }

        if (!departmentId) {
            errors[fields.department_id] = 'Department is required.';
        } else if (validDepartmentIds.indexOf(String(departmentId)) === -1) {
            errors[fields.department_id] = 'Selected department is invalid.';
        }

        if (!startRaw) {
            errors[fields.start_year] = 'Start year is required.';
        } else {
            startYear = Number(startRaw);
            if (!Number.isInteger(startYear) || startYear < YEAR_MIN || startYear > YEAR_MAX) {
                errors[fields.start_year] = 'Start year must be a valid year.';
                startYear = null;
            }
        }

        if (!endRaw) {
            errors[fields.end_year] = 'End year is required.';
        } else {
            endYear = Number(endRaw);
            if (!Number.isInteger(endYear) || endYear < YEAR_MIN || endYear > YEAR_MAX) {
                errors[fields.end_year] = 'End year must be a valid year.';
                endYear = null;
            } else if (startYear !== null && endYear <= startYear) {
                errors[fields.end_year] = 'End year must be greater than start year.';
            }
        }

        // Apply error styling
        Object.keys(fields).forEach(function (key) {
            applyFieldError(fields[key], errors[fields[key]] || null);
        });

        var valid = Object.keys(errors).length === 0;
        if (!valid) {
            var firstInvalid = document.getElementById(
                Object.keys(errors)[0]
            );
            if (firstInvalid) firstInvalid.focus();
        }

        return {
            valid: valid,
            errors: errors,
            data: {
                batch_name: batchName,
                department_id: departmentId ? Number(departmentId) : null,
                start_year: startYear,
                end_year: endYear,
                status: status
            }
        };
    }

    // Fill a confirmation summary (create / edit) from batch values
    function fillSummary(containerId, data, departmentName) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var values = {
            batch_name: data.batch_name,
            department: departmentName,
            start_year: data.start_year,
            end_year: data.end_year,
            status: capitalize(data.status)
        };
        container.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.getAttribute('data-field');
            el.textContent = values[field] != null ? String(values[field]) : '-';
        });
    }

    function departmentNameById(id) {
        var match = departments.filter(function (d) {
            return String(d.department_id) === String(id);
        })[0];
        return match ? match.department_name : '—';
    }
    // =====================
    // Create Batch
    // =====================
    function resetCreateForm() {
        if (createForm) createForm.reset();
        clearFormErrors(CREATE_FIELDS);
        hideFormError('createBatchError');
        hideFormError('confirmCreateError');
        pendingCreate = null;
    }

    function openCreateBatch() {
        resetCreateForm();
        if (!departments.length) {
            showFormError('createBatchError',
                'No departments are available. Please add a department before creating a batch.');
        }
        showModal(createModal);
    }

    // Step 1: validate the form, then ask for confirmation (nothing is saved yet)
    function createBatch(event) {
        if (event) event.preventDefault();

        var result = validateForm(CREATE_FIELDS);
        if (!result.valid) return;

        pendingCreate = {
            batch_uuid: generateUuid(),
            department_id: result.data.department_id,
            batch_name: result.data.batch_name,
            start_year: result.data.start_year,
            end_year: result.data.end_year,
            status: result.data.status
        };

        hideFormError('createBatchError');
        createConfirmed = false;
        fillSummary('confirmCreateSummary', pendingCreate,
            departmentNameById(pendingCreate.department_id));
        showModalAfterHide(createModal, confirmCreateModal);
    }

    // Step 2: only after "Confirm & Create" send the create request
    async function confirmCreate() {
        if (!pendingCreate) return;

        var confirmBtn = document.getElementById('confirmCreateBtn');
        var cancelBtn = document.getElementById('confirmCreateCancelBtn');
        setButtonLoading(confirmBtn, true, 'Creating...');
        confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        hideFormError('confirmCreateError');

        try {
            await fetchJSON('/batches', {
                method: 'POST',
                body: JSON.stringify(pendingCreate)
            });

            createConfirmed = true;
            pendingCreate = null;
            hideModal(confirmCreateModal);
            resetCreateForm();
            showToast('success', 'Batch created successfully.');
            await loadBatches(); // refresh list + summary cards
        } catch (err) {
            console.error('Failed to create batch:', err);
            showFormError('confirmCreateError', friendlyErrorMessage(err));
        } finally {
            setButtonLoading(confirmBtn, false, 'Confirm & Create');
            confirmBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }
    // =====================
    // Edit Batch
    // =====================
    function resetEditForm() {
        if (editForm) editForm.reset();
        clearFormErrors(EDIT_FIELDS);
        hideFormError('editBatchError');
        hideFormError('confirmEditError');
    }

    // Open the edit form pre-filled with the existing batch data
    function editBatch(id) {
        var batch = findBatch(id);
        if (!batch) {
            showToast('warning', 'Batch not found. It may have already been updated or removed.');
            loadBatches();
            return;
        }

        resetEditForm();
        document.getElementById('editBatchId').value = batch.batch_id;
        document.getElementById('editBatchName').value = batch.batch_name || '';
        document.getElementById('editBatchDepartment').value =
            batch.department_id != null ? String(batch.department_id) : '';
        document.getElementById('editBatchStartYear').value =
            batch.start_year != null ? batch.start_year : '';
        document.getElementById('editBatchEndYear').value =
            batch.end_year != null ? batch.end_year : '';
        document.getElementById('editBatchStatus').value = batch.status || 'active';

        if (!departments.length) {
            showFormError('editBatchError',
                'No departments are available. Please add a department before editing batches.');
        }

        showModal(editModal);
    }

    // Step 1: validate, then ask for confirmation before updating
    function saveBatchChanges(event) {
        if (event) event.preventDefault();

        var result = validateForm(EDIT_FIELDS);
        if (!result.valid) return;

        var batchId = document.getElementById('editBatchId').value;
        if (!batchId) {
            showFormError('editBatchError', 'Batch not found. Please close this form and try again.');
            return;
        }

        pendingUpdate = {
            id: batchId,
            payload: {
                department_id: result.data.department_id,
                batch_name: result.data.batch_name,
                start_year: result.data.start_year,
                end_year: result.data.end_year,
                status: result.data.status
            }
        };

        hideFormError('editBatchError');
        updateConfirmed = false;
        fillSummary('confirmEditSummary', pendingUpdate.payload,
            departmentNameById(pendingUpdate.payload.department_id));
        showModalAfterHide(editModal, confirmEditModal);
    }

    // Step 2: only after "Confirm & Save" send the update request
    async function confirmUpdate() {
        if (!pendingUpdate) return;

        var confirmBtn = document.getElementById('confirmEditBtn');
        var cancelBtn = document.getElementById('confirmEditCancelBtn');
        setButtonLoading(confirmBtn, true, 'Saving...');
        confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        hideFormError('confirmEditError');

        try {
            await fetchJSON('/batches/' + encodeURIComponent(pendingUpdate.id), {
                method: 'PUT',
                body: JSON.stringify(pendingUpdate.payload)
            });

            updateConfirmed = true;
            pendingUpdate = null;
            hideModal(confirmEditModal);
            resetEditForm();
            showToast('success', 'Batch updated successfully.');
            await loadBatches(); // refresh the table + summary cards
        } catch (err) {
            console.error('Failed to update batch:', err);
            showFormError('confirmEditError', friendlyErrorMessage(err));
        } finally {
            setButtonLoading(confirmBtn, false, 'Confirm & Save');
            confirmBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }
    // =====================
    // View Batch Details
    // =====================
    function fillBatchDetails(batch) {
        var list = document.getElementById('batchDetailsList');
        var values = {
            batch_name: batch.batch_name || '-',
            batch_uuid: batch.batch_uuid || '-',
            department: departmentNameFor(batch),
            start_year: batch.start_year != null ? String(batch.start_year) : '-',
            end_year: batch.end_year != null ? String(batch.end_year) : '-',
            duration: formatDuration(batch),
            status: '<span class="badge ' +
                (batch.status === 'active' ? 'bg-success' : 'bg-warning text-dark') +
                '">' + escapeHtml(capitalize(batch.status)) + '</span>',
            created_at: formatDateTime(batch.created_at),
            updated_at: formatDateTime(batch.updated_at)
        };

        list.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.getAttribute('data-field');
            if (field === 'status') {
                el.innerHTML = values.status;
            } else {
                el.textContent = values[field] != null ? values[field] : '-';
            }
        });

        document.getElementById('batchDetailsLoading').classList.add('d-none');
        hideFormError('batchDetailsError');
        list.classList.remove('d-none');
    }

    // Fetch fresh details from the existing GET /batches/:id API
    async function viewBatch(id) {
        var loading = document.getElementById('batchDetailsLoading');
        var list = document.getElementById('batchDetailsList');

        loading.classList.remove('d-none');
        list.classList.add('d-none');
        hideFormError('batchDetailsError');
        showModal(detailsModal);

        try {
            var json = await fetchJSON('/batches/' + encodeURIComponent(id));
            if (!json.data) throw makeError('REQUEST_FAILED', null, null);
            fillBatchDetails(json.data);
        } catch (err) {
            console.error('Failed to load batch details:', err);
            loading.classList.add('d-none');
            showFormError('batchDetailsError', friendlyErrorMessage(err));
        }
    }
    // =====================
    // Event Bindings
    // =====================

    // Toolbar
    searchInput.addEventListener('input', searchBatches);
    statusFilter.addEventListener('change', filterByStatus);

    // Create flow
    document.getElementById('createBatchHeaderBtn').addEventListener('click', openCreateBatch);
    emptyCreateBtn.addEventListener('click', openCreateBatch);
    createForm.addEventListener('submit', createBatch);
    document.getElementById('confirmCreateBtn').addEventListener('click', confirmCreate);
    document.getElementById('confirmCreateCancelBtn').addEventListener('click', function () {
        hideModal(confirmCreateModal);
    });

    // Cancel / close the confirmation → reopen the create form with values intact
    confirmCreateModal.addEventListener('hide.bs.modal', function () {
        if (!createConfirmed) reopenCreateAfterCancel = true;
    });
    confirmCreateModal.addEventListener('hidden.bs.modal', function () {
        if (reopenCreateAfterCancel) {
            reopenCreateAfterCancel = false;
            hideFormError('confirmCreateError');
            showModal(createModal);
        }
    });

    // Edit flow
    editForm.addEventListener('submit', saveBatchChanges);
    document.getElementById('confirmEditBtn').addEventListener('click', confirmUpdate);
    document.getElementById('confirmEditCancelBtn').addEventListener('click', function () {
        hideModal(confirmEditModal);
    });

    // Cancel / close the confirmation → reopen the edit form with values intact
    confirmEditModal.addEventListener('hide.bs.modal', function () {
        if (!updateConfirmed) reopenEditAfterCancel = true;
    });
    confirmEditModal.addEventListener('hidden.bs.modal', function () {
        if (reopenEditAfterCancel) {
            reopenEditAfterCancel = false;
            hideFormError('confirmEditError');
            showModal(editModal);
        }
    });

    // Table row actions (view / edit / retry)
    tableBody.addEventListener('click', function (event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var action = button.getAttribute('data-action');
        var id = button.getAttribute('data-id');

        if (action === 'view') {
            viewBatch(id);
        } else if (action === 'edit') {
            editBatch(id);
        } else if (action === 'retry-load') {
            loadBatches();
        }
    });

    // Clear a field error as soon as the user edits it
    Object.keys(CREATE_FIELDS).forEach(function (key) {
        var el = document.getElementById(CREATE_FIELDS[key]);
        ['input', 'change'].forEach(function (evt) {
            el.addEventListener(evt, function () {
                clearFieldError(CREATE_FIELDS[key]);
            });
        });
    });
    Object.keys(EDIT_FIELDS).forEach(function (key) {
        var el = document.getElementById(EDIT_FIELDS[key]);
        ['input', 'change'].forEach(function (evt) {
            el.addEventListener(evt, function () {
                clearFieldError(EDIT_FIELDS[key]);
            });
        });
    });

    // =====================
    // Initial Load
    // =====================
    function init() {
        if (pageDataEl) {
            batches = safeParse(pageDataEl.dataset.batches, []);
            departments = safeParse(pageDataEl.dataset.departments, []);
            loadDepartments();
            renderAll();
        } else {
            loadDepartments();
            loadBatches();
        }
    }

    init();
});
