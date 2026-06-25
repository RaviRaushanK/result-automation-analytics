/**
 * Charts JavaScript
 * Handles all Chart.js visualizations for the dashboard
 */

// Chart instances storage
let charts = {};

// Chart.js default configuration
Chart.defaults.font.family = "'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif";
Chart.defaults.color = '#5a5c69';
Chart.defaults.borderColor = '#e3e6f0';

/**
 * Initialize all charts
 */
async function initializeCharts() {
  await Promise.all([
    initSubjectAverageChart(),
    initPassFailPieChart(),
    initPassFailDoughnutChart(),
    initResultTrendChart(),
    initSemesterPerformanceChart()
  ]);
}

/**
 * Destroy all existing charts
 */
function destroyAllCharts() {
  Object.keys(charts).forEach(key => {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  });
}

/**
 * Subject Average Bar Chart
 */
async function initSubjectAverageChart(chartData) {
  const ctx = document.getElementById('subjectAverageChart');
  if (!ctx) return;

  // Destroy existing chart
  if (charts.subjectAverage) {
    charts.subjectAverage.destroy();
  }

  const data = chartData || [];
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);

  charts.subjectAverage = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Average Marks',
        data: values,
        backgroundColor: 'rgba(78, 115, 223, 0.8)',
        borderColor: 'rgba(78, 115, 223, 1)',
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          cornerRadius: 8,
          titleFont: {
            size: 14
          },
          bodyFont: {
            size: 13
          },
          callbacks: {
            label: function(context) {
              return `Average: ${context.parsed.y.toFixed(2)} marks`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + ' marks';
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  });
}

/**
 * Pass vs Fail Pie Chart
 */
async function initPassFailPieChart(data) {
  const ctx = document.getElementById('passFailPieChart');
  if (!ctx) return;

  // Destroy existing chart
  if (charts.passFailPie) {
    charts.passFailPie.destroy();
  }

  const passCount = data?.pass || 0;
  const failCount = data?.fail || 0;

  charts.passFailPie = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Pass', 'Fail'],
      datasets: [{
        data: [passCount, failCount],
        backgroundColor: [
          'rgba(28, 200, 138, 0.8)',
          'rgba(231, 74, 59, 0.8)'
        ],
        borderColor: [
          'rgba(28, 200, 138, 1)',
          'rgba(231, 74, 59, 1)'
        ],
        borderWidth: 3,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(2) : 0;
              return `${context.label}: ${context.parsed} (${percentage}%)`;
            }
          }
        }
      },
      animation: {
        animateScale: true,
        animateRotate: true,
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  });
}

/**
 * Pass vs Fail Doughnut Chart
 */
async function initPassFailDoughnutChart(data) {
  const ctx = document.getElementById('passFailDoughnutChart');
  if (!ctx) return;

  // Destroy existing chart
  if (charts.passFailDoughnut) {
    charts.passFailDoughnut.destroy();
  }

  const passCount = data?.pass || 0;
  const failCount = data?.fail || 0;

  charts.passFailDoughnut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pass', 'Fail'],
      datasets: [{
        data: [passCount, failCount],
        backgroundColor: [
          'rgba(54, 185, 204, 0.8)',
          'rgba(246, 194, 62, 0.8)'
        ],
        borderColor: [
          'rgba(54, 185, 204, 1)',
          'rgba(246, 194, 62, 1)'
        ],
        borderWidth: 3,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(2) : 0;
              return `${context.label}: ${context.parsed} (${percentage}%)`;
            }
          }
        }
      },
      animation: {
        animateScale: true,
        animateRotate: true,
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  });
}

/**
 * Update Pass vs Fail Charts
 */
function updatePassFailCharts(data) {
  initPassFailPieChart(data);
  initPassFailDoughnutChart(data);
}

/**
 * Result Trends Line Chart
 */
async function initResultTrendChart(data) {
  const ctx = document.getElementById('resultTrendChart');
  if (!ctx) return;

  // Destroy existing chart
  if (charts.resultTrend) {
    charts.resultTrend.destroy();
  }

  const labels = data?.map(d => d.label) || [];
  const percentages = data?.map(d => d.averagePercentage) || [];
  const cgpas = data?.map(d => d.averageCGPA) || [];

  charts.resultTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Pass Percentage (%)',
          data: percentages,
          backgroundColor: 'rgba(28, 200, 138, 0.1)',
          borderColor: 'rgba(28, 200, 138, 1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgba(28, 200, 138, 1)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        },
        {
          label: 'Average CGPA',
          data: cgpas,
          backgroundColor: 'rgba(78, 115, 223, 0.1)',
          borderColor: 'rgba(78, 115, 223, 1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgba(78, 115, 223, 1)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            },
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          cornerRadius: 8
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      },
      animation: {
        duration: 1500,
        easing: 'easeInOutQuart'
      }
    }
  });
}

/**
 * Semester Performance Bar Chart
 */
async function initSemesterPerformanceChart(data) {
  const ctx = document.getElementById('semesterPerformanceChart');
  if (!ctx) return;

  // Destroy existing chart
  if (charts.semesterPerformance) {
    charts.semesterPerformance.destroy();
  }

  const labels = data?.map(d => d.label) || [];
  const percentages = data?.map(d => d.averagePercentage) || [];
  const cgpas = data?.map(d => d.averageCGPA) || [];

  charts.semesterPerformance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Pass Percentage (%)',
          data: percentages,
          backgroundColor: 'rgba(111, 66, 193, 0.8)',
          borderColor: 'rgba(111, 66, 193, 1)',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
          yAxisID: 'y'
        },
        {
          label: 'Average CGPA',
          data: cgpas,
          type: 'line',
          backgroundColor: 'rgba(253, 126, 20, 0.1)',
          borderColor: 'rgba(253, 126, 20, 1)',
          borderWidth: 3,
          fill: false,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgba(253, 126, 20, 1)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            },
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          cornerRadius: 8
        }
      },
      scales: {
        y: {
          type: 'linear',
          beginAtZero: true,
          max: 100,
          position: 'left',
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          title: {
            display: true,
            text: 'Pass Percentage (%)'
          }
        },
        y1: {
          type: 'linear',
          beginAtZero: true,
          max: 10,
          position: 'right',
          ticks: {
            callback: function(value) {
              return value.toFixed(2);
            }
          },
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: 'Average CGPA'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      },
      animation: {
        duration: 1500,
        easing: 'easeInOutQuart'
      }
    }
  });
}

/**
 * Update Subject Average Chart
 */
function updateSubjectAverageChart(chartData) {
  initSubjectAverageChart(chartData);
}

/**
 * Update Result Trend Chart
 */
function updateResultTrendChart(data) {
  initResultTrendChart(data);
}

/**
 * Update Semester Performance Chart
 */
function updateSemesterPerformanceChart(data) {
  initSemesterPerformanceChart(data);
}

// Export functions globally
window.charts = {
  initializeCharts,
  destroyAllCharts,
  updateSubjectAverageChart,
  updatePassFailCharts,
  updateResultTrendChart,
  updateSemesterPerformanceChart
};