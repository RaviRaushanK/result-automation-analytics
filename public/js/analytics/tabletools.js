/**
 * SRAAS - Analytics shared table toolkit.
 *
 * Adds click-to-sort headers, instant row search and a "showing x of y"
 * counter to any Analytics results table. Purely presentational: rows are
 * only re-ordered or hidden, so the values stay exactly as the pages
 * rendered them from the API responses.
 */
(function () {
  'use strict';

  var registry = {};

  function byId(idOrEl) {
    if (!idOrEl) return null;
    return typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  }

  /** Numeric reading of a cell, or null when the cell is not a number. */
  function numeric(text) {
    var value = String(text == null ? '' : text).trim();
    if (!value || value === '\u2014' || value === '-' || value === '\u2013') return null;
    var cleaned = value.replace(/[,\s%]/g, '').replace(/^\+/, '');
    if (cleaned === '' || isNaN(cleaned)) return null;
    return Number(cleaned);
  }

  function bodyRows(table) {
    var body = table && table.tBodies && table.tBodies[0];
    if (!body) return [];
    return Array.prototype.slice.call(body.rows || []);
  }

  function isPlaceholderRow(tr) {
    return tr.classList.contains('analytics-table-empty-row')
      || tr.classList.contains('analytics-table-nomatch-row');
  }

  function cellText(tr, index) {
    var cell = tr.cells ? tr.cells[index] : null;
    if (!cell) return '';
    var explicit = cell.getAttribute('data-sort-value');
    return explicit != null ? explicit : String(cell.textContent || '').trim();
  }

  /** Sort: numbers first (asc/desc), then text; blank/dash values always last. */
  function sortRows(rows, index, direction) {
    var decorated = rows.map(function (tr, order) {
      return { tr: tr, order: order, value: cellText(tr, index) };
    });
    decorated.sort(function (a, b) {
      var an = numeric(a.value);
      var bn = numeric(b.value);
      if (an === null && bn === null) return a.order - b.order;
      if (an === null) return 1;
      if (bn === null) return -1;
      var cmp = an - bn;
      if (isNaN(cmp)) {
        cmp = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' });
      }
      if (cmp === 0) return a.order - b.order;
      return direction === 'desc' ? -cmp : cmp;
    });
    return decorated.map(function (entry) { return entry.tr; });
  }

  function matchRow(tr, query) {
    if (!query) return true;
    return String(tr.textContent || '').toLowerCase().indexOf(query) !== -1;
  }

  function ensureNoMatchRow(table, state) {
    var body = table.tBodies[0];
    var existing = body.querySelector('.analytics-table-nomatch-row');
    if (!existing) {
      existing = document.createElement('tr');
      existing.className = 'analytics-table-nomatch-row';
      var cell = document.createElement('td');
      cell.className = 'analytics-table-empty';
      cell.colSpan = state.columns;
      cell.textContent = 'No rows match the current search.';
      existing.appendChild(cell);
      body.appendChild(existing);
    }
    existing.style.display = '';
  }

  function removeNoMatchRow(table) {
    var body = table.tBodies[0];
    var existing = body.querySelector('.analytics-table-nomatch-row');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function updateCount(state, visible, total) {
    if (!state.countEl) return;
    state.countEl.textContent = total === 0
      ? 'No rows'
      : 'Showing ' + visible + ' of ' + total + (state.rowLabel ? ' ' + state.rowLabel : ' rows');
  }

  function apply(tableId) {
    var state = registry[tableId];
    if (!state || !state.table) return;
    var table = state.table;
    var all = bodyRows(table);
    var rows = all.filter(function (tr) { return !isPlaceholderRow(tr); });
    var placeholders = all.filter(isPlaceholderRow);

    // The page owns the "no data" placeholder when the API returned nothing.
    if (!rows.length) {
      removeNoMatchRow(table);
      placeholders.forEach(function (tr) { tr.style.display = ''; });
      updateCount(state, 0, 0);
      return;
    }

    if (state.sortIndex != null) {
      var body = table.tBodies[0];
      var fragment = document.createDocumentFragment();
      sortRows(rows, state.sortIndex, state.sortDirection).forEach(function (tr) {
        fragment.appendChild(tr);
      });
      body.appendChild(fragment);
      placeholders.forEach(function (tr) { body.appendChild(tr); });
    }

    var query = state.query ? String(state.query).trim().toLowerCase() : '';
    var visible = 0;
    rows.forEach(function (tr) {
      var matched = matchRow(tr, query);
      tr.style.display = matched ? '' : 'none';
      if (matched) visible++;
    });

    if (visible === 0) ensureNoMatchRow(table, state);
    else removeNoMatchRow(table);
    updateCount(state, visible, rows.length);
  }

  function markHeaders(state) {
    state.headers.forEach(function (th, index) {
      th.classList.remove('is-sorted-asc', 'is-sorted-desc');
      if (state.sortIndex === index) {
        th.classList.add(state.sortDirection === 'desc' ? 'is-sorted-desc' : 'is-sorted-asc');
        th.setAttribute('aria-sort', state.sortDirection === 'desc' ? 'descending' : 'ascending');
      } else if (th.hasAttribute('aria-sort')) {
        th.removeAttribute('aria-sort');
      }
    });
  }

  function onHeaderClick(tableId, index) {
    var state = registry[tableId];
    if (!state) return;
    if (state.sortIndex === index) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortIndex = index;
      state.sortDirection = 'asc';
    }
    markHeaders(state);
    apply(tableId);
  }

  /**
   * enhance('students-table', { search: 'students-search', count: 'students-count' })
   * Columns marked data-nosort are left alone. Safe to call more than once.
   */
  function enhance(tableId, options) {
    var table = byId(tableId);
    if (!table || !table.tHead || !table.tHead.rows || !table.tHead.rows[0]) return null;
    var headerRow = table.tHead.rows[0];
    var state = registry[tableId] || {
      table: table,
      sortIndex: null,
      sortDirection: 'asc',
      query: ''
    };
    state.table = table;
    state.headers = Array.prototype.slice.call(headerRow.cells);
    state.columns = state.headers.length;

    var opts = options || {};
    state.countEl = byId(opts.count);
    state.rowLabel = opts.rowLabel || '';
    state.searchEl = byId(opts.search);

    if (!state.bound) {
      state.bound = true;
      state.headers.forEach(function (th, index) {
        if (th.getAttribute('data-nosort') != null) return;
        th.classList.add('analytics-table-sortable');
        th.setAttribute('tabindex', '0');
        th.setAttribute('role', 'button');
        th.addEventListener('click', function () { onHeaderClick(tableId, index); });
        th.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onHeaderClick(tableId, index);
          }
        });
      });
      if (state.searchEl) {
        state.searchEl.addEventListener('input', function (event) {
          var current = registry[tableId];
          if (!current) return;
          current.query = event.target.value || '';
          apply(tableId);
        });
      }
    }

    registry[tableId] = state;
    apply(tableId);
    return state;
  }

  /** Re-apply the active sort/search after the page re-rendered its rows. */
  function refresh(tableId) {
    if (tableId) return apply(tableId);
    Object.keys(registry).forEach(apply);
  }

  window.AnalyticsTable = {
    enhance: enhance,
    refresh: refresh,
    refreshAll: function () { refresh(); }
  };
})();
