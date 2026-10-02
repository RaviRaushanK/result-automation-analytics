'use strict';

(() => {
  let chart;
  let currentReport;
  const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };

  function clear() { chart?.destroy(); chart = undefined; window.reportChartReady = false; }

  function render(report) {
    clear();
    currentReport = report;
    const header = document.getElementById('reports-analysis-header');
    if (header) header.replaceChildren(element('p', 'Department: MCA'), element('h2', report.formalHeader.title), element('p', report.formalHeader.examination), element('p', report.meta.batch.batch_name));
    const table = document.getElementById('reports-table');
    if (table) {
      table.classList.add('reports-analysis-table');
      const top = element('tr'); const bottom = element('tr');
      ['SL NO.', 'SUBJECT CODE', 'NAME OF THE SUBJECT'].forEach(label => { const th = element('th', label); th.rowSpan = 2; th.scope = 'col'; top.append(th); });
      ['REGULAR', 'REPEATERS', 'TOTAL'].forEach(label => {
        const th = element('th', label); th.colSpan = 3; th.scope = 'colgroup'; top.append(th);
        ['APP', 'PASS', '% PASS'].forEach(text => { const cell = element('th', text); cell.scope = 'col'; bottom.append(cell); });
      });
      const staff = element('th', 'NAME OF THE STAFF'); staff.rowSpan = 2; staff.scope = 'col'; top.append(staff);
      table.querySelector('thead').replaceChildren(top, bottom);
      document.getElementById('reports-analysis-overall').append(document.getElementById('reports-summary'));
    }
    const canvas = document.getElementById('reports-analysis-chart');
    const error = document.getElementById('reports-chart-error');
    if (error) error.hidden = true;
    if (typeof Chart !== 'function') {
      if (error) { error.textContent = 'The chart could not be loaded. Subject percentages remain available in the table.'; error.hidden = false; }
      return;
    }
    const dark = document.documentElement.dataset.theme === 'dark';
    const ink = dark ? '#e5e7eb' : '#20242a';
    chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: report.chart.labels, datasets: [{ label: 'Total % Pass', data: report.chart.values, backgroundColor: '#249c83', borderColor: '#187b67', borderWidth: 1, maxBarThickness: 70 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.parsed.y.toFixed(2)}%` } } },
        scales: { y: { min: 0, max: 100, ticks: { color: ink }, title: { display: true, text: 'Pass Percentage', color: ink } }, x: { ticks: { color: ink, autoSkip: false }, grid: { display: false } } } },
      plugins: [{ id: 'reportBarValues', afterDatasetsDraw(instance) {
        const { ctx } = instance; ctx.save(); ctx.fillStyle = ink; ctx.font = '11px Arial'; ctx.textAlign = 'center';
        instance.getDatasetMeta(0).data.forEach((bar, index) => ctx.fillText(`${Number(report.chart.values[index]).toFixed(2)}%`, bar.x, Math.max(instance.chartArea.top + 12, bar.y - 6)));
        ctx.restore();
      } }]
    });
    canvas.setAttribute('aria-label', report.chart.labels.map((label, index) => `${label}: ${report.chart.values[index]}%`).join('; ') || 'No session subjects');
    window.reportChartReady = true;
    window.dispatchEvent(new Event('reports:chart-ready'));
  }

  window.addEventListener('reports:clear', () => { clear(); currentReport = undefined; });
  window.addEventListener('reports:render', event => { if (event.detail.type === 'result-analysis') render(event.detail); });
  window.addEventListener('beforeprint', () => chart?.resize(820, 260));
  window.addEventListener('afterprint', () => chart?.resize());
  new MutationObserver(() => { if (chart && currentReport) render(currentReport); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const data = document.getElementById('reports-analysis-data');
  if (data) render(JSON.parse(data.textContent));
})();
