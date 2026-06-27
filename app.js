// // Main entry point for the Result Automation & Analytics application
// const express = require('express');
// const path = require('path');
// const dotenv = require('dotenv');
// const session = require('express-session');
// const cookieParser = require('cookie-parser');
// const db = require('./config/db');
// const sessionConfig = require('./config/session');

// dotenv.config();

// const app = express();

// app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'));

// // Layout engine
// const ejLayouts = require('express-ejs-layouts');
// app.use(ejLayouts);
// app.set('layout', 'layouts/main');

// // Middleware setup
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(express.static('public'));
// app.use(cookieParser());
// app.use(session(sessionConfig));

// // Refresh session on every request
// app.use((req, res, next) => {
//   if (req.session) {
//     req.session.touch();
//   }
//   next();
// });

// // Prevent caching of protected pages
// app.use((req, res, next) => {
//   if (req.session && req.session.adminId) {
//     res.set({
//       'Cache-Control': 'no-store, no-cache, must-revalidate, private',
//       Pragma: 'no-cache',
//       Expires: '0'
//     });
//   }
//   next();
// });

// // Custom middlewares
// const layoutMiddleware = require('./middlewares/layoutMiddleware');
// const themeMiddleware = require('./middlewares/themeMiddleware');
// const menuMiddleware = require('./middlewares/menuMiddleware');
// const authMiddleware = require('./middlewares/authMiddleware');

// app.use(layoutMiddleware);
// app.use(themeMiddleware);
// app.use(menuMiddleware);
// // Ensure flash and user locals always exist for EJS views
// app.use((req, res, next) => {
//   if (!res.locals.flash) res.locals.flash = [];
//   if (!res.locals.user) res.locals.user = null;
//   if (!res.locals.breadcrumbItems) res.locals.breadcrumbItems = [];
//   next();
// });


// // Route imports
// const authRoutes = require('./routes/authRoutes');
// const landingRoutes = require('./routes/landingRoutes');
// const dashboardRoutes = require('./routes/dashboardRoutes');
// const batchRoutes = require('./routes/batchRoutes');
// const resultRoutes = require('./routes/resultRoutes');
// const sessionRoutes = require('./routes/sessionRoutes');
// const subjectRoutes = require('./routes/subjectRoutes');
// const testingRoutes = require('./routes/testingRoutes');

// // ========================
// // Public Routes (no auth required)
// // ========================
// app.use('/', landingRoutes);
// app.use('/', authRoutes); // /login GET/POST

// // Testing routes – isolated layout verification (no DB, no auth)
// app.use('/testing', testingRoutes);

// // Health check endpoint
// app.get('/api/health', (req, res) => {
//   res.json({ status: 'ok' });
// });

// // ========================
// // Protected Routes (auth required)
// // ========================
// app.use('/dashboard', authMiddleware, dashboardRoutes);
// app.use('/batches', authMiddleware, batchRoutes);
// app.use('/results', authMiddleware, resultRoutes);
// app.use('/sessions', authMiddleware, sessionRoutes);
// app.use('/subjects', authMiddleware, subjectRoutes);

// // Catch-all: any unmatched route requires authentication
// app.use((req, res, next) => {
//   if (req.session && req.session.adminId) {
//     // Authenticated but route not found — 404
//     return res.status(404).render('dashboard/index', {
//       layout: 'layouts/main',
//       title: 'Not Found - SRAAS',
//       breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }, { href: '#', label: 'Not Found' }]
//     });
//   }
//   // Unauthenticated — redirect to login
//   return res.redirect('/login');
// });

// // Global error handler
// app.use((err, req, res, next) => {
//   console.error(err);
//   res.status(500).json({ error: 'Internal Server Error' });
// });

// const PORT = process.env.APP_PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });


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
const testingRoutes = require('./routes/testingRoutes');

// ======================
// Public Routes
// ======================

app.use('/', landingRoutes);
app.use('/', authRoutes);

// Development testing routes.
app.use('/testing', testingRoutes);

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