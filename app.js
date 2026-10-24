// Main entry point for the Student Result Analysis & Academic Analytics System (SRAAS)

const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const expressLayouts = require("express-ejs-layouts");

const app = express();

// Database
require("./config/db");

// Session configuration
const sessionConfig = require("./config/session");

// ======================
// View Engine
// ======================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(expressLayouts);
app.set("layout", "layouts/main");

// ======================
// Global Middleware
// ======================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
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
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    });
  }
  next();
});

// ======================
// Custom Middleware
// ======================

const userMiddleware = require("./middlewares/userMiddleware");
const themeMiddleware = require("./middlewares/themeMiddleware");
const menuMiddleware = require("./middlewares/menuMiddleware");
const authMiddleware = require("./middlewares/authMiddleware");
const otpService = require("./services/otpService");

app.use(userMiddleware);
app.use(themeMiddleware);
app.use(menuMiddleware);

// Shared variables for all EJS views.
app.locals.formatGpa = require('./public/js/gpa-format').format;
app.use((req, res, next) => {
  res.locals.flash = res.locals.flash || [];
  res.locals.breadcrumbItems = res.locals.breadcrumbItems || [];
  res.locals.maskEmail = otpService.maskEmail;
  res.locals.maskMobile = otpService.maskMobile;
  next();
});

// ======================
// Routes
// ======================

const landingRoutes = require("./routes/landingRoutes");
const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const batchRoutes = require("./routes/batchRoutes");
const resultRoutes = require("./routes/resultRoutes");
const revaluationRoutes = require("./routes/revaluationRoutes");
const examSessionRoutes = require("./routes/examSessionRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const facultyRoutes = require("./routes/facultyRoutes");
const adminMiddleware = require("./middlewares/adminMiddleware");
const analyticsRoutes = require('./routes/analyticsRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const studentRoutes = require('./routes/studentRoutes');

// ======================
// Public Routes
// ======================

app.use("/", landingRoutes);
app.use("/", authRoutes);

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

// ======================
// Protected Routes
// ======================

// Normalize academic IDs at the HTTP boundary; login sessions are untouched.
app.use(['/exam-sessions', '/sessions', '/results', '/revaluation', '/subjects', '/faculty', '/analytics', '/reports', '/dashboard'], require('./middlewares/examSessionParameters'));
app.use("/dashboard", authMiddleware, dashboardRoutes);
app.use("/batches", authMiddleware, batchRoutes);
app.use("/results", authMiddleware, resultRoutes);
app.use("/revaluation", authMiddleware, revaluationRoutes);
app.use("/sessions", authMiddleware, require('./middlewares/legacyExamSessionRedirect'));
app.use("/exam-sessions", authMiddleware, examSessionRoutes);
app.use("/subjects", authMiddleware, subjectRoutes);
app.use("/faculty", authMiddleware, adminMiddleware, facultyRoutes);
app.use('/analytics', authMiddleware, analyticsRoutes);
app.use('/reports', authMiddleware, reportsRoutes);
app.use('/students', authMiddleware, studentRoutes);
app.use('/settings', require('./routes/settingsRoutes'));

// ======================
// 404 Handler
// ======================

app.use((req, res) => {
  return res.status(404).render("errors/404", {
    layout: "layouts/landing",
    title: "Page Not Found",
  });
});

// ======================
// Global Error Handler
// ======================

app.use((err, req, res, next) => {
  console.error(err);

  return res.status(500).render("errors/500", {
    layout: "layouts/landing",
    title: "Server Error",
  });
});

// ======================
// Start Server
// ======================

const PORT = process.env.APP_PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
