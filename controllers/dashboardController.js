const { Student, Subject, Result, SubjectResult, ResultSession, OcrExtraction, ImportLog, sequelize } = require('../database/models');
const ocrService = require('../services/ocrService');
const crypto = require('crypto');

// Helper function to generate UUID
const generateUUID = () => {
  return crypto.randomBytes(16).toString('hex');
};

const dashboardController = {

  // GET DASHBOARD PAGE
  getDashboard: async (req, res) => {
    try {
      const { academicYear, semester } = req.query;
      
      // Get available academic years and semesters for filters
      const sessions = await ResultSession.findAll({
        attributes: ['exam_year', 'semester'],
        group: ['exam_year', 'semester'],
        order: [['exam_year', 'DESC']]
      });

      const academicYears = [...new Set(sessions.map(s => s.exam_year))];
      const semesters = [...new Set(sessions.map(s => s.semester))];

      res.render('dashboard/index', {
        title: 'Dashboard',
        academicYears,
        semesters,
        selectedYear: academicYear || '',
        selectedSemester: semester || ''
      });
    } catch (err) {
      console.error('Error loading dashboard:', err);
      res.status(500).render('error', { message: 'Failed to load dashboard' });
    }
  },

  // GET DASHBOARD STATISTICS
  getDashboardStats: async (req, res) => {
    try {
      const { academicYear, semester } = req.query;
      
      // Build where clause for session filtering
      const sessionWhere = {};
      if (academicYear) sessionWhere.exam_year = academicYear;
      if (semester) sessionWhere.semester = semester;

      // Get sessions matching criteria
      const sessions = await ResultSession.findAll({
        where: sessionWhere,
        attributes: ['session_id']
      });
      const sessionIds = sessions.map(s => s.session_id);

      // Base query conditions
      const resultWhere = sessionIds.length > 0 ? { session_id: sessionIds } : {};

      // Total Students
      const totalStudents = await Student.count();

      // Get all results for the filtered sessions
      const results = sessionIds.length > 0 
        ? await Result.findAll({ where: { session_id: sessionIds } })
        : await Result.findAll();

      const totalResults = results.length;
      const passResults = results.filter(r => r.result_status === 'pass').length;
      const failResults = results.filter(r => r.result_status === 'fail').length;

      const passPercentage = totalResults > 0 ? ((passResults / totalResults) * 100).toFixed(2) : 0;
      const failPercentage = totalResults > 0 ? ((failResults / totalResults) * 100).toFixed(2) : 0;

      // Total Subjects
      const totalSubjects = sessionIds.length > 0
        ? await Subject.count({ where: { session_id: sessionIds } })
        : await Subject.count();

      // Highest Score and Average CGPA
      let highestScore = 0;
      let totalCGPA = 0;
      let cgpaCount = 0;

      if (results.length > 0) {
        highestScore = Math.max(...results.map(r => parseFloat(r.cgpa)));
        results.forEach(r => {
          totalCGPA += parseFloat(r.cgpa);
          cgpaCount++;
        });
      }

      const averageCGPA = cgpaCount > 0 ? (totalCGPA / cgpaCount).toFixed(2) : 0;

      res.json({
        totalStudents,
        totalPass: passResults,
        totalFail: failResults,
        passPercentage,
        failPercentage,
        totalSubjects,
        highestScore,
        averageCGPA
      });
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  },

  // GET TOP 10 SCORERS
  getTopScorers: async (req, res) => {
    try {
      const { academicYear, semester } = req.query;

      // Build session filter
      const sessionWhere = {};
      if (academicYear) sessionWhere.exam_year = academicYear;
      if (semester) sessionWhere.semester = semester;

      const sessions = await ResultSession.findAll({
        where: sessionWhere,
        attributes: ['session_id']
      });
      const sessionIds = sessions.map(s => s.session_id);

      // Query to get top 10 students with their results
      const query = `
        SELECT 
          s.student_name,
          s.usn,
          rs.semester,
          r.cgpa,
          r.sgpa,
          r.result_status,
          SUM(sr.marks) as total_marks,
          COUNT(sr.subject_id) as subject_count
        FROM results r
        JOIN students s ON r.student_id = s.student_id
        JOIN result_sessions rs ON r.session_id = rs.session_id
        JOIN subject_results sr ON r.result_id = sr.result_id
        ${sessionIds.length > 0 ? 'WHERE r.session_id IN (:sessionIds)' : ''}
        GROUP BY r.result_id, s.student_name, s.usn, rs.semester, r.cgpa, r.sgpa, r.result_status
        ORDER BY total_marks DESC
        LIMIT 10
      `;

      const replacements = sessionIds.length > 0 ? { sessionIds } : {};
      const [topScorers] = await sequelize.query(query, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      // Add rank
      const rankedScorers = topScorers.map((scorer, index) => ({
        ...scorer,
        rank: index + 1,
        percentage: scorer.subject_count > 0 ? ((scorer.total_marks / (scorer.subject_count * 100)) * 100).toFixed(2) : 0
      }));

      res.json(rankedScorers);
    } catch (err) {
      console.error('Error fetching top scorers:', err);
      res.status(500).json({ error: 'Failed to fetch top scorers' });
    }
  },

  // GET SUBJECT ANALYTICS
  getSubjectAnalytics: async (req, res) => {
    try {
      const { academicYear, semester } = req.query;

      // Build session filter
      const sessionWhere = {};
      if (academicYear) sessionWhere.exam_year = academicYear;
      if (semester) sessionWhere.semester = semester;

      const sessions = await ResultSession.findAll({
        where: sessionWhere,
        attributes: ['session_id']
      });
      const sessionIds = sessions.map(s => s.session_id);

      if (sessionIds.length === 0) {
        return res.json({ subjectWise: [], chartData: [] });
      }

      // Get subjects with their analytics
      const query = `
        SELECT 
          sub.subject_name,
          sub.subject_code,
          AVG(sr.marks) as average_marks,
          MAX(sr.marks) as highest_marks,
          MIN(sr.marks) as lowest_marks,
          SUM(CASE WHEN sr.result_status = 'pass' THEN 1 ELSE 0 END) as pass_count,
          COUNT(sr.subject_result_id) as total_count
        FROM subjects sub
        JOIN subject_results sr ON sub.subject_id = sr.subject_id
        JOIN results r ON sr.result_id = r.result_id
        WHERE r.session_id IN (:sessionIds)
        GROUP BY sub.subject_id, sub.subject_name, sub.subject_code
        ORDER BY sub.subject_name
      `;

      const [subjectAnalytics] = await sequelize.query(query, {
        replacements: { sessionIds },
        type: sequelize.QueryTypes.SELECT
      });

      // Calculate pass percentage for each subject
      const subjectWise = subjectAnalytics.map(subject => ({
        subjectName: subject.subject_name,
        subjectCode: subject.subject_code,
        averageMarks: parseFloat(subject.average_marks).toFixed(2),
        highestMarks: subject.highest_marks,
        lowestMarks: subject.lowest_marks,
        passPercentage: subject.total_count > 0 
          ? ((subject.pass_count / subject.total_count) * 100).toFixed(2) 
          : 0
      }));

      // Prepare chart data
      const chartData = subjectWise.map(subject => ({
        label: subject.subject_name,
        value: parseFloat(subject.averageMarks)
      }));

      res.json({
        subjectWise,
        chartData
      });
    } catch (err) {
      console.error('Error fetching subject analytics:', err);
      res.status(500).json({ error: 'Failed to fetch subject analytics' });
    }
  },

  // GET PASS VS FAIL DATA
  getPassFailData: async (req, res) => {
    try {
      const { academicYear, semester } = req.query;

      const sessionWhere = {};
      if (academicYear) sessionWhere.exam_year = academicYear;
      if (semester) sessionWhere.semester = semester;

      const sessions = await ResultSession.findAll({
        where: sessionWhere,
        attributes: ['session_id']
      });
      const sessionIds = sessions.map(s => s.session_id);

      const whereClause = sessionIds.length > 0 ? { session_id: sessionIds } : {};

      const passCount = await Result.count({ 
        where: { ...whereClause, result_status: 'pass' } 
      });
      const failCount = await Result.count({ 
        where: { ...whereClause, result_status: 'fail' } 
      });

      res.json({
        pass: passCount,
        fail: failCount
      });
    } catch (err) {
      console.error('Error fetching pass/fail data:', err);
      res.status(500).json({ error: 'Failed to fetch pass/fail data' });
    }
  },

  // GET RESULT TRENDS
  getResultTrends: async (req, res) => {
    try {
      const query = `
        SELECT 
          rs.exam_year,
          rs.semester,
          AVG(r.cgpa) as average_cgpa,
          COUNT(r.result_id) as total_students,
          SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END) as pass_count
        FROM results r
        JOIN result_sessions rs ON r.session_id = rs.session_id
        GROUP BY rs.exam_year, rs.semester
        ORDER BY rs.exam_year ASC, rs.semester ASC
      `;

      const [trends] = await sequelize.query(query, {
        type: sequelize.QueryTypes.SELECT
      });

      const trendData = trends.map(trend => ({
        label: `${trend.exam_year} - Sem ${trend.semester}`,
        averagePercentage: trend.total_students > 0 
          ? ((trend.pass_count / trend.total_students) * 100).toFixed(2) 
          : 0,
        averageCGPA: parseFloat(trend.average_cgpa).toFixed(2)
      }));

      res.json(trendData);
    } catch (err) {
      console.error('Error fetching result trends:', err);
      res.status(500).json({ error: 'Failed to fetch result trends' });
    }
  },

  // GET SEMESTER WISE PERFORMANCE
  getSemesterPerformance: async (req, res) => {
    try {
      const query = `
        SELECT 
          rs.semester,
          rs.exam_year,
          AVG(r.cgpa) as average_cgpa,
          COUNT(r.result_id) as total_students,
          SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END) as pass_count
        FROM results r
        JOIN result_sessions rs ON r.session_id = rs.session_id
        GROUP BY rs.semester, rs.exam_year
        ORDER BY rs.exam_year ASC, CAST(rs.semester AS UNSIGNED) ASC
      `;

      const [performance] = await sequelize.query(query, {
        type: sequelize.QueryTypes.SELECT
      });

      const performanceData = performance.map(p => ({
        label: `Sem ${p.semester} (${p.exam_year})`,
        averagePercentage: p.total_students > 0 
          ? ((p.pass_count / p.total_students) * 100).toFixed(2) 
          : 0,
        averageCGPA: parseFloat(p.average_cgpa).toFixed(2)
      }));

      res.json(performanceData);
    } catch (err) {
      console.error('Error fetching semester performance:', err);
      res.status(500).json({ error: 'Failed to fetch semester performance' });
    }
  },

  // GET UPLOAD PAGE
  getUploadPage: async (req, res) => {
    try {
      const sessions = await ResultSession.findAll({
        order: [['exam_year', 'DESC'], ['semester', 'ASC']]
      });

      res.render('dashboard/upload', {
        title: 'Upload Results',
        sessions
      });
    } catch (err) {
      console.error('Error loading upload page:', err);
      res.status(500).render('error', { message: 'Failed to load upload page' });
    }
  },

  // UPLOAD MARKSHEET
  uploadMarksheet: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Create import log entry
      const importLog = await ImportLog.create({
        session_id: sessionId,
        uploaded_by: req.user?.user_id || 1,
        file_name: req.file.originalname,
        file_path: req.file.path,
        status: 'processing'
      });

      res.json({
        success: true,
        message: 'File uploaded successfully',
        importId: importLog.import_id,
        filePath: req.file.path
      });
    } catch (err) {
      console.error('Error uploading marksheet:', err);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  },

  // PROCESS OCR
  processOCR: async (req, res) => {
    try {
      const { filePath, importId } = req.body;

      if (!filePath || !importId) {
        return res.status(400).json({ error: 'File path and import ID are required' });
      }

      // Process OCR
      const ocrResult = await ocrService.processImage(filePath);

      // Save OCR extraction
      const extraction = await OcrExtraction.create({
        import_id: importId,
        raw_text: ocrResult.rawText,
        extracted_json: ocrResult.extractedData,
        confidence_score: ocrResult.confidence,
        validation_status: 'pending'
      });

      res.json({
        success: true,
        extractionId: extraction.extraction_id,
        extractedData: ocrResult.extractedData,
        confidence: ocrResult.confidence
      });
    } catch (err) {
      console.error('Error processing OCR:', err);
      res.status(500).json({ error: 'Failed to process OCR' });
    }
  },

  // SAVE OCR DATA
  saveOCRData: async (req, res) => {
    try {
      const { extractionId, data } = req.body;

      if (!extractionId || !data || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid request data' });
      }

      const session = await sequelize.transaction();

      try {
        for (const record of data) {
          // Find or create student
          let student = await Student.findOne({
            where: { usn: record.usn }
          });

          if (!student) {
            student = await Student.create({
              student_uuid: generateUUID(),
              usn: record.usn,
              student_name: record.studentName,
              batch_id: 1, // Default batch, should be determined from session
              status: 'active'
            }, { transaction: session });
          }

          // Find or create subject
          let subject = await Subject.findOne({
            where: { 
              subject_code: record.subjectCode,
              session_id: record.sessionId 
            }
          });

          if (!subject) {
            subject = await Subject.create({
              subject_uuid: generateUUID(),
              session_id: record.sessionId,
              subject_code: record.subjectCode,
              subject_name: record.subjectName,
              subject_type: 'theory',
              credits: 3
            }, { transaction: session });
          }

          // Find or create result
          let result = await Result.findOne({
            where: { 
              student_id: student.student_id,
              session_id: record.sessionId 
            }
          });

          if (!result) {
            result = await Result.create({
              result_uuid: generateUUID(),
              student_id: student.student_id,
              session_id: record.sessionId,
              sgpa: 0,
              cgpa: 0,
              result_status: record.result || 'pass',
              failed_subject_count: 0
            }, { transaction: session });
          }

          // Create or update subject result
          await SubjectResult.upsert({
            result_id: result.result_id,
            subject_id: subject.subject_id,
            marks: record.marks,
            grade: record.grade || '',
            result_status: record.result || 'pass'
          }, { transaction: session });
        }

        // Update OCR extraction status
        await OcrExtraction.update(
          { validation_status: 'validated' },
          { 
            where: { extraction_id: extractionId },
            transaction: session 
          }
        );

        await session.commit();

        res.json({
          success: true,
          message: 'Data saved successfully'
        });
      } catch (error) {
        await session.rollback();
        throw error;
      }
    } catch (err) {
      console.error('Error saving OCR data:', err);
      res.status(500).json({ error: 'Failed to save data' });
    }
  },

  // DELETE OCR RECORD
  deleteOCRRecord: async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await OcrExtraction.destroy({
        where: { extraction_id: id }
      });

      if (!deleted) {
        return res.status(404).json({ error: 'OCR record not found' });
      }

      res.json({
        success: true,
        message: 'Record deleted successfully'
      });
    } catch (err) {
      console.error('Error deleting OCR record:', err);
      res.status(500).json({ error: 'Failed to delete record' });
    }
  },

  // UPDATE OCR RECORD
  updateOCRRecord: async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const [updated] = await OcrExtraction.update(
        updateData,
        { 
          where: { extraction_id: id },
          returning: true
        }
      );

      if (!updated) {
        return res.status(404).json({ error: 'OCR record not found' });
      }

      res.json({
        success: true,
        message: 'Record updated successfully'
      });
    } catch (err) {
      console.error('Error updating OCR record:', err);
      res.status(500).json({ error: 'Failed to update record' });
    }
  }
};

module.exports = dashboardController;