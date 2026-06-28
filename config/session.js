const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const store = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'academic_result_analytics_db',

  createDatabaseTable: true,

  // Production
  expiration: 4 * 60 * 60 * 1000, // 4 hours
  checkExpirationInterval: 15 * 60 * 1000 // Cleanup every 15 minutes
});


const sessionConfig = {
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET || 'fallback_session_secret',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset the timeout on every request
  store,
  cookie: {
    maxAge: 4 * 60 * 60 * 1000, // 4 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
};

module.exports = sessionConfig;
