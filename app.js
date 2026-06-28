// Main entry point for the Student Result Analysis & Academic Analytics System (SRAAS)

const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');

const app = express();

// Database
require('./config/db');

// Session configuration
const sessionConfig = require('./config/session');

// ======================
// View Engine
// ======================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ======================
// Global Middleware
// ======================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session(sessionConfig));

// Populate authenticated user from session
app.use((req, res, next) => {
    if (req.session?.adminId) {
        req.user = {
            adminId: req.session.adminId,
            username: req.session.username,
            role: req.session.role
        };

        res.locals.user = {
            name: req.session.username,
            role: req.session.role
        };
    }
    next();
});

// Keep active sessions alive while the administrator is using the system.
app.use((req, res, next) => {
    if (req.session) {
        req.session.touch();
    }
    next();
});

// Prevent browser caching for authenticated pages.
app.use((req, res, next) => {
    if (req.session?.adminId) {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
    next();
});

// ======================
// Custom Middleware
// ======================

const layoutMiddleware = require('./middlewares/layoutMiddleware');
const themeMiddleware = require('./middlewares/themeMiddleware');
const menuMiddleware = require('./middlewares/menuMiddleware');
const authMiddleware = require('./middlewares/authMiddleware');

app.use(layoutMiddleware);
app.use(themeMiddleware);
app.use(menuMiddleware);

// Shared variables for all EJS views.
app.use((req, res, next) => {
    res.locals.flash = res.locals.flash || [];
    res.locals.user = res.locals.user || null;
    res.locals.breadcrumbItems = res.locals.breadcrumbItems || [];
    next();
});

// ======================
// Routes
// ======================

const landingRoutes = require('./routes/landingRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const batchRoutes = require('./routes/batchRoutes');
const resultRoutes = require('./routes/resultRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const subjectRoutes = require('./routes/subjectRoutes');


// ======================
// Public Routes
// ======================

app.use('/', landingRoutes);
app.use('/', authRoutes);


// Health check.
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok'
    });
});

// ======================
// Protected Routes
// ======================

app.use('/dashboard', authMiddleware, dashboardRoutes);
app.use('/batches', authMiddleware, batchRoutes);
app.use('/results', authMiddleware, resultRoutes);
app.use('/sessions', authMiddleware, sessionRoutes);
app.use('/subjects', authMiddleware, subjectRoutes);

// ======================
// 404 Handler
// ======================

app.use((req, res) => {
    return res.status(404).render('errors/404', {
        layout: 'layouts/landing',
        title: 'Page Not Found'
    });
});

// ======================
// Global Error Handler
// ======================

app.use((err, req, res, next) => {
    console.error(err);

    return res.status(500).render('errors/500', {
        layout: 'layouts/landing',
        title: 'Server Error'
    });
});

// ======================
// Start Server
// ======================

const PORT = process.env.APP_PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});