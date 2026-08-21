const { Op } = require('sequelize');
const { fn, col } = require('sequelize');
const {
    Result,
    ResultSession,
    Student,
    Subject,
    SubjectResult
} = require('../database/models');

const DASHBOARD_PAGE_STYLES = ['/css/dashboard.css'];

// Build a where clause for ResultSession from query params
function buildSessionFilter(query) {
    const where = {};
    if (query.academicYear) where.exam_year = query.academicYear;
    if (query.semester) where.semester = query.semester;
    return where;
}

// Resolve matching session IDs from the filter
async function resolveSessionIds(filter) {
    const sessions = await ResultSession.findAll({
        where: filter,
        attributes: ['session_id'],
        raw: true
    });
    return sessions.map(s => s.session_id);
}

const dashboardController = {
    // Render the dashboard page
    index: async (req, res) => {
        const base = {
            layout: 'layouts/main',
            title: 'Dashboard - SRAAS',
            pageStyles: DASHBOARD_PAGE_STYLES,
            breadcrumbItems: [{ href: '/dashboard', label: 'Dashboard' }]
        };
        try {
            const years = await ResultSession.findAll({
                attributes: [[fn('DISTINCT', col('exam_year')), 'exam_year']],
                order: [['exam_year', 'DESC']],
                raw: true
            });
            const semesters = await ResultSession.findAll({
                attributes: [[fn('DISTINCT', col('semester')), 'semester']],
                order: [['semester', 'ASC']],
                raw: true
            });
            res.render('dashboard/index', {
                ...base,
                academicYears: years.map(y => y.exam_year),
                semesters: semesters.map(s => s.semester)
            });
        } catch (err) {
            console.error('Dashboard render error:', err);
            res.render('dashboard/index', {
                ...base,
                academicYears: [],
                semesters: []
            });
        }
    },

    // GET /dashboard/analytics - statistics + subject-wise averages
    analytics: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = sessionIds.length ? { session_id: { [Op.in]: sessionIds } } : {};
            const subjectWhere = sessionIds.length ? { session_id: { [Op.in]: sessionIds } } : {};

            // Statistics
            const totalStudents = await Result.count({
                where: resultWhere,
                distinct: true,
                col: 'student_id'
            });
            const totalPass = await Result.count({ where: { ...resultWhere, result_status: 'pass' } });
            const totalFail = await Result.count({ where: { ...resultWhere, result_status: 'fail' } });
            const totalResults = totalPass + totalFail;
            const passPercentage = totalResults ? parseFloat(((totalPass / totalResults) * 100).toFixed(2)) : 0;
            const failPercentage = totalResults ? parseFloat(((totalFail / totalResults) * 100).toFixed(2)) : 0;
            const totalSubjects = await Subject.count({ where: subjectWhere });

            // Highest score (max marks across subject_results for filtered sessions)
            const highestScore = await SubjectResult.max('marks', {
                include: [{ model: Result, where: resultWhere, attributes: [] }]
            });

            // Average CGPA
            const cgpaAgg = await Result.findOne({
                where: resultWhere,
                attributes: [[fn('AVG', col('cgpa')), 'avgCgpa']],
                raw: true
            });
            const averageCGPA = cgpaAgg?.avgCgpa ? parseFloat(parseFloat(cgpaAgg.avgCgpa).toFixed(2)) : 0;

            // Subject-wise averages
            const subjectAverages = await SubjectResult.findAll({
                attributes: [
                    [col('Subject.subject_name'), 'subject_name'],
                    [fn('AVG', col('SubjectResult.marks')), 'average_marks']
                ],
                include: [{ model: Subject, attributes: [], where: subjectWhere }],
                group: ['Subject.subject_id', 'Subject.subject_name'],
                order: [[fn('AVG', col('SubjectResult.marks')), 'DESC']],
                raw: true
            });

            res.json({
                success: true,
                data: {
                    statistics: {
                        totalStudents,
                        totalPass,
                        totalFail,
                        passPercentage,
                        failPercentage,
                        totalSubjects,
                        highestScore: highestScore || 0,
                        averageCGPA
                    },
                    subjectAverages: subjectAverages.map(s => ({
                        subject_name: s.subject_name,
                        average_marks: parseFloat(parseFloat(s.average_marks).toFixed(2))
                    }))
                }
            });
        } catch (err) {
            console.error('Analytics error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // GET /dashboard/pass-fail - pass/fail counts for charts
    passFail: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = sessionIds.length ? { session_id: { [Op.in]: sessionIds } } : {};
            const pass = await Result.count({ where: { ...resultWhere, result_status: 'pass' } });
            const fail = await Result.count({ where: { ...resultWhere, result_status: 'fail' } });
            res.json({ success: true, data: { pass, fail } });
        } catch (err) {
            console.error('Pass-fail error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // GET /dashboard/top-scorers - top 10 scorers
    topScorers: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = sessionIds.length ? { session_id: { [Op.in]: sessionIds } } : {};
            const topScorers = await Result.findAll({
                where: resultWhere,
                attributes: ['result_id', 'sgpa', 'cgpa', 'result_status'],
                include: [{ model: Student, attributes: ['student_name', 'usn'] }],
                order: [['cgpa', 'DESC'], ['sgpa', 'DESC']],
                limit: 10,
                raw: true,
                nest: true
            });
            res.json({
                success: true,
                data: topScorers.map(r => ({
                    student_name: r.Student?.student_name || 'N/A',
                    usn: r.Student?.usn || 'N/A',
                    sgpa: r.sgpa,
                    cgpa: r.cgpa,
                    result_status: r.result_status
                }))
            });
        } catch (err) {
            console.error('Top scorers error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    }
};

module.exports = dashboardController;