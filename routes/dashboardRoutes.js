const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Controller import
const dashboardController = require('../controllers/dashboardController');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, and PNG are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter
});

/**
 * Dashboard Routes
 * Base URL: /dashboard
 */

// ========================
// Dashboard Page Routes
// ========================
router.get('/', dashboardController.getDashboard); // GET /dashboard → dashboard page

// ========================
// API Routes - Statistics
// ========================
router.get('/stats', dashboardController.getDashboardStats); // GET /dashboard/stats → dashboard statistics
router.get('/top-scorers', dashboardController.getTopScorers); // GET /dashboard/top-scorers → top 10 students
router.get('/analytics', dashboardController.getSubjectAnalytics); // GET /dashboard/analytics → subject analytics
router.get('/pass-fail', dashboardController.getPassFailData); // GET /dashboard/pass-fail → pass/fail data
router.get('/trends', dashboardController.getResultTrends); // GET /dashboard/trends → result trends
router.get('/semester-performance', dashboardController.getSemesterPerformance); // GET /dashboard/semester-performance → semester performance

// ========================
// Upload Routes
// ========================
router.get('/upload', dashboardController.getUploadPage); // GET /dashboard/upload → upload page

// POST /dashboard/upload - Upload marksheet file
router.post('/upload', upload.single('marksheet'), dashboardController.uploadMarksheet);

// POST /dashboard/process-ocr - Process OCR on uploaded file
router.post('/process-ocr', dashboardController.processOCR);

// POST /dashboard/save-ocr - Save OCR extracted data to database
router.post('/save-ocr', dashboardController.saveOCRData);

// PUT /dashboard/ocr/:id - Update OCR record
router.put('/ocr/:id', dashboardController.updateOCRRecord);

// DELETE /dashboard/ocr/:id - Delete OCR record
router.delete('/ocr/:id', dashboardController.deleteOCRRecord);

module.exports = router;