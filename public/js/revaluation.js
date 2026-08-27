/**
 * Revaluation Upload page client logic.
 * - Enables the "Start Revaluation" button only when >= 1 subject checkbox is
 *   selected.
 * - Guards the form: never allows a submit with nothing selected.
 * Purely UX; the server independently re-authorises every id.
 */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function findChecks(form) {
    return form.querySelectorAll('input[name="subject_result_id"]');
  }

  ready(function () {
    var form = document.getElementById('revalForm');
    if (!form) return;

    var btn = document.getElementById('startBtn');

    function update() {
      var any = findChecks(form).length > 0 &&
        form.querySelectorAll('input[name="subject_result_id"]:checked').length > 0;
      if (btn) btn.disabled = !any;
    }

    findChecks(form).forEach(function (c) {
      c.addEventListener('change', update);
    });
    update();

    form.addEventListener('submit', function (e) {
      var checked = form.querySelectorAll('input[name="subject_result_id"]:checked').length;
      if (!checked) {
        e.preventDefault();
        if (btn) btn.disabled = true;
      }
    });
  });
})();
