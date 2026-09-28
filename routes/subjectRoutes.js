const express = require("express");
const router = express.Router();

const subjectController = require("../controllers/subjectController");
const adminMiddleware = require("../middlewares/adminMiddleware");

router.get("/", subjectController.all);
router.get("/session/:session_id", subjectController.getBySession);
router.get("/:id", subjectController.getById);
router.post("/", adminMiddleware, subjectController.create);
router.put("/:id", adminMiddleware, subjectController.update);
router.delete("/:id", adminMiddleware, subjectController.delete);

module.exports = router;
