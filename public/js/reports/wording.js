(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportWording = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var gpa = 'Stored values; unchanged by revaluation.';
  var marks = 'Approved effective marks; missing components are not estimated.';
  function visible(context) {
    var hasGpa = context.some(function (pair) { return pair[0] === 'GPA Basis'; });
    return context.filter(function (pair) {
      return !['Eligibility', 'Tie Order', 'Participation Basis', 'Calculation details'].includes(pair[0]) && !(hasGpa && pair[0] === 'SGPA Basis');
    });
  }
  function details(report) {
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
  return { gpa: gpa, marks: marks, visible: visible, details: details };
});
