'use strict';

document.getElementById('student-categories').addEventListener('click', async event => {
  const button = event.target.closest('[data-save-category]');
  if (!button) return;
  const root = document.getElementById('student-categories');
  const row = button.closest('[data-student-id]');
  const message = document.getElementById('students-category-message');
  button.disabled = true;
  try {
    const response = await fetch(`/students/api/${row.dataset.studentId}/category`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: root.dataset.batchId, category: row.querySelector('[data-category]').value }) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Unable to save admission category.');
    row.querySelector('[data-category]').value = result.student.category || '';
    message.textContent = 'Admission category saved.'; message.className = 'alert alert-success';
  } catch (err) { message.textContent = err.message; message.className = 'alert alert-danger'; }
  finally { button.disabled = false; message.hidden = false; }
});
