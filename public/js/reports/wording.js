(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportWording = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var gpa = 'Stored values; unchanged by revaluation.';
  var marks = 'Same-attempt approved revaluation; revised components use original fallbacks. Unreconciled components remain unavailable.';
  function visible(context, type, generatedAt) {
    var hasGpa = context.some(function (pair) { return pair[0] === 'GPA Basis'; });
    var result = context.filter(function (pair) {
      if (type && ['Programme', 'GPA Basis', 'SGPA Basis', 'Marks Basis', 'Ranking Basis'].includes(pair[0])) return false;
      return !['Eligibility', 'Tie Order', 'Participation Basis', 'Calculation details'].includes(pair[0]) && !(hasGpa && pair[0] === 'SGPA Basis');
    }).map(function (pair) {
      if (type && pair[0] === 'Generated At') return ['Generated at', pair[1]];
      return pair;
    });
    if (type && generatedAt && !result.some(function (pair) { return ['Generated at', 'Generated At'].includes(pair[0]); }))
      result.push(['Generated at', generatedAt]);
    return result;
  }
  function details(report, compact) {
    if (compact) {
      var effective = report.filters?.mode === 'effective';
      var gpaNote = 'GPA: saved values, unchanged by revaluation.';
      var marksNote = effective
        ? 'Marks: approved revaluation for this attempt; otherwise original marks. Dash = unavailable.'
        : 'Marks: original values for each selected attempt.';
      if (report.type === 'toppers') return ['Ranking: passed attempts, highest saved CGPA first.', gpaNote];
      if (['student', 'subject', 'consolidated'].includes(report.type)) return [marksNote,
        report.type === 'subject' ? 'Attempts: backlog results stay separate.' : 'Backlog results stay separate. ' + gpaNote];
      if (report.type === 'class') return [
        effective ? 'Results: approved revaluation is included for each selected attempt.' : 'Results: original values for each selected attempt.',
        'Attempts: backlog results stay separate.'
      ];
      if (report.type === 'revaluation') return [
        'Changes: original and revised marks for the same attempt.',
        'Results change only after approval and when the revision is active.'
      ];
      if (report.type === 'result-analysis') return [
        'Counts: exam attempts, not unique students.',
        effective ? 'Results: includes approved revaluation for each attempt.' : 'Results: original values before revaluation.'
      ];
      if (report.type === 'student-progress') return [
        effective ? 'Completion: uses attempt history, including backlog and approved revaluation.' : 'Completion: uses original attempt history, including backlog.',
        'Dash = not enough verified history to show completion or CGPA.'
      ];
      return [];
    }
    var saved = (report.context || []).filter(function (pair) { return pair[0] === 'Calculation details'; });
    if (saved.length) return saved.map(function (pair) { return pair[1]; });
    var lines = (report.context || []).filter(function (pair) { return ['Eligibility', 'Tie Order', 'Participation Basis'].includes(pair[0]); })
      .map(function (pair) { return pair[0] + ': ' + pair[1]; });
    if (['student', 'class', 'toppers', 'consolidated'].includes(report.type)) lines.push('SGPA/CGPA are saved original result values, not recalculated after revaluation. Historical GPA may lack verified cumulative course history; displaying a value does not certify that history.');
    if (report.type === 'consolidated' && report.filters.mode === 'effective') lines.push('Original components remain preserved. Effective cells use approved revisions with original fallbacks only when they reconcile with the approved total. A dash means component marks are unavailable or cannot be reconciled with the approved total. No component is inferred.');
    if (report.type === 'revaluation') lines.push('This report lists revaluation events. Pending, rejected and approved non-effective events do not change the current effective outcome. Original and revised marks are totals.');
    if (['student', 'subject', 'consolidated'].includes(report.type) && report.filters.mode === 'effective') lines.push('Approved effective revaluation applies only to the same Result/SubjectResult attempt. Explicit revised IA/EX override original components; absent revised components fall back to original stored values. Unreconciled component cells remain unavailable, while the approved total, grade and result remain authoritative. Backlog attempts remain separate.');
    if (['class', 'toppers', 'consolidated'].includes(report.type)) lines.push('Rows represent result attempts; a student may appear more than once when multiple attempts are selected.');
    return lines;
  }
  function metricLabel(label) {
    return ({ 'Eligible Result Attempts': 'Eligible attempts', 'Highest Stored CGPA': 'Top CGPA',
      'Total Result Rows': 'Result attempts', 'Total Revaluation Events': 'Events',
      'Semesters Available': 'Semesters', 'Stored Failed Subject Count': 'Stored failed subjects' })[label] || label;
  }
  return { gpa: gpa, marks: marks, visible: visible, details: details, metricLabel: metricLabel };
});
