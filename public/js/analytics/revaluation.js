/** Revaluation aggregates, not individual application or student records. */
(function () {
  'use strict';
  function metric(name, value) {
    var el = document.querySelector('[data-metric="pipeline-' + name + '"] .stat-value');
    if (!el) return;
    el.textContent = value;
    el.classList.remove('analytics-value-placeholder');
    el.removeAttribute('aria-hidden');
  }

  function refreshTable(tableId) {
    if (window.AnalyticsTable) window.AnalyticsTable.refresh(tableId);
  }

  function resetCharts() {
    if (!window.AnalyticsCharts) return;
    window.AnalyticsCharts.render('revaluation-pipeline-chart', {
      type: 'doughnut',
      labels: [],
      datasets: [],
      emptyMessage: 'Apply filters to view pipeline status.'
    });
    window.AnalyticsCharts.render('revaluation-delta-chart', {
      type: 'bar',
      labels: [],
      datasets: [],
      emptyMessage: 'Apply filters to view mark movement.',
      scroll: false
    });
  }

  function populateStatusFilter() {
    var select = document.getElementById('filter-revaluation-status');
    if (!select || select.options.length > 1) return;
    [
      ['pending', 'Pending'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected']
    ].forEach(function (status) {
      var option = document.createElement('option');
      option.value = status[0];
      option.textContent = status[1];
      select.appendChild(option);
    });
  }

  function clearTable(tbodyId, colspan) {
    var tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    var empty = document.createElement('tr');
    empty.className = 'analytics-table-empty-row';
    var td = document.createElement('td');
    td.className = 'analytics-table-empty';
    td.colSpan = colspan;
    td.textContent = 'Select filters and apply them to view analytics.';
    empty.appendChild(td);
    tbody.appendChild(empty);
  }

  function renderBySubject(result, ui, tbody) {
    var rows = result.bySubject || [];
    if (!rows.length) {
      var empty = document.createElement('tr');
      empty.className = 'analytics-table-empty-row';
      var td = document.createElement('td');
      td.className = 'analytics-table-empty';
      td.colSpan = 11;
      td.textContent = 'No matching revaluation outcome rows for the current filters.';
      empty.appendChild(td);
      tbody.appendChild(empty);
      refreshTable('revaluation-by-subject-table');
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var cells = [
        row.subjectLabel || '\u2014',
        ui.number(row.cases, 0),
        ui.number(row.statusChanges, 0),
        ui.number(row.failToPass, 0),
        ui.number(row.passToFail, 0),
        ui.number(row.positiveDelta, 0),
        ui.number(row.unchanged, 0),
        ui.number(row.negativeDelta, 0),
        ui.number(row.averageDelta, 0),
        ui.number(row.maxDelta, 0),
        ui.number(row.minDelta, 0)
      ];
      cells.forEach(function (val) {
        var cell = document.createElement('td');
        cell.textContent = val;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    refreshTable('revaluation-by-subject-table');
  }

  function fmtNum(v) {
    if (v == null || v === '') return '\u2014';
    return v;
  }

  function fmtDelta(v) {
    if (v == null || v === '') return '\u2014';
    if (v > 0) return '+' + v;
    return v;
  }

  function statusText(value) {
    if (!value) return '\u2014';
    return String(value).replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function textNode(tag, text, className) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function identity(primary, secondary) {
    var box = document.createElement('div');
    box.appendChild(textNode('span', primary || '\u2014', 'revaluation-identity'));
    if (secondary && secondary !== primary) box.appendChild(textNode('small', secondary, 'revaluation-secondary'));
    return box;
  }

  function auditDetails(row) {
    var action = document.createElement('div');
    var button = textNode('button', 'View references', 'btn btn-sm btn-outline-secondary analytics-audit-button');
    button.type = 'button';
    button.setAttribute('data-bs-toggle', 'modal');
    button.setAttribute('data-bs-target', '#revaluation-audit-modal');
    button.setAttribute('aria-label', 'View audit references for ' + (row.studentName || row.usn || 'student') + ', ' + (row.subjectName || row.subjectLabel || row.subjectCode || 'subject'));
    var list = document.createElement('dl');
    function item(label, value) {
      if (value == null || value === '') return;
      list.appendChild(textNode('dt', label));
      list.appendChild(textNode('dd', String(value)));
    }
    item('Revaluation record ID', row.caseId);
    item('Approval status', statusText(row.validationStatus));
    var raw = String(row.remarkSummary || '').trim(), metadata;
    if (/^[{\[]/.test(raw)) {
      try { metadata = JSON.parse(raw); } catch (e) { /* Keep unreadable metadata out of the main table. */ }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) item('Additional references', 'Unavailable for this record.');
      else {
        if (Number.isSafeInteger(metadata.import_id) && metadata.import_id > 0) item('Import record ID', metadata.import_id);
        if (metadata.decision === 'accept' || metadata.decision === 'reject') item('Review decision', metadata.decision === 'accept' ? 'Accepted' : 'Rejected');
        if (metadata.was_manual_correction === true) item('Review', 'Manually corrected');
      }
    } else if (raw) item('Remarks', raw);
    if (row.sourceFile) item('Source document', String(row.sourceFile).split(/[\\/]/).pop());
    button.addEventListener('click', function () {
      document.getElementById('revaluation-audit-identity').replaceChildren(
        identity(row.studentName || row.studentLabel, row.usn), identity(row.subjectName || row.subjectLabel, row.subjectCode));
      document.getElementById('revaluation-audit-content').replaceChildren(list);
    });
    action.appendChild(button);
    // Keep the existing reference search useful without expanding the table.
    action.appendChild(textNode('span', list.textContent, 'visually-hidden'));
    return action;
  }

  function renderDetail(result, ui, tbody) {
    var rows = result.detail || [];
    if (!rows.length) {
      var empty = document.createElement('tr');
      empty.className = 'analytics-table-empty-row';
      var td = document.createElement('td');
      td.className = 'analytics-table-empty';
      td.colSpan = 7;
      td.textContent = 'No individual revaluation event rows match the current filters.';
      empty.appendChild(td);
      tbody.appendChild(empty);
      refreshTable('revaluation-detail-table');
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var cells = [
        identity(row.subjectName || row.subjectLabel, row.subjectCode),
        identity(row.studentName || row.studentLabel, row.usn),
        fmtNum(row.originalMarks),
        fmtNum(row.revisedMarks),
        fmtDelta(row.delta),
        statusText(row.originalStatus) + ' \u2192 ' + statusText(row.revisedStatus),
        auditDetails(row)
      ];
      cells.forEach(function (val) {
        var cell = document.createElement('td');
        if (val && typeof val === 'object') cell.appendChild(val);
        else cell.textContent = val;
        if ([2, 3, 4].includes(tr.children.length)) cell.setAttribute('data-sort-value', String(val));
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    refreshTable('revaluation-detail-table');
  }

  function renderCharts(result) {
    var api = window.AnalyticsCharts;
    if (!api) return;

    var pipeline = result.pipeline || [];
    var statusOrder = [
      ['pending', 'Pending', 'amber'],
      ['approved', 'Approved', 'green'],
      ['rejected', 'Rejected', 'red']
    ];
    var pipelineValues = statusOrder.map(function (entry) {
      var item = pipeline.find(function (r) { return r.revaluationStatus === entry[0]; });
      return item ? Number(item.rowCount) || 0 : 0;
    });
    api.render('revaluation-pipeline-chart', {
      type: 'doughnut',
      labels: statusOrder.map(function (entry) { return entry[1]; }),
      datasets: [{
        label: 'Revaluation records',
        type: 'doughnut',
        colors: statusOrder.map(function (entry) { return entry[2]; }),
        data: pipelineValues
      }],
      decimals: 0,
      emptyMessage: 'No pipeline rows found for the current filters.'
    });

    var outcomes = result.outcomes || {};
    api.render('revaluation-delta-chart', {
      type: 'bar',
      labels: ['Marks increased', 'Marks unchanged', 'Marks decreased', 'Fail to Pass', 'Pass to Fail'],
      datasets: [{
        label: 'Applied revaluations',
        palette: true,
        data: [
          outcomes.positiveDelta,
          outcomes.unchanged,
          outcomes.negativeDelta,
          outcomes.failToPass,
          outcomes.passToFail
        ]
      }],
      decimals: 0,
      emptyMessage: 'No mark movement found for the current filters.',
      scroll: false
    });
  }

  if (window.AnalyticsTable) {
    window.AnalyticsTable.enhance('revaluation-by-subject-table', {
      search: 'revaluation-by-subject-search',
      count: 'revaluation-by-subject-count',
      rowLabel: 'subjects'
    });
    window.AnalyticsTable.enhance('revaluation-detail-table', {
      search: 'revaluation-detail-search',
      count: 'revaluation-detail-count',
      rowLabel: 'events'
    });
  }
  populateStatusFilter();

  window.AnalyticsPage({
    page: 'revaluation', columns: 2,
    clear: function () {
      ['pending', 'approved', 'rejected'].forEach(function (name) { metric(name, '\u2014'); });
      document.getElementById('revaluation-integrity').textContent = '';
      clearTable('revaluation-by-subject-body', 11);
      clearTable('revaluation-detail-body', 7);
      resetCharts();
      refreshTable('revaluation-by-subject-table');
      refreshTable('revaluation-detail-table');
    },
    render: function (result, ui) {
      var pipeline = result.pipeline || [];
      ['pending', 'approved', 'rejected'].forEach(function (name) {
        var item = pipeline.find(function (r) { return r.revaluationStatus === name; });
        metric(name, ui.number(item ? item.rowCount : 0, 0));
      });
      var outcomes = result.outcomes || {};
      [
        ['cases', 'Applied revaluations'], ['subjectsWithRevaluation', 'Student subject results affected'],
        ['statusChanges', 'Results with a changed status'], ['failToPass', 'Results changed from fail to pass'],
        ['passToFail', 'Results changed from pass to fail'], ['positiveDelta', 'Results with increased marks'],
        ['unchanged', 'Results with unchanged marks'], ['negativeDelta', 'Results with decreased marks'],
        ['averageDelta', 'Average change in marks'], ['maxDelta', 'Maximum change in marks'],
        ['minDelta', 'Minimum change in marks']
      ].forEach(function (field) { ui.row([field[1], ui.number(outcomes[field[0]])]); });
      var integrity = result.effectiveIntegrity || {};
      document.getElementById('revaluation-integrity').textContent =
        'Student subject results with an applied revaluation: ' + ui.number(integrity.effectiveOverlaySubjects, 0) +
        '. Student subject results with more than one approved revaluation marked as applied: ' + ui.number(integrity.anomalies, 0) + '.';
      renderCharts(result);
      return 11;
    },
    done: function (result, ui) {
      var params = ui.params || {};
      var query = '';
      if (params && typeof params.toString === 'function') {
        query = params.toString();
      }
      var bySubjBody = document.getElementById('revaluation-by-subject-body');
      var detailBody = document.getElementById('revaluation-detail-body');
      if (!bySubjBody && !detailBody) return;
      if (bySubjBody) { clearTable('revaluation-by-subject-body', 11); }
      if (detailBody) { clearTable('revaluation-detail-body', 7); }
      refreshTable('revaluation-by-subject-table');
      refreshTable('revaluation-detail-table');
      Promise.all([
        fetch('/analytics/api/revaluation/by-subject?' + query, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!bySubjBody) return;
            bySubjBody.innerHTML = '';
            renderBySubject(d, ui, bySubjBody);
          })
          .catch(function () { refreshTable('revaluation-by-subject-table'); }),
        fetch('/analytics/api/revaluation/detail?' + query, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!detailBody) return;
            detailBody.innerHTML = '';
            renderDetail(d, ui, detailBody);
          })
          .catch(function () { refreshTable('revaluation-detail-table'); })
      ]).catch(function () {});
    }
  });
})();

