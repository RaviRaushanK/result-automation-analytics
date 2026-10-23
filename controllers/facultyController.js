const crypto = require("crypto");
const facultyEmailValidation = require('../public/js/faculty-email-validation');
const { Op } = require("sequelize");
const {
  Faculty,
  Department,
  Subject,
  SubjectFaculty,
  ResultSession,
  sequelize,
} = require("../database/models");

const FACULTY_PAGE_STYLES = [
  "/css/dashboard.css",
  "/css/batches.css",
  "/css/faculty.css",
];

const ASSIGNMENT_REMOVED_MESSAGE = "Faculty assignment removed successfully.";
const ASSIGNMENT_REMOVE_ERROR_MESSAGE =
  "Unable to remove the faculty assignment. Please try again.";

function cleanIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(Boolean).map(String),
    ),
  ];
}

const facultyController = {
  dashboard: async (req, res) => {
    try {
      return res.render("faculty/index", {
        layout: "layouts/main",
        title: "Faculty Assignments - SRAAS",
        pageStyles: FACULTY_PAGE_STYLES,
        breadcrumbItems: [
          { href: "#", label: "Academic Management" },
          { label: "Faculty" },
        ],
      });
    } catch (error) {
      console.error("Faculty dashboard error:", error);
      return res
        .status(500)
        .render("errors/500", {
          layout: "layouts/landing",
          title: "Server Error",
        });
    }
  },

  all: async (req, res) => {
    try {
      const data = await Faculty.findAll({
        where: { status: "active" },
        attributes: [
          "faculty_id",
          "faculty_code",
          "faculty_name",
          "email",
          "designation",
          "status",
        ],
        order: [["faculty_name", "ASC"]],
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Faculty list error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to load faculty right now. Please try again.",
        });
    }
  },

  departments: async (req, res) => {
    try {
      const data = await Department.findAll({
        where: { status: "active" },
        attributes: ["department_id", "department_code", "department_name"],
        order: [["department_name", "ASC"]],
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Department list error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to load departments right now. Please try again.",
        });
    }
  },

  create: async (req, res) => {
    try {
      const department_id = Number(req.body.department_id);
      const faculty_code = String(req.body.faculty_code || "")
        .trim()
        .toUpperCase();
      const faculty_name = String(req.body.faculty_name || "").trim();
      const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
      const designation = String(req.body.designation || "").trim();
      if (!department_id || !faculty_code || !faculty_name)
        return res
          .status(400)
          .json({
            success: false,
            message: "Department, faculty code, and faculty name are required.",
          });
      if (faculty_code.length > 20 || faculty_name.length > 100)
        return res
          .status(400)
          .json({
            success: false,
            message: "Faculty code or name is too long.",
          });
      const emailError = facultyEmailValidation.getError(email);
      if (emailError)
        return res
          .status(400)
          .json({ success: false, message: emailError });
      if (
        !(await Department.findByPk(department_id, {
          attributes: ["department_id"],
        }))
      )
        return res
          .status(404)
          .json({
            success: false,
            message: "The selected department was not found.",
          });
      const data = await Faculty.create({
        faculty_uuid: crypto.randomUUID(),
        department_id,
        faculty_code,
        faculty_name,
        email: email || null,
        designation: designation || null,
        status: "active",
      });
      res
        .status(201)
        .json({ success: true, message: "Faculty added successfully.", data });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        const fields = new Set([
          ...Object.keys(error.fields || {}),
          ...(error.errors || []).map(item => item.path),
        ]);
        let message = "A faculty record with these details already exists. Review the existing faculty before creating another record.";
        if (fields.has("faculty_code"))
          message = "This faculty code already exists. Use the existing faculty record or enter a different faculty code.";
        else if (fields.has("email"))
          message = "This faculty email already exists. Use the existing faculty record or enter a different email address.";
        return res
          .status(409)
          .json({
            success: false,
            message,
          });
      }
      console.error("Faculty create error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to add faculty. Please try again.",
        });
    }
  },

  saveAssignments: async (req, res) => {
    let transaction;
    try {
      if (!Array.isArray(req.body.assignments) || !req.body.assignments.length)
        return res
          .status(400)
          .json({
            success: false,
            message: "Assignments must be provided as a non-empty list.",
          });
      const requested = [];
      const seenSubjects = new Set();
      for (const item of req.body.assignments) {
        if (!item || !['number', 'string'].includes(typeof item.subject_id) || !/^[1-9]\d*$/.test(String(item.subject_id)) || !Number.isSafeInteger(Number(item.subject_id)) || seenSubjects.has(String(item.subject_id)))
          return res
            .status(400)
            .json({
              success: false,
              message: "Each assignment must identify a valid, distinct subject.",
            });
        const ids = item.faculty_ids === undefined ? [item.faculty_1, item.faculty_2].filter(value => value !== undefined && value !== null && value !== '') : item.faculty_ids;
        if (!Array.isArray(ids) || ids.some(id => !['number', 'string'].includes(typeof id) || !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))) return res.status(400).json({ success: false, message: 'Provide a list of valid faculty IDs.' });
        if (cleanIds(ids).length !== ids.length)
          return res
            .status(400)
            .json({
              success: false,
              message:
                "The same faculty member cannot be assigned twice to one subject.",
            });
        seenSubjects.add(String(item.subject_id));
        requested.push({ subject_id: item.subject_id, faculty_ids: cleanIds(ids) });
      }
      transaction = await sequelize.transaction();
      const batchId = req.body.batch_id;
      const session = await ResultSession.findByPk(req.body.session_id, {
        attributes: ["session_id", "batch_id"],
        transaction,
      });
      if (!batchId)
        throw Object.assign(new Error("The selected batch is required."), {
          status: 400,
        });
      if (!session)
        throw Object.assign(new Error("The selected session was not found."), {
          status: 404,
        });
      if (String(session.batch_id) !== String(batchId))
        throw Object.assign(
          new Error(
            "The selected session does not belong to the selected batch.",
          ),
          { status: 400 },
        );
      const subjectIds = cleanIds(requested.map((item) => item.subject_id));
      const subjects = await Subject.findAll({
        where: {
          subject_id: { [Op.in]: subjectIds },
          session_id: session.session_id,
        },
        attributes: ["subject_id"],
        transaction,
      });
      if (subjects.length !== subjectIds.length)
        throw Object.assign(
          new Error(
            "One or more subjects do not belong to the selected session.",
          ),
          { status: 400 },
        );
      const allFacultyIds = cleanIds(
        requested.flatMap((item) => item.faculty_ids),
      );
      const faculty = await Faculty.findAll({
        where: { faculty_id: { [Op.in]: allFacultyIds }, status: "active" },
        attributes: ["faculty_id"],
        transaction,
      });
      if (faculty.length !== allFacultyIds.length)
        throw Object.assign(
          new Error(
            "One or more selected faculty members are invalid or inactive.",
          ),
          { status: 400 },
        );
      for (const item of requested) {
        const subject = await Subject.findByPk(item.subject_id, {
          transaction,
        });
        await subject.setFaculties(item.faculty_ids, {
          transaction,
        });
      }
      await transaction.commit();
      res.json({
        success: true,
        message: "Faculty assignments saved successfully.",
      });
    } catch (error) {
      if (transaction) await transaction.rollback();
      console.error("Faculty assignment save error:", error);
      res
        .status(error.status || 500)
        .json({
          success: false,
          message: error.status
            ? error.message
            : "Unable to save faculty assignments. Please try again.",
        });
    }
  },

  // Remove every Subject ↔ Faculty relationship of one subject.
  // The Faculty records themselves are never deleted.
  removeAssignments: async (req, res) => {
    try {
      const subject = await Subject.findByPk(req.params.subject_id, {
        attributes: ["subject_id"],
      });
      if (!subject)
        return res
          .status(404)
          .json({ success: false, message: "Subject not found." });
      const removed = await SubjectFaculty.destroy({
        where: { subject_id: subject.subject_id },
      });
      res.json({
        success: true,
        message: ASSIGNMENT_REMOVED_MESSAGE,
        data: { subject_id: subject.subject_id, removed },
      });
    } catch (error) {
      console.error("Faculty assignment remove error:", error);
      res
        .status(500)
        .json({ success: false, message: ASSIGNMENT_REMOVE_ERROR_MESSAGE });
    }
  },

  // Remove a single Subject ↔ Faculty relationship (Faculty 1 or Faculty 2),
  // leaving the other assignment and the Faculty record intact.
  removeAssignedFaculty: async (req, res) => {
    try {
      const subject = await Subject.findByPk(req.params.subject_id, {
        attributes: ["subject_id"],
      });
      if (!subject)
        return res
          .status(404)
          .json({ success: false, message: "Subject not found." });
      const removed = await SubjectFaculty.destroy({
        where: {
          subject_id: subject.subject_id,
          faculty_id: req.params.faculty_id,
        },
      });
      res.json({
        success: true,
        message: ASSIGNMENT_REMOVED_MESSAGE,
        data: { subject_id: subject.subject_id, removed },
      });
    } catch (error) {
      console.error("Faculty assignment remove error:", error);
      res
        .status(500)
        .json({ success: false, message: ASSIGNMENT_REMOVE_ERROR_MESSAGE });
    }
  },
};

module.exports = facultyController;
