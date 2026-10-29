const express = require('express');
const router = express.Router();
router.use(require('../middlewares/examSessionParameters'));
const facultyController = require('../controllers/facultyController');
const auth = require('../middlewares/authMiddleware');
const admin = require('../middlewares/adminMiddleware');
const csrf = require('../middlewares/csrfMiddleware');

router.get('/', csrf, facultyController.dashboard);
router.get('/api/registry', auth, admin, facultyController.registry);
router.patch('/api/:facultyId/status', auth, admin, csrf, facultyController.setStatus);
router.get('/api/departments', facultyController.departments);
router.get('/api', facultyController.all);
router.post('/api', facultyController.create);
router.put('/api/assignments', facultyController.saveAssignments);

// Remove the Subject ↔ Faculty relationship only; the Faculty record stays intact.
router.delete('/api/assignments/:subject_id', facultyController.removeAssignments);
router.delete('/api/assignments/:subject_id/faculty/:faculty_id', facultyController.removeAssignedFaculty);

module.exports = router;
