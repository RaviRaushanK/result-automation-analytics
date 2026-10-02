'use strict';

const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/reportsController');

router.use(authMiddleware, controller.authorization);
router.get('/', (req, res) => res.redirect('/reports/student'));
router.get('/api/batches', controller.options('batches'));
router.get('/api/batches/:batchId/students', controller.options('students'));
router.get('/api/batches/:batchId/semesters', controller.options('semesters'));
router.get('/api/sessions', controller.options('sessions'));
router.get('/api/subjects', controller.options('subjects'));
router.get('/api/student-results', controller.options('student-results'));

for (const type of ['student', 'class', 'subject', 'revaluation']) {
  router.get(`/${type}`, controller.page(type));
  router.get(`/api/${type}`, controller.api(type));
  router.get(`/${type}/export.csv`, controller.csv(type));
  router.get(`/${type}/print`, controller.print(type));
}

module.exports = router;
