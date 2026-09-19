/** Semester comparison using the existing analytics service response. */
(function () {
  'use strict';
  window.AnalyticsPage({
    page: 'semesters',
    columns: 11,
    charts: ['semesters-trend-chart'],
    render: function (result, ui) {
      var rows = result.data || [];
      rows.forEach(function (r) {
        ui.row([
          r.examYear, r.examSession, r.semester,
          (r.batchName != null ? r.batchName : r.batchId),
          ui.number(r.resultCount, 0), ui.number(r.subjectAttempts, 0),
          ui.number(r.subjectPassed, 0), ui.number(r.subjectFailed, 0),
          r.subjectPassPercentage == null ? '\u2014' : ui.number(r.subjectPassPercentage, 1) + '%',
          ui.number(r.avgSgpa), ui.number(r.avgCgpa)
        ]);
      });
      ui.chart('semesters-trend-chart', rows.map(function (r) {
        return [r.examYear, r.examSession, r.semester, r.batchName].filter(function (v) { return v != null; }).join(' / ');
      }), [{
        label: 'Subject pass %',
        data: rows.map(function (r) { return r.subjectPassPercentage; }),
        backgroundColor: '#2563eb'
      }]);
      return rows.length;
    }
  });
})();

