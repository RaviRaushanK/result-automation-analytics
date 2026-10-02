'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataTypes } = require('sequelize');

test('category migration only adds a nullable string column and does not backfill', async () => {
  const migration = require('../migrations/20261002180000-student-admission-category');
  const columns = {}; const additions = []; const removals = [];
  const qi = { describeTable: async table => { assert.equal(table, 'students'); return columns; },
    addColumn: async (table, name, options) => { additions.push({ table, name, options }); columns[name] = options; },
    removeColumn: async (table, name) => removals.push({ table, name }) };
  await migration.up(qi, DataTypes); await migration.up(qi, DataTypes);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, 'category');
  assert.equal(additions[0].options.type.options.length, 30);
  assert.equal(additions[0].options.allowNull, true);
  assert.equal(additions[0].options.defaultValue, null);
  await migration.down(qi);
  assert.deepEqual(removals, [{ table: 'students', name: 'category' }]);
});
