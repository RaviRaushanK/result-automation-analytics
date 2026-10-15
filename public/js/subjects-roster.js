(function () {
  'use strict';
  const page = document.querySelector('[data-roster-page]');
  if (!page) return;
  const batches = JSON.parse(page.dataset.batches);
  const batch = document.getElementById('course-batch');
  const semester = document.getElementById('course-semester');
  const load = document.getElementById('loadRosterBtn');
  function changed() {
    document.getElementById('rosterContent').hidden = true;
    document.getElementById('rosterSelectionChanged').classList.remove('d-none');
    const confirm = document.getElementById('confirmRosterBtn');
    if (confirm) confirm.disabled = true;
    const review = document.getElementById('reviewRosterBtn');
    if (review) review.disabled = true;
    const saved = document.getElementById('rosterSaved');
    if (saved) saved.hidden = true;
    load.disabled = !batch.value || !semester.value;
    const examination = document.getElementById('examination-subjects-tab');
    examination.href = batch.value ? '/subjects?batch_id=' + encodeURIComponent(batch.value) : '/subjects';
  }
  batch.addEventListener('change', () => {
    const selected = batches.find(value => String(value.batch_id) === batch.value);
    const count = AcademicFormOptions.semesterCount(selected);
    semester.replaceChildren();
    for (let number = 1; number <= count; number++) semester.add(new Option('Semester ' + number, String(number)));
    if (!count) semester.add(new Option('No semester range available', ''));
    semester.disabled = !count;
    changed();
  });
  semester.addEventListener('change', changed);
  const saved = document.getElementById('rosterSaved');
  if (saved) setTimeout(() => { saved.hidden = true; }, 6000);
  const modal = document.getElementById('rosterReviewModal');
  if (!modal) return;
  const form = document.getElementById('rosterConfirmation');
  const acknowledgement = document.getElementById('rosterAcknowledge');
  const error = document.getElementById('rosterReviewError');
  const choices = Array.from(form.querySelectorAll('[name=required_courses]'));
  let reviewedSelection = null;
  const selection = () => choices.filter(input => input.checked).map(input => input.value).join(',');
  acknowledgement.addEventListener('change', () => {
    document.getElementById('confirmRosterBtn').disabled = !acknowledgement.checked || reviewedSelection !== selection() || document.getElementById('rosterContent').hidden;
  });
  function group(parent, title, inputs) {
    const heading = document.createElement('h6'); heading.textContent = title + ' (' + inputs.length + ')'; parent.appendChild(heading);
    const list = document.createElement('ul'); list.className = 'roster-review-list';
    for (const input of inputs) { const item = document.createElement('li'); item.textContent = input.dataset.courseLabel; list.appendChild(item); }
    if (!inputs.length) { const item = document.createElement('li'); item.textContent = 'None'; list.appendChild(item); }
    parent.appendChild(list);
  }
  form.addEventListener('submit', event => {
    if (document.getElementById('rosterContent').hidden) { event.preventDefault(); return; }
    if (event.submitter?.id === 'confirmRosterBtn' && reviewedSelection === selection() && acknowledgement.checked) {
      document.getElementById('confirmRosterBtn').disabled = true;
      return;
    }
    event.preventDefault();
    if (!choices.some(input => input.checked)) {
      error.textContent = 'Select at least one required course.'; error.classList.remove('d-none'); return;
    }
    error.classList.add('d-none');
    const summary = document.getElementById('rosterReviewSummary'); summary.replaceChildren();
    group(summary, 'Required courses', choices.filter(input => input.checked));
    group(summary, 'Added to required roster', choices.filter(input => input.checked && input.dataset.originalRequired === '0'));
    group(summary, 'Removed from required roster', choices.filter(input => !input.checked && input.dataset.originalRequired === '1'));
    reviewedSelection = selection(); acknowledgement.checked = false; acknowledgement.disabled = false;
    document.getElementById('confirmRosterBtn').disabled = true;
    bootstrap.Modal.getOrCreateInstance(modal).show();
  });
  modal.addEventListener('hidden.bs.modal', () => { reviewedSelection = null; acknowledgement.checked = false; acknowledgement.disabled = true; document.getElementById('confirmRosterBtn').disabled = true; });
})();
