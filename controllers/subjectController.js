const crypto = require("crypto");
const { Op } = require("sequelize");
const {
  Subject,
  SubjectFaculty,
  SubjectResult,
  ResultSession,
  Faculty,
  sequelize,
} = require("../database/models");

// Shown when a subject is still referenced by student result data
// (subject_results.subject_id uses ON DELETE RESTRICT). The raw database error
// is only logged, never returned to the administrator.
const SUBJECT_IN_USE_MESSAGE =
  "This subject cannot be deleted because it is already used in existing result data.";

const SUBJECT_PAGE_STYLES = [
  "/css/dashboard.css",
  "/css/batches.css",
  "/css/subjects.css",
];
const SUBJECT_TYPES = ["theory", "lab", "project"];

function generateUuid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function validateSubject(body) {
  const errors = [];
  const subject_code = String(
    body.subject_code == null ? "" : body.subject_code,
  )
    .trim()
    .toUpperCase();
  const subject_name = String(
    body.subject_name == null ? "" : body.subject_name,
  ).trim();
  const subject_type = String(
    body.subject_type == null ? "" : body.subject_type,
  )
    .trim()
    .toLowerCase();
  const credits = Number(body.credits);
  const max_internal = Number(body.max_internal);
  const max_external = Number(body.max_external);
  const max_marks = Number(body.max_marks);
  if (!subject_code) errors.push("Subject code is required.");
  else if (subject_code.length > 20)
    errors.push("Subject code must be 20 characters or fewer.");
  if (!subject_name) errors.push("Subject name is required.");
  else if (subject_name.length > 100)
    errors.push("Subject name must be 100 characters or fewer.");
  if (!SUBJECT_TYPES.includes(subject_type))
    errors.push("Select a valid subject type.");
  if (!Number.isInteger(credits) || credits < 0 || credits > 100)
    errors.push("Credits must be a whole number between 0 and 100.");
  if (
    !Number.isInteger(max_internal) ||
    max_internal < 0 ||
    max_internal > 10000
  )
    errors.push(
      "Maximum internal marks must be a valid non-negative whole number.",
    );
  if (
    !Number.isInteger(max_external) ||
    max_external < 0 ||
    max_external > 10000
  )
    errors.push(
      "Maximum external marks must be a valid non-negative whole number.",
    );
  if (!Number.isInteger(max_marks) || max_marks < 0 || max_marks > 20000)
    errors.push("Maximum marks must be a valid non-negative whole number.");
  if (
    Number.isInteger(max_internal) &&
    Number.isInteger(max_external) &&
    Number.isInteger(max_marks) &&
    max_marks !== max_internal + max_external
  )
    errors.push("Maximum marks must equal internal marks plus external marks.");
  return {
    errors,
    data: {
      subject_code,
      subject_name,
      subject_type,
      credits,
      max_internal,
      max_external,
      max_marks,
    },
  };
}

const subjectController = {
  all: async (req, res) => {
    try {
      const accept = String(req.get("Accept") || "").toLowerCase();
      const browserDocument =
        accept.includes("text/html") ||
        req.get("Sec-Fetch-Dest") === "document";
      if (browserDocument && req.query.format !== "json")
        return res.render("subjects/index", {
          layout: "layouts/main",
          title: "Subjects Management - SRAAS",
          pageStyles: SUBJECT_PAGE_STYLES,
          breadcrumbItems: [
            { href: "#", label: "Academic Management" },
            { label: "Subjects" },
          ],
        });
      const data = await Subject.findAll({
        order: [
          ["session_id", "ASC"],
          ["subject_code", "ASC"],
        ],
      });
      res.status(200).json(data);
    } catch (error) {
      console.error("Subjects list error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to load subjects right now. Please try again.",
        });
    }
  },
  getById: async (req, res) => {
    try {
      const data = await Subject.findByPk(req.params.id, {
        include: [
          {
            model: Faculty,
            attributes: [
              "faculty_id",
              "faculty_code",
              "faculty_name",
              "designation",
              "status",
            ],
            through: { attributes: [] },
          },
        ],
      });
      if (!data)
        return res
          .status(404)
          .json({ success: false, message: "Subject not found." });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Subject get error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to load the subject right now. Please try again.",
        });
    }
  },
  getBySession: async (req, res) => {
    try {
      const session = await ResultSession.findByPk(req.params.session_id, {
        attributes: ["session_id"],
      });
      if (!session)
        return res
          .status(404)
          .json({ success: false, message: "Session not found." });
      const data = await Subject.findAll({
        where: { session_id: session.session_id },
        include: [
          {
            model: Faculty,
            attributes: [
              "faculty_id",
              "faculty_code",
              "faculty_name",
              "designation",
              "status",
            ],
            through: { attributes: [] },
          },
        ],
        order: [["subject_code", "ASC"]],
      });
      res.json(data);
    } catch (error) {
      console.error("Subjects by session error:", error);
      res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load subjects for this session. Please try again.",
        });
    }
  },

  create: async (req, res) => {
    try {
      const check = validateSubject(req.body);
      if (!req.body.session_id) check.errors.unshift("Session is required.");
      if (check.errors.length)
        return res
          .status(400)
          .json({
            success: false,
            message: check.errors[0],
            errors: check.errors,
          });
      const session = await ResultSession.findByPk(req.body.session_id, {
        attributes: ["session_id", "batch_id"],
      });
      if (!session)
        return res
          .status(404)
          .json({
            success: false,
            message: "The selected session was not found.",
          });
      if (
        req.body.batch_id !== undefined &&
        String(req.body.batch_id) !== String(session.batch_id)
      )
        return res
          .status(400)
          .json({
            success: false,
            message:
              "The selected session does not belong to the selected batch.",
          });
      // Subject codes may be repeated across batches and sessions, but not within this batch/session.
      const duplicate = await Subject.findOne({
        where: {
          session_id: session.session_id,
          subject_code: check.data.subject_code,
        },
      });
      if (duplicate)
        return res
          .status(409)
          .json({
            success: false,
            message:
              "This subject code already exists in the selected batch and session.",
          });
      const data = await Subject.create({
        ...check.data,
        session_id: session.session_id,
        subject_uuid: generateUuid(),
      });
      res
        .status(201)
        .json({
          success: true,
          message: "Subject created successfully.",
          data,
        });
    } catch (error) {
      console.error("Subject create error:", error);
      if (error.name === "SequelizeUniqueConstraintError")
        return res
          .status(409)
          .json({
            success: false,
            message:
              "This subject code already exists in the selected session.",
          });
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to create the subject. Please try again.",
        });
    }
  },

  update: async (req, res) => {
    try {
      const subject = await Subject.findByPk(req.params.id);
      if (!subject)
        return res
          .status(404)
          .json({ success: false, message: "Subject not found." });
      const check = validateSubject(req.body);
      if (check.errors.length)
        return res
          .status(400)
          .json({
            success: false,
            message: check.errors[0],
            errors: check.errors,
          });
      // A subject code is unique only for the subject's existing batch/session context.
      const duplicate = await Subject.findOne({
        where: {
          session_id: subject.session_id,
          subject_code: check.data.subject_code,
          subject_id: { [Op.ne]: subject.subject_id },
        },
      });
      if (duplicate)
        return res
          .status(409)
          .json({
            success: false,
            message:
              "This subject code already exists in the selected batch and session.",
          });
      await subject.update(check.data);
      const data = await Subject.findByPk(subject.subject_id);
      res.json({
        success: true,
        message: "Subject updated successfully.",
        data,
      });
    } catch (error) {
      console.error("Subject update error:", error);
      if (error.name === "SequelizeUniqueConstraintError")
        return res
          .status(409)
          .json({
            success: false,
            message:
              "This subject code already exists in the selected session.",
          });
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to update the subject. Please try again.",
        });
    }
  },

  delete: async (req, res) => {
    try {
      // Resolve the exact subject being removed (never trust anything else).
      const subject = await Subject.findByPk(req.params.id, {
        attributes: ["subject_id", "subject_code", "session_id"],
      });
      if (!subject)
        return res
          .status(404)
          .json({ success: false, message: "Subject not found." });

      // Safety check: a subject that already produced student results must never
      // be removed, otherwise existing result data would be orphaned/broken.
      const resultReferences = await SubjectResult.count({
        where: { subject_id: subject.subject_id },
      });
      if (resultReferences)
        return res
          .status(409)
          .json({ success: false, message: SUBJECT_IN_USE_MESSAGE });

      // Subject ↔ Faculty assignments belong to the subject, so the relationship
      // rows are released together with the subject. Faculty records themselves
      // are never touched. The whole delete runs in one transaction.
      await sequelize.transaction(async (transaction) => {
        await SubjectFaculty.destroy({
          where: { subject_id: subject.subject_id },
          transaction,
        });
        await subject.destroy({ transaction });
      });

      res.json({ success: true, message: "Subject deleted successfully." });
    } catch (error) {
      console.error("Subject delete error:", error);
      // Foreign-key protection (the subject is still referenced somewhere else):
      // answer with a friendly message instead of the raw database error.
      if (
        error.name === "SequelizeForeignKeyConstraintError" ||
        error.original?.code === "ER_ROW_IS_REFERENCED_2"
      )
        return res
          .status(409)
          .json({ success: false, message: SUBJECT_IN_USE_MESSAGE });
      res
        .status(500)
        .json({
          success: false,
          message: "Unable to delete this subject. Please try again.",
        });
    }
  },
};

module.exports = subjectController;
