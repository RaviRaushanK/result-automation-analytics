const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');

router.get('/', facultyController.dashboard);
router.get('/api/departments', facultyController.departments);
router.get('/api', facultyController.all);
router.post('/api', facultyController.create);
router.put('/api/assignments', facultyController.saveAssignments);

// Remove the Subject ↔ Faculty relationship only; the Faculty record stays intact.
router.delete('/api/assignments/:subject_id', facultyController.removeAssignments);
router.delete('/api/assignments/:subject_id/faculty/:faculty_id', facultyController.removeAssignedFaculty);

module.exports = router;
