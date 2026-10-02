'use strict';

const router = require('express').Router();
const controller = require('../controllers/studentsController');
router.use(require('../middlewares/authMiddleware'));
router.use((req, res, next) => {
  if (['admin', 'faculty'].includes(req.session?.role || req.user?.role)) return next();
  res.status(403).json({ success: false, message: 'You are not authorized to manage students.' });
});
router.get('/', controller.page);
router.patch('/api/:studentId/category', controller.updateCategory);
module.exports = router;
