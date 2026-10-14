/* Session Management - SRAAS | Academic Management → Sessions */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var MONTHS = [
    ["Jan", "January"],
    ["Feb", "February"],
    ["Mar", "March"],
    ["Apr", "April"],
    ["May", "May"],
    ["Jun", "June"],
    ["Jul", "July"],
    ["Aug", "August"],
    ["Sep", "September"],
    ["Oct", "October"],
    ["Nov", "November"],
    ["Dec", "December"],
  ];
  var page = document.querySelector("[data-sessions-page]");
  if (!page) return;
  var sessions = safeParse(page.dataset.sessions, []) || [],
    batches = safeParse(page.dataset.batches, []) || [];
  var pendingCreate = null,
    pendingUpdate = null,
    createConfirmed = false,
    updateConfirmed = false,
    reopenCreate = false,
    reopenEdit = false;
  var body = document.getElementById("sessionsTableBody"),
    tableWrap = document.getElementById("sessionsTableWrapper"),
    empty = document.getElementById("sessionsEmptyState");
  var createModal = document.getElementById("createSessionModal"),
    editModal = document.getElementById("editSessionModal"),
    confirmCreateModal = document.getElementById("confirmCreateSessionModal"),
    confirmEditModal = document.getElementById("confirmEditSessionModal"),
    detailsModal = document.getElementById("sessionDetailsModal");
  function safeParse(v, f) {
    try {
      return JSON.parse(v);
    } catch (e) {
      return f;
    }
  }
  function escapeHtml(v) {
    var e = document.createElement("div");
    e.textContent = v == null ? "" : String(v);
    return e.innerHTML;
  }
  function text(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = v;
  }
  function showModal(m) {
    if (m) bootstrap.Modal.getOrCreateInstance(m).show();
  }
  function hideModal(m) {
    if (m) bootstrap.Modal.getOrCreateInstance(m).hide();
  }
  function showError(id, msg) {
    var e = document.getElementById(id);
    if (e) {
      e.textContent = msg || "";
      e.classList.toggle("d-none", !msg);
    }
  }
  function showToast(type, msg) {
    var c = document.getElementById("sessionsToastContainer");
    if (!c) return;
    var e = document.createElement("div");
    e.className = "alert alert-" + type + " alert-dismissible fade show";
    e.setAttribute("role", "alert");
    e.innerHTML =
      escapeHtml(msg) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>';
    c.appendChild(e);
    setTimeout(function () {
      try {
        bootstrap.Alert.getOrCreateInstance(e).close();
      } catch (x) {
        e.remove();
      }
    }, 5000);
  }
  function setLoading(b, on, label) {
    if (!b) return;
    if (on) {
      b.dataset.html = b.innerHTML;
      b.disabled = true;
      b.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2"></span>' +
        escapeHtml(label);
    } else {
      b.disabled = false;
      if (b.dataset.html) b.innerHTML = b.dataset.html;
    }
  }
  async function fetchJSON(url, opt) {
    opt = opt || {};
    var h = Object.assign({ Accept: "application/json" }, opt.headers || {});
    if (opt.body) h["Content-Type"] = "application/json";
    var r;
    try {
      r = await fetch(url, Object.assign({}, opt, { headers: h }));
    } catch (e) {
      throw new Error(
        "Unable to reach the server. Please check your connection.",
      );
    }
    var j = await r.json().catch(function () {
      return null;
    });
    if (!r.ok) {
      var e = new Error(
        (j && j.message) || "The request could not be completed.",
      );
      e.status = r.status;
      throw e;
    }
    return j;
  }
  function friendlyError(e) {
    if (!e) return "Something went wrong. Please try again.";
    if (e.status === 401)
      return "Your session has expired. Please log in again.";
    if (e.status === 404) return "The selected record was not found.";
    if (e.status === 409)
      return e.message || "A session with these details already exists.";
    if (e.status === 400)
      return e.message || "Please check the submitted values.";
    if (e.status >= 500 || /reach the server/i.test(e.message))
      return "Something went wrong on the server. Please try again later.";
    return e.message || "The request could not be completed.";
  }
  function monthLabel(v) {
    var m = MONTHS.filter(function (x) {
      return x[0].toLowerCase() === String(v || "").toLowerCase();
    })[0];
    return m ? m[1] : v || "—";
  }
  function semLabel(v) {
    return "Semester " + (v == null ? "—" : v);
  }
  function statusOf(s) {
    return AcademicFormOptions.sessionStatus(s);
  }
  function semesterOptions(id, selectedBatch, selected) {
    if (selected) selected = String(Number(selected));
    var control = document.getElementById(id), count = AcademicFormOptions.semesterCount(selectedBatch);
    control.replaceChildren(new Option(count ? 'Select semester' : 'No semester range available', ''));
    for (var number = 1; number <= count; number++) control.add(new Option('Semester ' + number, String(number)));
    if (selected && Number(selected) > count) control.add(new Option('Semester ' + selected + ' (existing)', String(selected)));
    control.value = selected ? String(selected) : '';
    control.disabled = !count && !selected;
  }
  function updateStatus(prefix) {
    var value = statusOf({ exam_session: document.getElementById(prefix + 'Month').value, exam_year: document.getElementById(prefix + 'Year').value });
    document.getElementById(prefix + 'Status').value = value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }
  function badge(st) {
    return st === "completed"
      ? "bg-success"
      : st === "active"
        ? "bg-primary"
        : "bg-warning text-dark";
  }
  function fmtDate(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d)
      ? "—"
      : d.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
  }
  function fmtDateTime(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d) ? "—" : d.toLocaleString();
  }
  function batchOf(s) {
    return (
      s.Batch ||
      batches.filter(function (b) {
        return String(b.batch_id) === String(s.batch_id);
      })[0] ||
      {}
    );
  }
  function deptOf(s) {
    var b = batchOf(s);
    return (b.Department && b.Department.department_name) || "—";
  }
  function months(select) {
    if (select)
      select.innerHTML =
        '<option value="">Select month</option>' +
        MONTHS.map(function (m) {
          return '<option value="' + m[0] + '">' + m[1] + "</option>";
        }).join("");
  }

  function renderSummary() {
    var completed = 0,
      upcoming = 0,
      active = AcademicFormOptions.currentSession(sessions);
    sessions.forEach(function (s) {
      var st = statusOf(s);
      if (st === "completed") completed++;
      if (st === "upcoming") upcoming++;
    });
    text("totalSessionsCount", sessions.length);
    text("completedSessionsCount", completed);
    text("upcomingSessionsCount", upcoming);
    text("currentSessionName", active ? semLabel(active.semester) : "No sessions");
    var currentName = document.getElementById('currentSessionName');
    text('currentSessionLabel', !active || statusOf(active) === 'active' ? 'Current Session' : statusOf(active) === 'completed' ? 'Latest Session' : 'Next Session');
    currentName.title = active ? [batchOf(active).batch_name, monthLabel(active.exam_session), active.exam_year].filter(Boolean).join(' - ') : '';
    var context = document.getElementById('currentSessionContext');
    if (context) context.textContent = active ? [batchOf(active).batch_name, monthLabel(active.exam_session) + ' ' + active.exam_year, statusOf(active)].filter(Boolean).join(' - ') : '';
  }
  function row(s) {
    var st = statusOf(s),
      b = batchOf(s),
      title = monthLabel(s.exam_session) + " " + s.exam_year;
    return (
      '<tr><td><span class="session-name">' +
      escapeHtml(title) +
      '</span><div class="session-meta">ID ' +
      escapeHtml(s.session_id) +
      "</div></td><td>" +
      escapeHtml(b.batch_name || "—") +
      '<div class="session-meta">' +
      escapeHtml(b.start_year || "") +
      " – " +
      escapeHtml(b.end_year || "") +
      "</div></td><td>" +
      escapeHtml(deptOf(s)) +
      "</td><td>" +
      escapeHtml(semLabel(s.semester)) +
      "</td><td>" +
      escapeHtml(monthLabel(s.exam_session)) +
      "</td><td>" +
      escapeHtml(s.exam_year) +
      '</td><td><span class="badge ' +
      badge(st) +
      '">' +
      escapeHtml(st.charAt(0).toUpperCase() + st.slice(1)) +
      '</span></td><td class="text-nowrap">' +
      escapeHtml(fmtDate(s.created_at)) +
      '</td><td class="text-center text-nowrap"><button type="button" class="btn btn-sm btn-outline-secondary" data-action="view" data-id="' +
      s.session_id +
      '" title="View session"><span class="material-icons action-icon">visibility</span></button> <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit" data-id="' +
      s.session_id +
      '" title="Edit session"><span class="material-icons action-icon">edit</span></button></td></tr>'
    );
  }
  function visibleSessions() {
    var q = (document.getElementById("sessionSearch").value || "")
        .trim()
        .toLowerCase(),
      st = document.getElementById("sessionStatusFilter").value,
      bid = document.getElementById("sessionBatchFilter").value;
    return sessions.filter(function (s) {
      var b = batchOf(s),
        hay = [
          semLabel(s.semester),
          b.batch_name || "",
          deptOf(s),
          s.exam_session,
          s.exam_year,
        ]
          .join(" ")
          .toLowerCase();
      return (
        (!q || hay.indexOf(q) !== -1) &&
        (st === "all" || statusOf(s) === st) &&
        (bid === "all" || String(s.batch_id) === bid)
      );
    });
  }
  function renderTable() {
    var rows = visibleSessions().sort(function (a, b) {
      return (
        Number(b.exam_year) - Number(a.exam_year) ||
        Number(a.semester) - Number(b.semester)
      );
    });
    if (!rows.length) {
      tableWrap.classList.add("d-none");
      empty.classList.remove("d-none");
      document.getElementById("sessionsEmptyTitle").textContent =
        sessions.length ? "No sessions found" : "No sessions created yet";
      document.getElementById("sessionsEmptyText").textContent = sessions.length
        ? "Try changing your search or filters."
        : "Create your first academic session to get started.";
      return;
    }
    empty.classList.add("d-none");
    tableWrap.classList.remove("d-none");
    body.innerHTML = rows.map(row).join("");
  }
  function render() {
    renderSummary();
    renderTable();
  }
  async function loadSessions() {
    body.innerHTML =
      '<tr><td colspan="9" class="text-center table-loading"><span class="spinner-border spinner-border-sm text-primary me-2"></span>Loading sessions...</td></tr>';
    try {
      var j = await fetchJSON("/sessions?format=json");
      sessions = Array.isArray(j.data) ? j.data : [];
      render();
    } catch (e) {
      body.innerHTML =
        '<tr><td colspan="9" class="text-center text-danger">' +
        escapeHtml(friendlyError(e)) +
        ' <button class="btn btn-sm btn-outline-secondary ms-2" data-action="retry">Retry</button></td></tr>';
    }
  }
  function findSession(id) {
    return sessions.filter(function (s) {
      return String(s.session_id) === String(id);
    })[0];
  }
  function openCreate() {
    document.getElementById("createSessionForm").reset();
    showError("createSessionError", "");
    var latest = AcademicFormOptions.sortBatches(batches)[0];
    document.getElementById('createSessionBatch').value = latest ? String(latest.batch_id) : '';
    semesterOptions('createSessionSemester', latest);
    document.getElementById('createSessionYear').value = new Date().getFullYear();
    updateStatus('createSession');
    showModal(createModal);
  }
  function createSession(e) {
    e.preventDefault();
    showError("createSessionError", "");
    var d = validate("createSession");
    if (!d) return;
    pendingCreate = d;
    document.getElementById("confirmCreateSessionSummary").innerHTML =
      summaryHtml(d);
    createConfirmed = false;
    hideModal(createModal);
    setTimeout(function () {
      showModal(confirmCreateModal);
    }, 180);
  }
  async function confirmCreate() {
    if (!pendingCreate) return;
    var b = document.getElementById("confirmCreateSessionBtn");
    setLoading(b, true, "Creating...");
    try {
      await fetchJSON("/sessions", {
        method: "POST",
        body: JSON.stringify(pendingCreate),
      });
      createConfirmed = true;
      pendingCreate = null;
      hideModal(confirmCreateModal);
      showToast("success", "Session created successfully.");
      await loadSessions();
    } catch (e) {
      showError("confirmCreateSessionError", friendlyError(e));
    } finally {
      setLoading(b, false, "Creating...");
    }
  }
  function editSession(id) {
    var s = findSession(id);
    if (!s) return showToast("danger", "Session not found.");
    var b = batchOf(s);
    document.getElementById("editSessionId").value = s.session_id;
    document.getElementById("editSessionBatch").value = b.batch_name || "—";
    semesterOptions('editSessionSemester', b, s.semester);
    document.getElementById('editSessionSemester').disabled = true;
    document.getElementById('editSessionSemesterNote').textContent = 'Checking configured subjects...';
    document.getElementById('editSessionSubmitBtn').disabled = true;
    fetchJSON('/subjects/session/' + encodeURIComponent(s.session_id)).then(function (response) {
      if (String(document.getElementById('editSessionId').value) !== String(s.session_id)) return;
      var subjects = Array.isArray(response) ? response : response.data || [];
      document.getElementById('editSessionSemester').disabled = subjects.length > 0;
      document.getElementById('editSessionSemesterNote').textContent = subjects.length ? 'Semester is locked because subjects are configured. Month and exam year can still be updated.' : '';
      document.getElementById('editSessionSubmitBtn').disabled = false;
    }).catch(function () {
      if (String(document.getElementById('editSessionId').value) !== String(s.session_id)) return;
      document.getElementById('editSessionSemesterNote').textContent = 'Semester is locked while subject availability cannot be checked. Month and exam year can still be updated.';
      document.getElementById('editSessionSubmitBtn').disabled = false;
    });
    var existingMonth = MONTHS.find(function (month) { return month[0].toLowerCase() === String(s.exam_session).slice(0, 3).toLowerCase(); });
    document.getElementById("editSessionMonth").value = existingMonth ? existingMonth[0] : '';
    document.getElementById("editSessionYear").value = s.exam_year;
    updateStatus('editSession');
    showError("editSessionError", "");
    showModal(editModal);
  }
  function saveSessionChanges(e) {
    e.preventDefault();
    showError("editSessionError", "");
    var sm = document.getElementById("editSessionSemester"),
      mo = document.getElementById("editSessionMonth"),
      yr = document.getElementById("editSessionYear"),
      sn = Number(sm.value),
      yn = Number(yr.value),
      valid = true;
    var existing = findSession(document.getElementById('editSessionId').value);
    var maximum = AcademicFormOptions.semesterCount(batchOf(existing || {}));
    if (invalid(sm, !sm.value || !Number.isInteger(sn) || sn < 1 || (sn > maximum && String(sn) !== String(existing?.semester)) ? 'Select a semester for this batch.' : '')) valid = false;
    if (invalid(mo, !mo.value ? 'Select a month.' : '')) valid = false;
    if (invalid(yr, !yr.value || !Number.isInteger(yn) || yn < 1900 || yn > 2200 ? 'Enter a valid exam year.' : '')) valid = false;
    if (!valid) return;
    var s = findSession(document.getElementById("editSessionId").value);
    if (!s) return showError("editSessionError", "Session not found.");
    pendingUpdate = Object.assign({}, s, {
      semester: String(sn),
      exam_session: mo.value,
      exam_year: yn,
    });
    document.getElementById("confirmEditSessionSummary").innerHTML =
      summaryHtml(pendingUpdate);
    updateConfirmed = false;
    hideModal(editModal);
    setTimeout(function () {
      showModal(confirmEditModal);
    }, 180);
  }
  async function confirmUpdate() {
    if (!pendingUpdate) return;
    var b = document.getElementById("confirmEditSessionBtn");
    setLoading(b, true, "Saving...");
    try {
      await fetchJSON("/sessions/" + pendingUpdate.session_id, {
        method: "PUT",
        body: JSON.stringify({
          semester: pendingUpdate.semester,
          exam_session: pendingUpdate.exam_session,
          exam_year: pendingUpdate.exam_year,
        }),
      });
      updateConfirmed = true;
      pendingUpdate = null;
      hideModal(confirmEditModal);
      showToast("success", "Session updated successfully.");
      await loadSessions();
    } catch (e) {
      showError("confirmEditSessionError", friendlyError(e));
    } finally {
      setLoading(b, false, "Saving...");
    }
  }
  async function viewSession(id) {
    showError("sessionDetailsError", "");
    document.getElementById("sessionDetailsLoading").classList.remove("d-none");
    document.getElementById("sessionDetailsList").classList.add("d-none");
    showModal(detailsModal);
    try {
      var j = await fetchJSON("/sessions/" + id),
        s = j.data,
        b = batchOf(s),
        st = statusOf(s),
        values = [
          ["Session ID", s.session_id],
          ["Session UUID", s.session_uuid],
          ["Batch", b.batch_name],
          ["Department", deptOf(s)],
          ["Semester", semLabel(s.semester)],
          ["Month", monthLabel(s.exam_session)],
          ["Exam Year", s.exam_year],
          ["Status", st.charAt(0).toUpperCase() + st.slice(1)],
          ["Created At", fmtDateTime(s.created_at)],
          ["Updated At", fmtDateTime(s.updated_at)],
        ];
      document.getElementById("sessionDetailsList").innerHTML = values
        .map(function (x) {
          return (
            '<div class="batch-summary-row"><span class="batch-summary-label">' +
            x[0] +
            '</span><span class="batch-summary-value">' +
            escapeHtml(x[1]) +
            "</span></div>"
          );
        })
        .join("");
      document.getElementById("sessionDetailsLoading").classList.add("d-none");
      document.getElementById("sessionDetailsList").classList.remove("d-none");
    } catch (e) {
      document.getElementById("sessionDetailsLoading").classList.add("d-none");
      showError("sessionDetailsError", friendlyError(e));
    }
  }

  function summaryHtml(d) {
    var b = batchOf(d),
      st = statusOf(d);
    return [
      ["Batch", b.batch_name || "—"],
      ["Department", deptOf(d)],
      ["Semester", semLabel(d.semester)],
      ["Month", monthLabel(d.exam_session)],
      ["Exam Year", d.exam_year],
      ["Status", st.charAt(0).toUpperCase() + st.slice(1)],
    ]
      .map(function (x) {
        return (
          '<div class="batch-summary-row"><span class="batch-summary-label">' +
          x[0] +
          '</span><span class="batch-summary-value">' +
          escapeHtml(x[1]) +
          "</span></div>"
        );
      })
      .join("");
  }
  function invalid(el, msg) {
    if (!el) return false;
    el.classList.toggle("is-invalid", !!msg);
    if (msg) {
      var f =
        el.parentElement && el.parentElement.querySelector(".invalid-feedback");
      if (f) f.textContent = msg;
    }
    return !!msg;
  }
  function validate(prefix) {
    var b = document.getElementById(prefix + "Batch"),
      sm = document.getElementById(prefix + "Semester"),
      mo = document.getElementById(prefix + "Month"),
      yr = document.getElementById(prefix + "Year"),
      valid = true;
    if (invalid(b, !b.value ? "Select a batch." : '')) valid = false;
    var sn = Number(sm.value);
    var selectedBatch = batches.find(function (value) { return String(value.batch_id) === b.value; });
    var semesterLimit = AcademicFormOptions.semesterCount(selectedBatch);
    if (invalid(sm, !sm.value || !Number.isInteger(sn) || sn < 1 || sn > semesterLimit ? 'Select a semester for this batch.' : '')) valid = false;
    if (invalid(mo, !mo.value ? "Select a month." : '')) valid = false;
    var yn = Number(yr.value);
    if (invalid(yr, !yr.value || !Number.isInteger(yn) || yn < 1900 || yn > 2200 ? 'Enter a valid exam year.' : '')) valid = false;
    if (!valid) return null;
    if (
      prefix === "createSession" &&
      sessions.some(function (s) {
        return (
          String(s.batch_id) === b.value &&
          Number(s.semester) === sn &&
          String(s.exam_session).toLowerCase() === String(mo.value).toLowerCase() &&
          Number(s.exam_year) === yn
        );
      })
    ) {
      invalid(sm, "This examination session already exists.");
      showError(
        "createSessionError",
        "This examination session already exists.",
      );
      return null;
    }
    return {
      batch_id: b.value,
      semester: String(sn),
      exam_session: mo.value,
      exam_year: yn,
    };
  }
  months(document.getElementById("createSessionMonth"));
  months(document.getElementById("editSessionMonth"));
  document.getElementById('createSessionBatch').addEventListener('change', function () {
    semesterOptions('createSessionSemester', batches.find(function (value) { return String(value.batch_id) === this.value; }, this));
  });
  ['createSession', 'editSession'].forEach(function (prefix) {
    ['Month', 'Year'].forEach(function (name) {
      ['input', 'change'].forEach(function (event) { document.getElementById(prefix + name).addEventListener(event, function () { updateStatus(prefix); }); });
    });
  });
  document
    .getElementById("createSessionHeaderBtn")
    .addEventListener("click", openCreate);
  document
    .getElementById("emptyStateCreateSessionBtn")
    .addEventListener("click", openCreate);
  document
    .getElementById("createSessionForm")
    .addEventListener("submit", createSession);
  document
    .getElementById("confirmCreateSessionBtn")
    .addEventListener("click", confirmCreate);
  document
    .getElementById("editSessionForm")
    .addEventListener("submit", saveSessionChanges);
  document
    .getElementById("confirmEditSessionBtn")
    .addEventListener("click", confirmUpdate);
  document
    .getElementById("confirmCreateSessionCancelBtn")
    .addEventListener("click", function () {
      hideModal(confirmCreateModal);
    });
  document
    .getElementById("confirmEditSessionCancelBtn")
    .addEventListener("click", function () {
      hideModal(confirmEditModal);
    });
  confirmCreateModal.addEventListener("hide.bs.modal", function () {
    if (!createConfirmed) reopenCreate = true;
  });
  confirmCreateModal.addEventListener("hidden.bs.modal", function () {
    if (reopenCreate) {
      reopenCreate = false;
      showError("confirmCreateSessionError", "");
      showModal(createModal);
    }
  });
  confirmEditModal.addEventListener("hide.bs.modal", function () {
    if (!updateConfirmed) reopenEdit = true;
  });
  confirmEditModal.addEventListener("hidden.bs.modal", function () {
    if (reopenEdit) {
      reopenEdit = false;
      showError("confirmEditSessionError", "");
      showModal(editModal);
    }
  });
  body.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (!b) return;
    var a = b.dataset.action,
      id = b.dataset.id;
    if (a === "view") viewSession(id);
    else if (a === "edit") editSession(id);
    else if (a === "retry") loadSessions();
  });
  ["sessionSearch", "sessionStatusFilter", "sessionBatchFilter"].forEach(
    function (id) {
      document
        .getElementById(id)
        .addEventListener(
          id === "sessionSearch" ? "input" : "change",
          renderTable,
        );
    },
  );
  [
    "createSessionSemester",
    "createSessionMonth",
    "createSessionYear",
    "editSessionSemester",
    "editSessionMonth",
    "editSessionYear",
  ].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      this.classList.remove("is-invalid");
    });
  });
  render();
  loadSessions();
});
