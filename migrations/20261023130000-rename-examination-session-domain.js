'use strict';

// MySQL 8 metadata renames preserve IDs, column definitions, indexes and FKs.
// DDL commits implicitly: deploy with academic writes paused. Each rename is
// resumable after interruption; never disable FK checks or copy populated tables.
const CHILDREN = ['subjects', 'results', 'import_logs'];

async function rename(queryInterface, reverse) {
  const db = queryInterface.sequelize;
  const fromTable = reverse ? 'exam_sessions' : 'result_sessions';
  const toTable = reverse ? 'result_sessions' : 'exam_sessions';
  const fromColumn = reverse ? 'exam_session_id' : 'session_id';
  const toColumn = reverse ? 'session_id' : 'exam_session_id';
  const [tables] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\'');
  const names = new Set(tables.map(row => row.TABLE_NAME));
  if (names.has(fromTable) && names.has(toTable) || !names.has(fromTable) && !names.has(toTable))
    throw new Error('Ambiguous examination-session schema; migration stopped without merging records.');

  // Discover dependent views before their definitions become temporarily invalid.
  const [views] = await db.query('SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()');
  const definitions = [];
  for (const view of views) {
    if (!view.VIEW_DEFINITION || !new RegExp('\\b(' + fromTable + '|' + fromColumn + '|' + toColumn + ')\\b').test(view.VIEW_DEFINITION)) continue;
    // The only supported academic view; fail safely if another needs an audit.
    if (view.TABLE_NAME !== 'effective_student_results') throw new Error('Unreviewed dependent view: ' + view.TABLE_NAME);
    const [definition] = await db.query('SHOW CREATE VIEW `effective_student_results`');
    definitions.push(definition[0]['Create View']);
  }
  const currentTable = names.has(fromTable) ? fromTable : toTable;
  const [foreignKeys] = await db.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=:table', { replacements: { table: currentTable } });
  if (foreignKeys.some(row => !CHILDREN.includes(row.TABLE_NAME) || ![fromColumn, toColumn].includes(row.COLUMN_NAME)))
    throw new Error('Unreviewed examination-session foreign key; migration stopped.');

  // Preflight every table before the first DDL statement.
  for (const table of [currentTable, ...CHILDREN]) {
    const columns = await queryInterface.describeTable(table);
    if (!!columns[fromColumn] === !!columns[toColumn]) throw new Error('Ambiguous examination-session column in ' + table);
  }
  if (currentTable === fromTable) await queryInterface.renameTable(fromTable, toTable);
  for (const table of [toTable, ...CHILDREN]) {
    const columns = await queryInterface.describeTable(table);
    if (columns[fromColumn]) await db.query('ALTER TABLE `' + table + '` RENAME COLUMN `' + fromColumn + '` TO `' + toColumn + '`');
  }
  for (const definition of definitions) {
    await db.query(definition.replace(/^CREATE /i, 'CREATE OR REPLACE ')
      .replace(new RegExp('\\b' + fromTable + '\\b', 'g'), toTable)
      .replace(new RegExp('\\b' + fromColumn + '\\b', 'g'), toColumn));
  }
  // Check/index names retain their historical names; their expressions, key
  // order and enforcement are preserved by MySQL, not dropped/re-created.
}

module.exports = {
  up: queryInterface => rename(queryInterface, false),
  down: queryInterface => rename(queryInterface, true),
};
