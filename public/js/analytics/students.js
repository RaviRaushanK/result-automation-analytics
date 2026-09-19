/** Student rows retain stored parent GPA and status; subject outcomes are mode-aware. */
(function () {
  'use strict';
  window.AnalyticsPage({
    page: 'students', columns: 11,
    render: function (result, ui) {
      var rows = result.data || [];
      rows.forEach(function (r) {
        ui.row([r.usn, r.studentName, r.semester, r.attemptNo, r.examType,
          ui.number(r.subjectsAttempted, 0), ui.number(r.passed, 0), ui.number(r.failed, 0),
          ui.number(r.sgpa), ui.number(r.cgpa), r.parentStatus]);
      });
      return rows.length;
    }
  });
})();

