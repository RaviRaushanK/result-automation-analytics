const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    logging: false,
    define: {
      underscored: true,
      freezeTableName: true,
      timestamps: false
    }
  }
);

module.exports = { sequelize, DataTypes};