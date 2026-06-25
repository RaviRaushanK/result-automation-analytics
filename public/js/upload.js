/**
 * Upload Page JavaScript
 * Handles marksheet upload, OCR processing, and data preview
 */

// Global variables
let currentExtractionId = null;
let extractedData = [];
let currentSessionId = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  initializeUploadPage();
});

/**
 * Initialize upload page
 */
function initializeUploadPage() {
  setupEventListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Upload form submission
  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', handleUpload);
  }

  // Reset form button
  const resetBtn = document.getElementById('resetForm');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetForm);
  }

  // Save data button
  const saveBtn = document.getElementById('saveDataBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveOCRData);
  }

  // Add row button
  const addRowBtn = document.getElementById('addRowBtn');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', addNewRow);
  }

  // File input change handler
  const fileInput = document.getElementById('marksheet');
  if (fileInput) {
    fileInput.addEventListener('change', validateFile);
  }
}

/**
 * Validate uploaded file
 */
function validateFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.type)) {
    showToast('Invalid file type. Only PDF, JPG, and PNG are allowed.', 'error');
    event.target.value = '';
    return;
  }

  if (file.size > maxSize) {
    showToast('File size exceeds 10MB limit.', 'error');
    event.target.value = '';
    return;
  }

  showToast('File selected successfully', 'success');
}

/**
 * Handle form submission
 */
async function handleUpload(event) {
  event.preventDefault();

  const sessionId = document.getElementById('sessionId').value;
  const fileInput = document.getElementById('marksheet');
  const file = fileInput.files[0];

  if (!sessionId) {
    showToast('Please select a session', 'warning');
    return;
  }

  if (!file) {
    showToast('Please select a file to upload', 'warning');
    return;
  }

  currentSessionId = sessionId;

  // Show progress card
  const progressCard = document.getElementById('progressCard');
  progressCard.classList.remove('d-none');

  try {
    // Step 1: Upload file
    await updateProgress(10, 'Uploading file...');
    const formData = new FormData();
    formData.append('marksheet', file);
    formData.append('sessionId', sessionId);

    const uploadResponse = await fetch('/dashboard/upload', {
      method: 'POST',
      body: formData
    });

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      throw new Error(uploadResult.error || 'Upload failed');
    }

    await updateProgress(30, 'File uploaded successfully. Processing OCR...');

    // Step 2: Process OCR
    const ocrResponse = await fetch('/dashboard/process-ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filePath: uploadResult.filePath,
        importId: uploadResult.importId
      })
    });

    const ocrResult = await ocrResponse.json();

    if (!ocrResponse.ok) {
      throw new Error(ocrResult.error || 'OCR processing failed');
    }

    await updateProgress(80, 'OCR processing completed. Validating data...');

    // Step 3: Display preview
    currentExtractionId = ocrResult.extractionId;
    extractedData = ocrResult.extractedData;

    // Show confidence score
    const confidenceBadge = document.getElementById('confidenceBadge');
    confidenceBadge.textContent = `Confidence: ${ocrResult.confidence.toFixed(2)}%`;

    // Validate and display data
    await updateProgress(90, 'Preparing preview...');
    displayExtractedData(extractedData);

    await updateProgress(100, 'Processing complete!');

    // Show preview section
    setTimeout(() => {
      const previewSection = document.getElementById('previewSection');
      previewSection.classList.remove('d-none');
      
      // Scroll to preview
      previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      showToast('OCR processing completed successfully', 'success');
    }, 500);

  } catch (error) {
    console.error('Upload error:', error);
    showToast(error.message, 'error');
    await updateProgress(0, 'Processing failed');
  }
}

/**
 * Update progress bar
 */
async function updateProgress(percent, text) {
  const progressBar = document.getElementById('uploadProgress');
  const progressText = document.getElementById('progressText');

  progressBar.style.width = percent + '%';
  progressBar.setAttribute('aria-valuenow', percent);
  progressBar.textContent = percent + '%';
  progressText.textContent = text;

  // Small delay for visual effect
  await new Promise(resolve => setTimeout(resolve, 200));
}

/**
 * Display extracted data in preview table
 */
function displayExtractedData(data) {
  const tbody = document.getElementById('previewTableBody');

  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-muted">
          No data extracted from the marksheet
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map((record, index) => `
    <tr data-index="${index}">
      <td>
        <input type="text" class="form-control" data-field="studentName" 
               value="${escapeHtml(record.studentName || '')}" 
               placeholder="Student Name">
      </td>
      <td>
        <input type="text" class="form-control" data-field="usn" 
               value="${escapeHtml(record.usn || '')}" 
               placeholder="USN">
      </td>
      <td>
        <input type="text" class="form-control" data-field="semester" 
               value="${escapeHtml(record.semester || '')}" 
               placeholder="Semester">
      </td>
      <td>
        <input type="text" class="form-control" data-field="subjectCode" 
               value="${escapeHtml(record.subjectCode || '')}" 
               placeholder="Subject Code">
      </td>
      <td>
        <input type="text" class="form-control" data-field="subjectName" 
               value="${escapeHtml(record.subjectName || '')}" 
               placeholder="Subject Name">
      </td>
      <td>
        <input type="number" class="form-control" data-field="marks" 
               value="${record.marks || 0}" 
               min="0" max="100" placeholder="Marks">
      </td>
      <td>
        <input type="text" class="form-control" data-field="grade" 
               value="${escapeHtml(record.grade || '')}" 
               placeholder="Grade">
      </td>
      <td>
        <select class="form-select" data-field="result">
          <option value="pass" ${record.result === 'pass' ? 'selected' : ''}>Pass</option>
          <option value="fail" ${record.result === 'fail' ? 'selected' : ''}>Fail</option>
        </select>
      </td>
      <td>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteRow(${index})" title="Delete Row">
          <i class="material-icons">delete</i>
        </button>
      </td>
    </tr>
  `).join('');

  // Add event listeners to all inputs
  tbody.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('change', handleFieldChange);
  });
}

/**
 * Handle field change in preview table
 */
function handleFieldChange(event) {
  const row = event.target.closest('tr');
  const index = parseInt(row.dataset.index);
  const field = event.target.dataset.field;
  const value = event.target.value;

  // Update extracted data
  if (extractedData[index]) {
    extractedData[index][field] = value;
  }

  // Auto-calculate grade if marks changed
  if (field === 'marks') {
    const marks = parseInt(value);
    if (!isNaN(marks) && marks >= 0 && marks <= 100) {
      const grade = calculateGrade(marks);
      const result = marks >= 40 ? 'pass' : 'fail';
      
      const gradeInput = row.querySelector('[data-field="grade"]');
      const resultSelect = row.querySelector('[data-field="result"]');
      
      if (gradeInput) gradeInput.value = grade;
      if (resultSelect) resultSelect.value = result;

      // Update extracted data
      if (extractedData[index]) {
        extractedData[index].grade = grade;
        extractedData[index].result = result;
      }
    }
  }
}

/**
 * Delete row from preview table
 */
function deleteRow(index) {
  if (confirm('Are you sure you want to delete this row?')) {
    extractedData.splice(index, 1);
    displayExtractedData(extractedData);
    showToast('Row deleted', 'info');
  }
}

/**
 * Add new empty row
 */
function addNewRow() {
  const newRow = {
    studentName: '',
    usn: '',
    semester: currentSessionId ? '1' : '',
    subjectCode: '',
    subjectName: '',
    marks: 0,
    grade: 'N/A',
    result: 'fail',
    sessionId: currentSessionId
  };

  extractedData.push(newRow);
  displayExtractedData(extractedData);

  // Scroll to the new row
  const rows = document.querySelectorAll('#previewTableBody tr');
  if (rows.length > 0) {
    rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Save OCR data to database
 */
async function saveOCRData() {
  if (!currentExtractionId) {
    showToast('No extraction ID found', 'error');
    return;
  }

  if (!extractedData || extractedData.length === 0) {
    showToast('No data to save', 'warning');
    return;
  }

  // Validate data before saving
  const validation = validateDataBeforeSave(extractedData);
  if (!validation.isValid) {
    showToast('Please fix validation errors before saving', 'error');
    return;
  }

  if (validation.warnings.length > 0) {
    const proceed = confirm(`Warnings detected:\n\n${validation.warnings.join('\n')}\n\nDo you want to proceed?`);
    if (!proceed) return;
  }

  try {
    // Disable save button
    const saveBtn = document.getElementById('saveDataBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="material-icons me-1">hourglass_empty</i>Saving...';

    const response = await fetch('/dashboard/save-ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        extractionId: currentExtractionId,
        data: extractedData
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to save data');
    }

    showToast('Data saved successfully!', 'success');

    // Reset form after successful save
    setTimeout(() => {
      resetForm();
    }, 2000);

  } catch (error) {
    console.error('Save error:', error);
    showToast(error.message, 'error');
  } finally {
    // Re-enable save button
    const saveBtn = document.getElementById('saveDataBtn');
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="material-icons me-1">save</i>Save to Database';
  }
}

/**
 * Validate data before saving
 */
function validateDataBeforeSave(data) {
  const errors = [];
  const warnings = [];

  data.forEach((record, index) => {
    if (!record.studentName || record.studentName === 'Unknown Student') {
      warnings.push(`Row ${index + 1}: Student name is missing or default`);
    }

    if (!record.usn) {
      errors.push(`Row ${index + 1}: USN is required`);
    }

    if (!record.subjectCode) {
      errors.push(`Row ${index + 1}: Subject code is required`);
    }

    if (!record.subjectName) {
      warnings.push(`Row ${index + 1}: Subject name is missing`);
    }

    if (isNaN(record.marks) || record.marks < 0 || record.marks > 100) {
      errors.push(`Row ${index + 1}: Marks must be between 0 and 100`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Reset form
 */
function resetForm() {
  // Reset form fields
  document.getElementById('uploadForm').reset();
  
  // Hide progress and preview sections
  document.getElementById('progressCard').classList.add('d-none');
  document.getElementById('previewSection').classList.add('d-none');
  
  // Reset progress bar
  updateProgress(0, 'Initializing...');
  
  // Clear global variables
  currentExtractionId = null;
  extractedData = [];
  currentSessionId = null;
  
  showToast('Form reset successfully', 'info');
}

/**
 * Calculate grade based on marks
 */
function calculateGrade(marks) {
  if (marks >= 90) return 'A+';
  if (marks >= 80) return 'A';
  if (marks >= 70) return 'B+';
  if (marks >= 60) return 'B';
  if (marks >= 50) return 'C+';
  if (marks >= 40) return 'C';
  return 'F';
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const toast = new bootstrap.Toast(document.getElementById('liveToast'));
  const toastIcon = document.getElementById('toastIcon');
  const toastTitle = document.getElementById('toastTitle');
  const toastMessage = document.getElementById('toastMessage');

  const icons = {
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };

  const titles = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Information'
  };

  toastIcon.textContent = icons[type] || icons.info;
  toastTitle.textContent = titles[type] || titles.info;
  toastMessage.textContent = message;

  const toastElement = document.getElementById('liveToast');
  toastElement.className = `toast border-${type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary'}`;

  toast.show();
}

// Export functions globally
window.upload = {
  deleteRow,
  addNewRow,
  showToast
};