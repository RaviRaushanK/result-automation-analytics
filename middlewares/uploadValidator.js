const path = require('path');

// File type validation - MIME and extension
const validateFileType = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];

  const fileExt = path.extname(req.file.originalname).toLowerCase();
  const isValidMime = allowedMimeTypes.includes(req.file.mimetype);
  const isValidExt = allowedExtensions.includes(fileExt);

  if (!isValidMime || !isValidExt) {
    // Remove the uploaded file since it's invalid
    if (req.file.path && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid file type. Allowed: PDF, JPG, PNG' });
  }

  next();
};

// File size validation
const validateFileSize = (maxSizeInMb = 10) => {
  return (req, res, next) => {
    if (!req.file) return next();

    const maxSizeBytes = maxSizeInMb * 1024 * 1024;

    if (req.file.size > maxSizeBytes) {
      // Remove the uploaded file since it's too large
      if (req.file.path && require('fs').existsSync(req.file.path)) {
        require('fs').unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: `File size exceeds ${maxSizeInMb}MB limit` });
    }

    next();
  };
};

// Academic context validation
const validateAcademicContext = (req, res, next) => {
  const requiredFields = ['batch_id', 'semester', 'session_id', 'result_type'];
  const missingFields = requiredFields.filter(field => !req.body[field]);

  if (missingFields.length > 0) {
    if (req.file && req.file.path && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
  }

  // Validate result_type value
  if (req.body.result_type && !['ORIGINAL', 'REVALUATION'].includes(req.body.result_type)) {
    if (req.file && req.file.path && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid result type. Must be ORIGINAL or REVALUATION' });
  }

  next();
};

module.exports = {
  validateFileType,
  validateFileSize,
  validateAcademicContext
};