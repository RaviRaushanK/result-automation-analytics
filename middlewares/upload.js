/**
 * File-upload middleware + helpers for the REVALUATION upload flow.
 *
 * Reuses the same conventions as the original results upload (PDF only, 15 MB
 * limit, `uploads/temp` staging then a final `uploads/<scope>/<secure>` dest).
 * Kept separate from resultRoutes' inline multer so the working original flow
 * is never touched; logic is shared via this module.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const TEMP_DIR = path.join(UPLOAD_ROOT, 'temp');
const REVAL_DIR = path.join(UPLOAD_ROOT, 'revaluation');

const REVAL_ALLOWED_MIMES = ['application/pdf'];
const REVAL_ALLOWED_EXT = ['.pdf'];
const REVAL_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const revaluationUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: REVAL_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (REVAL_ALLOWED_EXT.includes(ext) && REVAL_ALLOWED_MIMES.includes((file.mimetype || '').toLowerCase())) {
      return cb(null, true);
    }
    cb(new Error('Only PDF documents are accepted.'));
  }
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
