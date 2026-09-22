/**
 * SRAAS - Analytics shared chart toolkit (Chart.js 4.x).
 *
 * One theme-aware Chart.js wrapper reused by every Analytics page so charts
 * match the app shell in light and dark mode. Values always come straight
 * from the existing Analytics APIs - this file never derives, merges or
 * invents metric values, and it renders nothing when the API returned none.
 */
(function () {
  'use strict';

  // Accent tokens declared in tokens.css: [token, lightFallback, darkFallback]
  var ACCENTS = [
    ['--accent-blue', '#2563EB', '#60A5FA'],
    ['--accent-green', '#16A34A', '#4ADE80'],
    ['--accent-amber', '#D97706', '#FBBF24'],
    ['--accent-red', '#DC2626', '#F87171'],
    ['--accent-purple', '#7C3AED', '#A78BFA'],
    ['--accent-teal', '#0891B2', '#22D3EE'],
    ['--accent-orange', '#EA580C', '#FB923C'],
    ['--accent-emerald', '#059669', '#34D399']
  ];
  var NAMES = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'orange', 'emerald'];

  var instances = {};
  var specs = {};

  // ---------- theme + token helpers ----------
  function themeName() {
    var root = document.documentElement;
    return (root && root.getAttribute('data-theme')) || 'light';
  }
  function isDark() { return themeName() === 'dark'; }
  function token(name, fallback) {
    try {
      var value = getComputedStyle(document.documentElement).getPropertyValue(name);
      value = (value || '').trim();
      return value || fallback;
    } catch (e) { return fallback; }
  }
  function accentHex(name) {
    var idx = NAMES.indexOf(name);
    if (idx < 0) idx = 0;
    var entry = ACCENTS[idx];
    return token(entry[0], isDark() ? entry[2] : entry[1]);
  }
  function rgba(hex, alpha) {
    var h = String(hex == null ? '' : hex).trim();
    if (h.charAt(0) !== '#') return h;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    var n = parseInt(h.slice(1), 16);
    if (isNaN(n)) return h;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  function textColor() { return token('--text-secondary', isDark() ? '#CBD5E1' : '#4B5563'); }
  function strongTextColor() { return token('--text-primary', isDark() ? '#F8FAFC' : '#111827'); }
  function gridColor() { return isDark() ? 'rgba(148,163,184,0.28)' : 'rgba(107,114,128,0.18)'; }
  function surfaceColor() { return token('--card-bg', isDark() ? '#1B2432' : '#FFFFFF'); }

  /** Deterministic accent palette: {border, bg, soft} per entry. */
  function palette(count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var hex = accentHex(NAMES[i % NAMES.length]);
      out.push({ border: hex, bg: rgba(hex, 0.72), soft: rgba(hex, 0.18) });
    }
    return out;
  }

  // ---------- formatting ----------
  function formatValue(value, decimals, suffix) {
    if (value == null || value === '' || isNaN(value)) return '\u2014';
    var n = Number(value);
    var digits = decimals == null ? 2 : decimals;
    var text = digits === 0
      ? n.toLocaleString()
      : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return text + (suffix || '');
  }

  // ---------- host + empty message ----------
  function host(hostId) {
    if (!hostId) return null;
    return typeof hostId === 'string' ? document.getElementById(hostId) : hostId;
  }
  function message(el, text) {
    if (!el) return;
    el.textContent = '';
    var p = document.createElement('p');
    p.className = 'analytics-chart-placeholder';
    p.textContent = text || 'No chart data for the current filters.';
    el.appendChild(p);
  }

  // ---------- Chart.js options ----------
  function tooltipLabel(spec) {
    var decimals = spec.decimals == null ? 2 : spec.decimals;
    var suffix = spec.suffix || '';
    return function (ctx) {
      var raw = ctx.parsed;
      if (raw && typeof raw === 'object') {
        // Vertical charts store the value on y; horizontal (indexAxis 'y')
        // stores it on x while y holds the category index — never show that
        // index as if it were the value.
        var horizontal = ctx.chart && ctx.chart.options && ctx.chart.options.indexAxis === 'y';
        raw = horizontal ? raw.x : (raw.y != null ? raw.y : raw.x);
      }
      var label = ctx.dataset && ctx.dataset.label ? ctx.dataset.label + ': ' : '';
      return label + formatValue(raw, decimals, suffix);
    };
  }

  function baseOptions(spec) {
    var ink = textColor();
    var grid = gridColor();
    var isDoughnut = (spec.type || 'bar') === 'doughnut';
    var options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      interaction: isDoughnut
        ? { mode: 'nearest', intersect: true }
        : { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: spec.legend !== false,
          position: spec.legendPosition || (isDoughnut ? 'right' : 'bottom'),
          labels: { color: ink, usePointStyle: true, boxWidth: 10, boxHeight: 10, padding: 14 }
        },
        tooltip: {
          backgroundColor: surfaceColor(),
          titleColor: strongTextColor(),
          bodyColor: ink,
          borderColor: grid,
          borderWidth: 1,
          padding: 10,
          callbacks: { label: tooltipLabel(spec) }
        }
      }
    };
    if (spec.title) {
      options.plugins.title = { display: true, text: spec.title, color: ink, padding: { bottom: 8 } };
    }
    if (isDoughnut) {
      options.cutout = spec.cutout || '58%';
    } else {
      options.scales = {
        x: {
          ticks: {
            color: ink,
            autoSkip: true,
            maxRotation: spec.xMaxRotation == null ? 45 : spec.xMaxRotation,
            maxTicksLimit: spec.maxTicks || 12
          },
          grid: { display: spec.type === 'line', color: grid }
        },
        y: {
          beginAtZero: true,
          ticks: { color: ink, precision: 0 },
          grid: { display: true, color: grid }
        }
      };
      if (spec.y1) {
        options.scales.y1 = {
          position: 'right',
          beginAtZero: spec.y1BeginAtZero !== false,
          ticks: { color: ink },
          grid: { drawOnChartArea: false, color: grid }
        };
      }
      if (spec.stacked) {
        options.scales.x.stacked = true;
        options.scales.y.stacked = true;
      }
      if (spec.horizontal) {
        // indexAxis 'y' makes x the value axis — it must start at zero so
        // horizontal bars are drawn from a real baseline.
        options.indexAxis = 'y';
        options.scales.x.beginAtZero = true;
        options.scales.y.beginAtZero = false;
        options.scales.y.ticks = { color: ink };
        options.scales.x.grid = { display: true, color: grid };
      }
    }
    return options;
  }

  function buildDatasets(spec) {
    var colors = palette((spec.datasets || []).length || 1);
    return (spec.datasets || []).map(function (ds, i) {
      var declaredType = ds.type || spec.type || 'bar';
      var isLine = declaredType === 'line';
      var isDoughnut = declaredType === 'doughnut';
      var border = ds.color ? accentHex(ds.color) : colors[i].border;
      var out = {
        label: ds.label || '',
        data: ds.data || [],
        borderWidth: ds.borderWidth == null ? (isLine ? 2 : 1) : ds.borderWidth,
        yAxisID: ds.yAxis || 'y'
      };
      if (ds.type) out.type = ds.type;
      if (isDoughnut) {
        var segments = ds.colors
          ? ds.colors.map(function (name) { return accentHex(name); })
          : (ds.data || []).map(function (_, k) { return accentHex(NAMES[k % NAMES.length]); });
        out.backgroundColor = segments.map(function (hex) { return rgba(hex, 0.85); });
        out.borderColor = segments;
        out.hoverOffset = 8;
      } else if (ds.palette) {
        // One accent per bar (grade buckets, outcome categories, ...).
        out.backgroundColor = (ds.data || []).map(function (_, k) {
          return rgba(accentHex(NAMES[k % NAMES.length]), 0.72);
        });
        out.borderColor = (ds.data || []).map(function (_, k) {
          return accentHex(NAMES[k % NAMES.length]);
        });
      } else if (isLine) {
        out.borderColor = border;
        out.backgroundColor = ds.fill ? rgba(border, 0.18) : border;
        out.fill = !!ds.fill;
        out.tension = ds.tension == null ? 0.35 : ds.tension;
        out.pointRadius = ds.pointRadius == null ? 3 : ds.pointRadius;
        out.pointHoverRadius = 5;
        out.pointBackgroundColor = border;
        if (ds.dashed) out.borderDash = [6, 4];
      } else {
        out.backgroundColor = rgba(border, 0.72);
        out.borderColor = border;
      }
      return out;
    });
  }

  // ---------- public render / destroy ----------
  function destroy(hostId) {
    var instance = instances[hostId];
    if (instance) {
      try { instance.destroy(); } catch (e) { /* already gone */ }
      delete instances[hostId];
    }
    return null;
  }

  function destroyAll() {
    Object.keys(instances).forEach(destroy);
  }

  /**
   * Render (or re-render) one chart.
   * spec = { type, labels, datasets[], title, suffix, decimals, legend,
   *          horizontal, stacked, y1, palette, emptyMessage }
   * Re-rendering the same host always destroys the previous instance, so no
   * canvas is ever reused.
   */
  function render(hostId, spec) {
    var el = host(hostId);
    if (!el || !spec) return null;
    specs[hostId] = spec;
    destroy(hostId);

    var labels = spec.labels || [];
    var hasData = (spec.datasets || []).some(function (ds) {
      return (ds.data || []).some(function (value) {
        return value != null && value !== '' && !isNaN(value);
      });
    });
    if (!labels.length || !hasData) {
      message(el, spec.emptyMessage);
      return null;
    }
    if (typeof Chart === 'undefined') {
      message(el, 'Chart library unavailable. See the table for the values.');
      return null;
    }

    el.textContent = '';
    var canvas = document.createElement('canvas');
    el.appendChild(canvas);
    instances[hostId] = new Chart(canvas, {
      type: spec.type || 'bar',
      data: { labels: labels, datasets: buildDatasets(spec) },
      options: baseOptions(spec)
    });
    return instances[hostId];
  }

  /** Repaint every live chart with the current theme tokens. */
  function rerenderAll() {
    Object.keys(specs).forEach(function (hostId) {
      if (instances[hostId]) render(hostId, specs[hostId]);
    });
  }

  // Theme switching (themeSwitcher.js flips data-theme on <html>) repaints
  // the charts so light/dark stay consistent without a page reload.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
    try {
      new MutationObserver(rerenderAll).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    } catch (e) { /* observer unsupported: charts keep their initial theme */ }
  }

  window.AnalyticsCharts = {
    render: render,
    destroy: destroy,
    destroyAll: destroyAll,
    rerenderAll: rerenderAll,
    palette: palette,
    accentHex: accentHex,
    textColor: textColor,
    gridColor: gridColor,
    formatValue: formatValue,
    theme: themeName
  };
})();
