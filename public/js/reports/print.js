'use strict';
function printReport() {
  if (document.getElementById('reports-analysis-data') && !window.reportChartReady) return;
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
document.getElementById('print-report').addEventListener('click', printReport);
window.addEventListener('load', printReport);
