'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const validation = require('../public/js/marks-card-validation');

function marksCardFilter(req, file, callback) {
  const error = validation.error(file, { requireMime: true });
  callback(error ? new Error(error) : null, !error);
}

async function verifyMarksCard(file, maxBytes) {
  const error = validation.error(file, { requireMime: true, maxBytes });
  if (error) throw new Error(error);
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.pdf') {
    const handle = await fs.open(file.path, 'r');
    try {
      const header = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) {
        throw new Error('The uploaded file is not a valid PDF document.');
      }
    } finally {
      await handle.close();
    }
    return;
  }
  try {
    const image = sharp(file.path, { limitInputPixels: 40000000 });
    const metadata = await image.metadata();
    const expected = extension === '.png' ? 'png' : 'jpeg';
    if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.pages > 1) {
      throw new Error('Unsupported image content');
    }
    await image.resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch (_) {
    throw new Error('The image is damaged, does not match its extension, or exceeds 40 megapixels. Choose a valid PNG, JPG or JPEG image.');
  }
}

function marksCardUpload(upload, fieldName, errorPage, maxBytes) {
  return (req, res, next) => {
    const fail = async error => {
      if (req.file && req.file.path) await fs.unlink(req.file.path).catch(() => {});
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Document too large. Maximum size is 15 MB.' : error.message || 'Invalid marks card.';
      const back = typeof errorPage === 'function' ? errorPage(req) : errorPage;
      res.redirect(back + '?error=' + encodeURIComponent(message));
    };
    upload.single(fieldName)(req, res, error => {
      if (error) return void fail(error).catch(next);
      if (!req.file) return next();
      verifyMarksCard(req.file, maxBytes).then(() => next(), error => fail(error).catch(next));
    });
  };
}

module.exports = { marksCardFilter, marksCardUpload, verifyMarksCard };

