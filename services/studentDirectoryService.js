'use strict';
const repository = require('../repositories/studentDirectoryRepository');

function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function text(value, label, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string') invalid(label + ' must be a single value.');
  const trimmed = value.trim();
  if (trimmed.length > max || /[\x00-\x1f\x7f]/.test(trimmed)) invalid(label + ' is invalid or too long.');
  return trimmed;
}
function integer(value, label, fallback) {
  const raw = text(value, label, 16);
  if (!raw) return fallback;
  const number = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(number)) invalid(label + ' must be a positive integer.');
  return number;
}
async function filters(query = {}) {
  const batch = text(query.batch_id, 'Batch', 20);
  let batch_id;
  if (batch === 'all') batch_id = 'all';
  else if (batch) {
    if (!/^[1-9]\d*$/.test(batch)) invalid('Select a valid batch.');
    batch_id = batch;
  } else batch_id = (await repository.latestBatch())?.batch_id ?? null;
  const status = text(query.status, 'Status', 20).toLowerCase();
  if (status && !['active', 'inactive'].includes(status)) invalid('Select a valid status.');
  const pageSize = integer(query.pageSize, 'Page size', 25);
  if (![25, 50, 100].includes(pageSize)) invalid('Page size must be 25, 50 or 100.');
  return { search: text(query.search ?? query.q, 'Search', 100), batch_id: batch_id == null ? null : String(batch_id),
    category: text(query.category, 'Category', 50), status, page: integer(query.page, 'Page', 1), pageSize };
}
async function list(query) {
  const normalized = await filters(query);
  const totalRows = normalized.batch_id == null ? 0 : await repository.count(normalized);
  const totalPages = Math.ceil(totalRows / normalized.pageSize);
  const page = Math.min(normalized.page, Math.max(totalPages, 1));
  normalized.page = page;
  const rows = totalRows ? await repository.rows(normalized, normalized.pageSize, (page - 1) * normalized.pageSize) : [];
  return { rows, filters: normalized, pagination: { page, pageSize: normalized.pageSize, totalRows, totalPages } };
}
async function stats(query) {
  const normalized = await filters(query);
  return normalized.batch_id == null ? { total: 0, active: 0, inactive: 0, categories: 0 } : repository.stats(normalized);
}
module.exports = { filters, list, stats };
