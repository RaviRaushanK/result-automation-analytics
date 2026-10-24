(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.McaPassRules = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var version = 'VTU_MCA_2022_22OMC9_10_V1';
  function thresholds(subject) {
    subject = subject || {};
    var internal = Number(subject.max_internal ?? subject.max_internal_marks ?? 50);
    var external = Number(subject.max_external ?? subject.max_external_marks ?? 50);
    var total = Number(subject.max_marks ?? internal + external);
    var special = ['project', 'internship', 'seminar', 'dissertation', 'viva'].indexOf(subject.subject_type) >= 0;
    return { internal: Math.ceil(internal * .5), external: Math.ceil(external * (special ? .5 : .4)),
      total: Math.ceil(total * .5), maxInternal: internal, maxExternal: external, maxTotal: total };
  }
  function evaluate(internal, external, subject) {
    var limits = thresholds(subject);
    var valid = typeof internal === 'number' && Number.isSafeInteger(internal) && internal >= 0 && internal <= limits.maxInternal
      && typeof external === 'number' && Number.isSafeInteger(external) && external >= 0 && external <= limits.maxExternal
      && internal + external <= limits.maxTotal;
    var passed = valid && internal >= limits.internal && external >= limits.external && internal + external >= limits.total;
    return { valid: valid, status: passed ? 'pass' : 'fail', limits: limits };
  }
  return { version: version, thresholds: thresholds, evaluate: evaluate };
});
