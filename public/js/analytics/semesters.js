/** Semester comparison using the existing analytics service response. */
(function () {
  'use strict';
  window.AnalyticsPage({
    page: 'semesters',
    columns: 10,
    charts: ['semesters-trend-chart', 'semesters-gpa-chart'],
    render: function (result, ui) {
      var rows = result.data || [];
      // Same axis label for both charts: Batch / Result Session / Semester.
      function label(r) {
        return [(r.batchName != null ? r.batchName : r.batchId),
          [r.examSession, r.examYear].filter(function (v) { return v != null && v !== ''; }).join(' '),
          r.semester].filter(function (v) { return v != null && v !== ''; }).join(' / ');
      }
      rows.forEach(function (r) {
        ui.row([
          (r.batchName != null ? r.batchName : r.batchId),
          [r.examSession, r.examYear].filter(function (v) { return v != null && v !== ''; }).join(' '),
          r.semester,
          ui.number(r.resultCount, 0), ui.number(r.subjectAttempts, 0),
          ui.number(r.subjectPassed, 0), ui.number(r.subjectFailed, 0),
          r.subjectPassPercentage == null ? '\u2014' : ui.number(r.subjectPassPercentage, 1) + '%',
          ui.number(r.avgSgpa), ui.number(r.avgCgpa)
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
      // Second chart beside Session Trends: stored GPA values per session.
      // Line type lets Chart.js span the same session labels with null-safe points.
      ui.chart('semesters-gpa-chart', rows.map(label), [
        {
          type: 'line', label: 'Average SGPA', data: rows.map(function (r) { return r.avgSgpa; }),
          borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.15)',
          pointBackgroundColor: '#2563eb', pointRadius: 4, tension: 0.3, fill: false
        },
        {
          type: 'line', label: 'Average CGPA', data: rows.map(function (r) { return r.avgCgpa; }),
          borderColor: '#7c3aed', backgroundColor: 'rgba(124, 58, 237, 0.15)',
          pointBackgroundColor: '#7c3aed', pointRadius: 4, tension: 0.3, fill: false
        }
      ]);
      return rows.length;
    }
  });
})();

