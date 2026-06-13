const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const env = require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  logging: false,
  define: {
    underscored: true,
    freezeTableName: true,
    timestamps: false
  }
});

// Import models
const Department = require('../database/models/Department')(sequelize, DataTypes);
const AdminUser = require('../database/models/AdminUser')(sequelize, DataTypes);
const Batch = require('../database/models/Batch')(sequelize, DataTypes);
const Faculty = require('../database/models/Faculty')(sequelize, DataTypes);
const ResultSession = require('../database/models/ResultSession')(sequelize, DataTypes);
const Subject = require('../database/models/Subject')(sequelize, DataTypes);
const SubjectFaculty = require('../database/models/SubjectFaculty')(sequelize, DataTypes);
const Student = require('../database/models/Student')(sequelize, DataTypes);
const Result = require('../database/models/Result')(sequelize, DataTypes);
const SubjectResult = require('../database/models/SubjectResult')(sequelize, DataTypes);
const RevaluationResult = require('../database/models/RevaluationResult')(sequelize, DataTypes);
const ImportLog = require('../database/models/ImportLog')(sequelize, DataTypes);
const OcrExtraction = require('../database/models/OcrExtraction')(sequelize, DataTypes);
const SystemSetting = require('../database/models/SystemSetting')(sequelize, DataTypes);

// Associations

// Department ↔ Batch (1:M)
Department.hasMany(Batch, { foreignKey: 'department_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Batch.belongsTo(Department, { foreignKey: 'department_id' });

// Department ↔ Faculty (1:M)
Department.hasMany(Faculty, { foreignKey: 'department_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Faculty.belongsTo(Department, { foreignKey: 'department_id' });

// Batch ↔ ResultSession (1:M)
Batch.hasMany(ResultSession, { foreignKey: 'batch_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
ResultSession.belongsTo(Batch, { foreignKey: 'batch_id' });

// ResultSession ↔ Subject (1:M)
ResultSession.hasMany(Subject, { foreignKey: 'session_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Subject.belongsTo(ResultSession, { foreignKey: 'session_id' });

// Subject ↔ Faculty (M:N) via SubjectFaculty
Subject.belongsToMany(Faculty, {
  through: SubjectFaculty,
  foreignKey: 'subject_id',
  otherKey: 'faculty_id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
Faculty.belongsToMany(Subject, {
  through: SubjectFaculty,
  foreignKey: 'faculty_id',
  otherKey: 'subject_id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Batch ↔ Student (1:M)
Batch.hasMany(Student, { foreignKey: 'batch_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Student.belongsTo(Batch, { foreignKey: 'batch_id' });

// Student ↔ Result (1:M)
Student.hasMany(Result, { foreignKey: 'student_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Result.belongsTo(Student, { foreignKey: 'student_id' });

// ResultSession ↔ Result (1:M)
ResultSession.hasMany(Result, { foreignKey: 'session_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Result.belongsTo(ResultSession, { foreignKey: 'session_id' });

// Result ↔ SubjectResult (1:M)
Result.hasMany(SubjectResult, { foreignKey: 'result_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SubjectResult.belongsTo(Result, { foreignKey: 'result_id' });

// Subject ↔ SubjectResult (1:M)
Subject.hasMany(SubjectResult, { foreignKey: 'subject_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SubjectResult.belongsTo(Subject, { foreignKey: 'subject_id' });

// SubjectResult ↔ RevaluationResult (1:1)
SubjectResult.hasOne(RevaluationResult, { foreignKey: 'subject_result_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RevaluationResult.belongsTo(SubjectResult, { foreignKey: 'subject_result_id' });

// ResultSession ↔ ImportLog (1:M)
ResultSession.hasMany(ImportLog, { foreignKey: 'session_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
ImportLog.belongsTo(ResultSession, { foreignKey: 'session_id' });

// AdminUser ↔ ImportLog (1:M) – uploader
AdminUser.hasMany(ImportLog, { foreignKey: 'uploaded_by', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
ImportLog.belongsTo(AdminUser, { foreignKey: 'uploaded_by' });

// ImportLog ↔ OcrExtraction (1:M)
ImportLog.hasMany(OcrExtraction, { foreignKey: 'import_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OcrExtraction.belongsTo(ImportLog, { foreignKey: 'import_id' });

module.exports = {
  sequelize,
  Department,
  AdminUser,
  Batch,
  Faculty,
  ResultSession,
  Subject,
  SubjectFaculty,
  Student,
  Result,
  SubjectResult,
  RevaluationResult,
  ImportLog,
  OcrExtraction,
  SystemSetting
};