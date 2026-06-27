// Main entry point for the Result Automation & Analytics application
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const db = require('./config/db');
const sessionConfig = require('./config/session');

dotenv.config();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Layout engine
const ejLayouts = require('express-ejs-layouts');
app.use(ejLayouts);
app.set('layout', 'layouts/main');

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());
app.use(session(sessionConfig));

// Controllers
const authController = require('./controllers/authController');

// Route imports
const authRoutes = require('./routes/authRoutes');
const batchRoutes = require('./routes/batchRoutes');
const resultRoutes = require('./routes/resultRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const testingRoutes = require('./routes/testingRoutes');
const landingRoutes = require('./routes/landingRoutes');

// Custom middlewares
const layoutMiddleware = require('./middlewares/layoutMiddleware');
const themeMiddleware = require('./middlewares/themeMiddleware');
const menuMiddleware = require('./middlewares/menuMiddleware');

app.use(layoutMiddleware);
app.use(themeMiddleware);
app.use(menuMiddleware);

 // Testing routes – isolated layout verification (no DB, no auth)
 app.use('/testing', testingRoutes);
 app.use('/', landingRoutes);
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