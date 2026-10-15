module.exports = (sequelize, DataTypes) => sequelize.define('AcademicCourse', {
  course_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  batch_id: { type: DataTypes.BIGINT, allowNull: false },
  semester: { type: DataTypes.STRING(20), allowNull: false },
  subject_code: { type: DataTypes.STRING(20), allowNull: false },
  subject_name: { type: DataTypes.STRING(100), allowNull: false },
  subject_type: { type: DataTypes.ENUM('theory', 'lab', 'project'), allowNull: false },
  credits: { type: DataTypes.INTEGER, allowNull: false },
  max_internal: { type: DataTypes.INTEGER, allowNull: false },
  max_external: { type: DataTypes.INTEGER, allowNull: false },
  max_marks: { type: DataTypes.INTEGER, allowNull: false },
  grading_scheme_version: { type: DataTypes.STRING(40), allowNull: true },
  is_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  roster_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  reviewed_by: { type: DataTypes.BIGINT, allowNull: true },
  reviewed_at: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' }
}, { tableName: 'academic_courses', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['batch_id', 'semester', 'subject_code'], name: 'unique_academic_course' }] });
