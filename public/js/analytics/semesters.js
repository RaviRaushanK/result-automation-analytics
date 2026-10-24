/** Semester comparison using the existing analytics service response. */
(function () {
  'use strict';
  window.AnalyticsPage({
    page: 'semesters',
    columns: 10,
    charts: ['semesters-trend-chart', 'semesters-gpa-chart'],
    gpaCharts: ['semesters-gpa-chart'],
    render: function (result, ui) {
      var rows = result.data || [];
      // Each category is an independent exam-session group, not one student's progression.
      function label(r) {
        return [[(r.batchName != null ? r.batchName : r.batchId), r.semester == null ? '' : 'Sem ' + r.semester].filter(Boolean).join(' | '),
          r.examPeriod || [r.examSession, r.examYear].filter(function (v) { return v != null && v !== ''; }).join(' '),
          r.resultCount == null ? '' : r.resultCount + (Number(r.resultCount) === 1 ? ' result attempt' : ' result attempts')].filter(function (v) { return v != null && v !== ''; });
      }
      function chartGpa(value) {
        if (value == null || (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
        var numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      }
      rows.forEach(function (r) {
        ui.row([
          (r.batchName != null ? r.batchName : r.batchId),
          r.examPeriod || [r.examSession, r.examYear].filter(function (v) { return v != null && v !== ''; }).join(' '),
          r.semester,
          ui.number(r.resultCount, 0), ui.number(r.subjectAttempts, 0),
          ui.number(r.subjectPassed, 0), ui.number(r.subjectFailed, 0),
          r.subjectPassPercentage == null ? '\u2014' : ui.number(r.subjectPassPercentage, 1) + '%',
          GpaFormat.format(r.avgSgpa), GpaFormat.format(r.avgCgpa)
        ]);
      });
      ui.chart('semesters-trend-chart', rows.map(label), [{
        label: 'Subject pass %',
        data: rows.map(function (r) { return r.subjectPassPercentage; }),
        backgroundColor: '#2563eb',
        // Keep bars neat: with few sessions Chart.js otherwise stretches
        // each bar to fill the category width.
        maxBarThickness: 64,
        barPercentage: 0.75,
        categoryPercentage: 0.8
      }]);
      // Separate bars avoid connecting different cohorts as an individual trend.
      // Missing SGPA remains missing; stored backlog CGPA is not removed or recalculated.
      ui.chart('semesters-gpa-chart', rows.map(label), [
        {
          type: 'bar', label: 'Average stored SGPA', data: rows.map(function (r) { return chartGpa(r.avgSgpa); }),
          borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.72)',
          borderWidth: 1, maxBarThickness: 40
        },
        {
          type: 'bar', label: 'Average stored CGPA', data: rows.map(function (r) { return chartGpa(r.avgCgpa); }),
          borderColor: '#7c3aed', backgroundColor: 'rgba(124, 58, 237, 0.72)',
          borderWidth: 1, maxBarThickness: 40
        }
      ]);
      return rows.length;
    }
  });
})();

