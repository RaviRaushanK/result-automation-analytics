const express = require("express");
const router = express.Router();

const subjectController = require("../controllers/subjectController");
const adminMiddleware = require("../middlewares/adminMiddleware");
const courses = require('../controllers/academicCoursesController');
router.get('/courses', adminMiddleware, courses.redirectLegacy);
router.post('/courses', adminMiddleware, courses.confirm);
router.post('/roster', adminMiddleware, courses.confirm);
router.get('/roster/edit', adminMiddleware, courses.edit);

router.get('/', (req, res, next) => {
  if (req.query.tab === 'roster') return adminMiddleware(req, res, () => courses.page(req, res, next));
  return subjectController.all(req, res);
});
router.get("/session/:session_id", subjectController.getBySession);
router.get("/:id", subjectController.getById);
router.post("/", adminMiddleware, subjectController.create);
router.put("/:id", adminMiddleware, subjectController.update);
router.delete("/:id", adminMiddleware, subjectController.delete);

module.exports = router;
