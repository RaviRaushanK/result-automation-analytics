/** Revaluation aggregates, not individual application or student records. */
(function () {
  'use strict';
  function metric(name, value) {
    var el = document.querySelector('[data-metric="pipeline-' + name + '"] .analytics-summary-value');
    if (!el) return;
    el.textContent = value;
    el.classList.remove('analytics-value-placeholder');
    el.removeAttribute('aria-hidden');
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
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var cells = [
        row.subjectLabel || '\u2014',
        ui.number(row.cases, 0),
        ui.number(row.subjectsWithRevaluation, 0),
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

  function renderDetail(result, ui, tbody) {
    var rows = result.detail || [];
    if (!rows.length) {
      var empty = document.createElement('tr');
      empty.className = 'analytics-table-empty-row';
      var td = document.createElement('td');
      td.className = 'analytics-table-empty';
      td.colSpan = 13;
      td.textContent = 'No individual revaluation event rows match the current filters.';
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var cells = [
        row.subjectLabel || '\u2014',
        row.studentLabel || '\u2014',
        row.studentName || '\u2014',
        row.caseId || '\u2014',
        fmtNum(row.originalMarks),
        fmtNum(row.revisedMarks),
        fmtDelta(row.delta),
        row.originalStatus || '\u2014',
        row.revisedStatus || '\u2014',
        row.validationStatus || '\u2014',
        row.remarkType || '\u2014',
        row.remarkSummary || '\u2014',
        row.sourceFile || row.eventProvenance || '\u2014'
      ];
      cells.forEach(function (val) {
        var cell = document.createElement('td');
        cell.textContent = val;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
  }

  window.AnalyticsPage({
    page: 'revaluation', columns: 2,
    clear: function () {
      ['pending', 'approved', 'rejected'].forEach(function (name) { metric(name, '\u2014'); });
      document.getElementById('revaluation-integrity').textContent = '';
      clearTable('revaluation-by-subject-body', 11);
      clearTable('revaluation-detail-body', 13);
    },
    render: function (result, ui) {
      var pipeline = result.pipeline || [];
      ['pending', 'approved', 'rejected'].forEach(function (name) {
        var item = pipeline.find(function (r) { return r.revaluationStatus === name; });
        metric(name, ui.number(item ? item.rowCount : 0, 0));
      });
      var outcomes = result.outcomes || {};
      [
        ['cases', 'Cases'], ['subjectsWithRevaluation', 'Subjects with revaluation'],
        ['statusChanges', 'Status changes'], ['failToPass', 'Fail to pass'],
        ['passToFail', 'Pass to fail'], ['positiveDelta', 'Positive mark delta'],
        ['unchanged', 'Unchanged marks'], ['negativeDelta', 'Negative mark delta'],
        ['averageDelta', 'Average mark delta'], ['maxDelta', 'Maximum mark delta'],
        ['minDelta', 'Minimum mark delta']
      ].forEach(function (field) { ui.row([field[1], ui.number(outcomes[field[0]])]); });
      var integrity = result.effectiveIntegrity || {};
      document.getElementById('revaluation-integrity').textContent =
        'Effective overlay subjects: ' + ui.number(integrity.effectiveOverlaySubjects, 0) +
        '. Multiple-effective-row anomalies: ' + ui.number(integrity.anomalies, 0) + '.';
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
      if (detailBody) { clearTable('revaluation-detail-body', 13); }
      Promise.all([
        fetch('/analytics/api/revaluation/by-subject?' + query, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (bySubjBody) renderBySubject(d, ui, bySubjBody); })
          .catch(function () {}),
        fetch('/analytics/api/revaluation/detail?' + query, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (detailBody) renderDetail(d, ui, detailBody); })
          .catch(function () {})
      ]).catch(function () {});
    }
  });
})();

