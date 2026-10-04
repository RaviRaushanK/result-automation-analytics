const express = require("express");
const multer = require("multer");
const router = express.Router();

const studentController = require("../controllers/studentController");

// Memory storage: import files are parsed in-memory; nothing is
// inserted until the admin confirms the preview.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv")
    )
      return cb(null, true);
    cb(new Error("Only .xlsx, .xls or .csv files are allowed"));
  },
});

// Page
router.get("/", studentController.index);
router.get("/search", studentController.search);

// Multer wrapper returns JSON errors for API callers instead of the HTML error page.
function uploadSingle(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err)
      return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

// APIs (specific before /:id)
router.get("/api/list", studentController.list);
router.get("/api/stats", studentController.stats);
router.get("/api/categories", studentController.categories);
router.post(
  "/api/import/preview",
  uploadSingle,
  studentController.importPreview,
);
router.post("/api/import/confirm", studentController.importConfirm);

// CRUD APIs
router.get("/api/:id", studentController.get);
router.post("/api", studentController.create);
router.put("/api/:id", studentController.update);
router.delete("/api/:id", studentController.delete);

module.exports = router;
