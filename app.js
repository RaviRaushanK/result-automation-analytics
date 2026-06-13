// Main entry point for the Result Automation & Analytics application

const express = require('express');
const dotenv = require('dotenv');
const session = require('express-session');
const db = require('./config/db');
const sessionConfig = require('./config/session');

dotenv.config();

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session(sessionConfig));

const authRoutes = require('./routes/authRoutes');
const batchRoutes = require('./routes/batchRoutes');
// Register routes
app.use('/auth', authRoutes);
app.use('/batches', batchRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.APP_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
