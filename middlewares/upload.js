/** Revaluation staging, supported marks-card formats, and secure filenames. */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const TEMP_DIR = path.join(UPLOAD_ROOT, 'temp');
const REVAL_DIR = path.join(UPLOAD_ROOT, 'revaluation');

const validation = require('../public/js/marks-card-validation');
const { marksCardFilter } = require('./marksCardUpload');
const REVAL_ALLOWED_MIMES = Object.values(validation.formats);
const REVAL_ALLOWED_EXT = validation.extensions;
const REVAL_MAX_BYTES = require('../config/uploadLimits').revaluationPdf;

const revaluationUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: REVAL_MAX_BYTES },
  fileFilter: marksCardFilter
});

function ensureUploadDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function ensureRevalDir() {
  ensureUploadDirectory(TEMP_DIR);
  return ensureUploadDirectory(REVAL_DIR);
}

function generateSecureFilename(originalName) {
  const ts = Date.now();
  const rnd = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
  return `reval_${ts}_${base}_${rnd}${ext}`;
}

module.exports = {
  revaluationUpload,
  ensureRevalDir,
  generateSecureFilename,
  REVAL_DIR,
  REVAL_ALLOWED_EXT,
  REVAL_ALLOWED_MIMES,
  REVAL_MAX_BYTES
};
