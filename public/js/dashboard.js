/**
 * Dashboard JavaScript
 * Handles dashboard functionality, filters, and data loading
 */

// Global variables
let charts = {};
let currentFilters = {
  academicYear: '',
  semester: ''
};

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  initializeDashboard();
});

/**
 * Initialize dashboard
 */
async function initializeDashboard() {
  // Load initial data
  await loadDashboardStats();
  await loadTopScorers();
  await loadSubjectAnalytics();
  await loadPassFailData();
  await loadResultTrends();
  await loadSemesterPerformance();

  // Setup event listeners
  setupEventListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Apply filter button
  document.getElementById('applyFilter').addEventListener('click', applyFilters);

  // Reset filter button
  document.getElementById('resetFilter').addEventListener('click', resetFilters);

  // Export button
  const exportBtn = document.getElementById('exportSubjectAnalytics');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportSubjectAnalytics);
  }
}

/**
 * Apply filters and reload data
 */
async function applyFilters() {
  const academicYear = document.getElementById('academicYear').value;
  const semester = document.getElementById('semester').value;

  currentFilters = {
    academicYear,
    semester
  };

  // Show loading state
  showLoadingState();

  // Reload all data with filters
  await Promise.all([
    loadDashboardStats(),
    loadTopScorers(),
    loadSubjectAnalytics(),
    loadPassFailData(),
    loadResultTrends(),
    loadSemesterPerformance()
  ]);

  showToast('Filters applied successfully', 'success');
}

/**
 * Reset filters
 */
function resetFilters() {
  document.getElementById('academicYear').value = '';
  document.getElementById('semester').value = '';

  currentFilters = {
    academicYear: '',
    semester: ''
  };

  applyFilters();
}

/**
 * Show loading state for stat cards
 */
function showLoadingState() {
  document.querySelectorAll('.stat-card').forEach(card => {
    card.classList.remove('loaded');
  });
}

/**
 * Load dashboard statistics
 */
async function loadDashboardStats() {
  try {
    const params = new URLSearchParams();
    if (currentFilters.academicYear) params.append('academicYear', currentFilters.academicYear);
    if (currentFilters.semester) params.append('semester', currentFilters.semester);

    const response = await fetch(`/dashboard/stats?${params.toString()}`);
    const data = await response.json();

    if (response.ok) {
      updateStatCards(data);
    } else {
      throw new Error(data.error || 'Failed to load statistics');
    }
  } catch (error) {
    console.error('Error loading stats:', error);
    showToast('Failed to load statistics', 'error');
  }
}

/**
 * Update stat cards with data
 */
function updateStatCards(data) {
  const stats = {
    totalStudents: data.totalStudents,
    totalPass: data.totalPass,
    totalFail: data.totalFail,
    passPercentage: data.passPercentage + '%',
    failPercentage: data.failPercentage + '%',
    totalSubjects: data.totalSubjects,
    highestScore: data.highestScore,
    averageCGPA: data.averageCGPA
  };

  // Animate counter updates
  Object.keys(stats).forEach(key => {
    const element = document.getElementById(key);
    if (element) {
      animateValue(element, stats[key]);
      element.closest('.stat-card').classList.add('loaded');
    }
  });
}

/**
 * Animate value change
 */
function animateValue(element, newValue) {
  const duration = 800;
  const startValue = parseFloat(element.textContent) || 0;
  const endValue = parseFloat(newValue) || 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const currentValue = startValue + (endValue - startValue) * easeOutQuart;

    // Format value
    if (typeof newValue === 'string' && newValue.includes('%')) {
      element.textContent = currentValue.toFixed(2) + '%';
    } else if (typeof newValue === 'string') {
      element.textContent = currentValue.toFixed(2);
    } else {
      element.textContent = Math.round(currentValue);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Load top scorers
 */
async function loadTopScorers() {
  try {
    const params = new URLSearchParams();
    if (currentFilters.academicYear) params.append('academicYear', currentFilters.academicYear);
    if (currentFilters.semester) params.append('semester', currentFilters.semester);

    const response = await fetch(`/dashboard/top-scorers?${params.toString()}`);
    const data = await response.json();

    if (response.ok) {
      updateTopScorersTable(data);
    } else {
      throw new Error(data.error || 'Failed to load top scorers');
    }
  } catch (error) {
    console.error('Error loading top scorers:', error);
    showToast('Failed to load top scorers', 'error');
  }
}

/**
 * Update top scorers table
 */
function updateTopScorersTable(scorers) {
  const tbody = document.querySelector('#topScorersTable tbody');

  if (!scorers || scorers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          No data available
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = scorers.map(scorer => {
    const rankClass = scorer.rank <= 3 ? `rank-${scorer.rank}` : 'rank-other';
    const rankIcon = scorer.rank === 1 ? 'emoji_events' : 
                     scorer.rank === 2 ? 'military_tech' : 
                     scorer.rank === 3 ? 'workspace_premium' : '';

    return `
      <tr>
        <td>
          <span class="rank-badge ${rankClass}">
            ${rankIcon ? `<i class="material-icons" style="font-size: 16px;">${rankIcon}</i>` : scorer.rank}
          </span>
        </td>
        <td><strong>${scorer.usn}</strong></td>
        <td>${scorer.student_name}</td>
        <td>Semester ${scorer.semester}</td>
        <td>
          <span class="badge ${parseFloat(scorer.percentage) >= 70 ? 'bg-success' : parseFloat(scorer.percentage) >= 50 ? 'bg-warning' : 'bg-danger'}">
            ${scorer.percentage}%
          </span>
        </td>
        <td><strong>${scorer.total_marks}</strong></td>
      </tr>
    `;
  }).join('');
}

/**
 * Load subject analytics
 */
async function loadSubjectAnalytics() {
  try {
    const params = new URLSearchParams();
    if (currentFilters.academicYear) params.append('academicYear', currentFilters.academicYear);
    if (currentFilters.semester) params.append('semester', currentFilters.semester);

    const response = await fetch(`/dashboard/analytics?${params.toString()}`);
    const data = await response.json();

    if (response.ok) {
      updateSubjectAnalyticsTable(data.subjectWise);
      updateSubjectAverageChart(data.chartData);
    } else {
      throw new Error(data.error || 'Failed to load subject analytics');
    }
  } catch (error) {
    console.error('Error loading subject analytics:', error);
    showToast('Failed to load subject analytics', 'error');
  }
}

/**
 * Update subject analytics table
 */
function updateSubjectAnalyticsTable(subjects) {
  const tbody = document.querySelector('#subjectAnalyticsTable tbody');

  if (!subjects || subjects.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          No data available
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = subjects.map(subject => `
    <tr>
      <td><code>${subject.subjectCode}</code></td>
      <td>${subject.subjectName}</td>
      <td><strong>${subject.averageMarks}</strong></td>
      <td>${subject.highestMarks}</td>
      <td>${subject.lowestMarks}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="progress flex-grow-1" style="height: 6px;">
            <div class="progress-bar ${parseFloat(subject.passPercentage) >= 70 ? 'bg-success' : parseFloat(subject.passPercentage) >= 50 ? 'bg-warning' : 'bg-danger'}" 
                 style="width: ${subject.passPercentage}%"></div>
          </div>
          <span class="badge ${parseFloat(subject.passPercentage) >= 70 ? 'bg-success' : parseFloat(subject.passPercentage) >= 50 ? 'bg-warning' : 'bg-danger'}">
            ${subject.passPercentage}%
          </span>
        </div>
      </td>
    </tr>
  `).join('');
}

/**
 * Load pass/fail data
 */
async function loadPassFailData() {
  try {
    const params = new URLSearchParams();
    if (currentFilters.academicYear) params.append('academicYear', currentFilters.academicYear);
    if (currentFilters.semester) params.append('semester', currentFilters.semester);

    const response = await fetch(`/dashboard/pass-fail?${params.toString()}`);
    const data = await response.json();

    if (response.ok) {
      updatePassFailCharts(data);
    } else {
      throw new Error(data.error || 'Failed to load pass/fail data');
    }
  } catch (error) {
    console.error('Error loading pass/fail data:', error);
    showToast('Failed to load pass/fail data', 'error');
  }
}

/**
 * Load result trends
 */
async function loadResultTrends() {
  try {
    const response = await fetch('/dashboard/trends');
    const data = await response.json();

    if (response.ok) {
      updateResultTrendChart(data);
    } else {
      throw new Error(data.error || 'Failed to load result trends');
    }
  } catch (error) {
    console.error('Error loading result trends:', error);
    showToast('Failed to load result trends', 'error');
  }
}

/**
 * Load semester performance
 */
async function loadSemesterPerformance() {
  try {
    const response = await fetch('/dashboard/semester-performance');
    const data = await response.json();

    if (response.ok) {
      updateSemesterPerformanceChart(data);
    } else {
      throw new Error(data.error || 'Failed to load semester performance');
    }
  } catch (error) {
    console.error('Error loading semester performance:', error);
    showToast('Failed to load semester performance', 'error');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const toast = new bootstrap.Toast(document.getElementById('liveToast'));
  const toastIcon = document.getElementById('toastIcon');
  const toastTitle = document.getElementById('toastTitle');
  const toastMessage = document.getElementById('toastMessage');

  // Set icon based on type
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

  // Set toast color based on type
  const toastElement = document.getElementById('liveToast');
  toastElement.className = `toast border-${type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary'}`;

  toast.show();
}

/**
 * Export subject analytics to CSV
 */
function exportSubjectAnalytics() {
  const table = document.getElementById('subjectAnalyticsTable');
  const rows = table.querySelectorAll('tbody tr');

  if (rows.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  let csv = [];
  csv.push(['Subject Code', 'Subject Name', 'Average Marks', 'Highest Marks', 'Lowest Marks', 'Pass Percentage']);

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length > 0) {
      const rowData = Array.from(cells).map(cell => {
        return cell.textContent.trim().replace(/\s+/g, ' ');
      });
      csv.push(rowData);
    }
  });

  // Create and download CSV file
  const csvContent = csv.map(row => row.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subject-analytics-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);

  showToast('Analytics exported successfully', 'success');
}

// Export functions for use in charts.js
window.dashboard = {
  loadDashboardStats,
  loadTopScorers,
  loadSubjectAnalytics,
  loadPassFailData,
  loadResultTrends,
  loadSemesterPerformance,
  applyFilters,
  resetFilters,
  showToast
};