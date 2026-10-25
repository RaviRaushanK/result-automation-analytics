(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportWording = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var gpa = 'Stored values; unchanged by revaluation.';
  var marks = 'Approved effective marks; missing components are not estimated.';
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
      if (report.type === 'toppers') return ['Original CGPA, highest first. Passed attempts only.'];
      if (report.type === 'consolidated') return [effective
        ? 'Approved effective marks; GPA remains original. A dash means unavailable.' : 'Original marks and GPA.'];
      if (report.type === 'revaluation') return ['Only approved effective revisions affect results.'];
      if (report.type === 'result-analysis') return ['Counts represent result attempts.'];
      if (report.type === 'student-progress') return [
        'Marks: first regular sitting. Backlog: later clearance.',
        'CGPA and completion require verified history. Missing or unverified semesters: unavailable.'
      ];
      var notes = ['student', 'class'].includes(report.type) ? ['SGPA/CGPA: original values.'] : [];
      if (effective && ['student', 'subject'].includes(report.type)) notes.push('IA/EX: original. Total, grade and result: effective.');
      return notes;
    }
    var saved = (report.context || []).filter(function (pair) { return pair[0] === 'Calculation details'; });
    if (saved.length) return saved.map(function (pair) { return pair[1]; });
    var lines = (report.context || []).filter(function (pair) { return ['Eligibility', 'Tie Order', 'Participation Basis'].includes(pair[0]); })
      .map(function (pair) { return pair[0] + ': ' + pair[1]; });
    if (['student', 'class', 'toppers', 'consolidated'].includes(report.type)) lines.push('SGPA/CGPA are saved original result values, not recalculated after revaluation. Historical GPA may lack verified cumulative course history; displaying a value does not certify that history.');
    if (report.type === 'consolidated' && report.filters.mode === 'effective') lines.push('Original components remain preserved. Effective cells use approved revisions with original fallbacks only when they reconcile with the approved total. A dash means component marks are unavailable or cannot be reconciled with the approved total. No component is inferred.');
    if (report.type === 'revaluation') lines.push('This report lists revaluation events. Pending, rejected and approved non-effective events do not change the current effective outcome. Original and revised marks are totals.');
    if (['student', 'subject'].includes(report.type) && report.filters.mode === 'effective') lines.push('IA and External are original stored components; Total, Grade and Result may reflect approved effective revaluation.');
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
