const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../config/.env')
});

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false,
    define: {
      underscored: true,
      freezeTableName: true,
      timestamps: false
    }
  }
);

// Import models
const Department = require('./Department')(sequelize, DataTypes);
const AdminUser = require('./AdminUser')(sequelize, DataTypes);
const Batch = require('./Batch')(sequelize, DataTypes);
const Faculty = require('./Faculty')(sequelize, DataTypes);
const ResultSession = require('./ResultSession')(sequelize, DataTypes);
const Subject = require('./Subject')(sequelize, DataTypes);
const SubjectFaculty = require('./SubjectFaculty')(sequelize, DataTypes);
const Student = require('./Student')(sequelize, DataTypes);
const Result = require('./Result')(sequelize, DataTypes);
const SubjectResult = require('./SubjectResult')(sequelize, DataTypes);
const RevaluationResult = require('./RevaluationResult')(sequelize, DataTypes);
const ImportLog = require('./ImportLog')(sequelize, DataTypes);
const OcrExtraction = require('./OcrExtraction')(sequelize, DataTypes);
const SystemSetting = require('./SystemSetting')(sequelize, DataTypes);

// ============================================
// Associations
// ============================================

// Department ↔ Batch
Department.hasMany(Batch, { foreignKey: 'department_id' });
Batch.belongsTo(Department, { foreignKey: 'department_id' });

// Department ↔ Faculty
Department.hasMany(Faculty, { foreignKey: 'department_id' });
Faculty.belongsTo(Department, { foreignKey: 'department_id' });

// Batch ↔ ResultSession
Batch.hasMany(ResultSession, { foreignKey: 'batch_id' });
ResultSession.belongsTo(Batch, { foreignKey: 'batch_id' });

// ResultSession ↔ Subject
ResultSession.hasMany(Subject, { foreignKey: 'session_id' });
Subject.belongsTo(ResultSession, { foreignKey: 'session_id' });

// Subject ↔ Faculty (Many-to-Many)
Subject.belongsToMany(Faculty, {
  through: SubjectFaculty,
  foreignKey: 'subject_id',
  otherKey: 'faculty_id'
});

Faculty.belongsToMany(Subject, {
  through: SubjectFaculty,
  foreignKey: 'faculty_id',
  otherKey: 'subject_id'
});

// Batch ↔ Student
Batch.hasMany(Student, { foreignKey: 'batch_id' });
Student.belongsTo(Batch, { foreignKey: 'batch_id' });

// Student ↔ Result
Student.hasMany(Result, { foreignKey: 'student_id' });
Result.belongsTo(Student, { foreignKey: 'student_id' });

// ResultSession ↔ Result
ResultSession.hasMany(Result, { foreignKey: 'session_id' });
Result.belongsTo(ResultSession, { foreignKey: 'session_id' });

// Result ↔ SubjectResult
Result.hasMany(SubjectResult, { foreignKey: 'result_id' });
SubjectResult.belongsTo(Result, { foreignKey: 'result_id' });

// Subject ↔ SubjectResult
Subject.hasMany(SubjectResult, { foreignKey: 'subject_id' });
SubjectResult.belongsTo(Subject, { foreignKey: 'subject_id' });

// SubjectResult ↔ RevaluationResult
SubjectResult.hasOne(RevaluationResult, {
  foreignKey: 'subject_result_id'
});

RevaluationResult.belongsTo(SubjectResult, {
  foreignKey: 'subject_result_id'
});

// ResultSession ↔ ImportLog
ResultSession.hasMany(ImportLog, { foreignKey: 'session_id' });
ImportLog.belongsTo(ResultSession, { foreignKey: 'session_id' });

// AdminUser ↔ ImportLog
AdminUser.hasMany(ImportLog, { foreignKey: 'uploaded_by' });
ImportLog.belongsTo(AdminUser, { foreignKey: 'uploaded_by' });

// ImportLog ↔ OcrExtraction
ImportLog.hasMany(OcrExtraction, { foreignKey: 'import_id' });
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