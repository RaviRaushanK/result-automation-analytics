const { Op, fn, col, literal } = require('sequelize');
const {
    Batch,
    Result,
    ResultSession,
    Student,
    Subject,
    SubjectResult
} = require('../database/models');
const { POINTS } = require('../services/academicPolicy');

const DASHBOARD_PAGE_STYLES = ['/css/dashboard.css?v=20261016-2'];

// Build a where clause for ResultSession from query params
function buildSessionFilter(query) {
    const where = {};
    if (query.batch_id) {
        if (!/^\d+$/.test(query.batch_id) || !Number.isSafeInteger(Number(query.batch_id)) || Number(query.batch_id) < 1) {
            throw Object.assign(new Error('Select a valid batch.'), { status: 400 });
        }
        where.batch_id = Number(query.batch_id);
    }
    if (query.semester) {
        if (!/^[1-9]\d?$/.test(query.semester)) throw Object.assign(new Error('Select a valid semester.'), { status: 400 });
        where.semester = query.semester;
    }
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
            const batches = await Batch.findAll({
                attributes: ['batch_id', 'batch_name', 'start_year', 'end_year'],
                order: [['start_year', 'DESC'], ['batch_name', 'ASC']],
                raw: true
            });
            const semesters = await ResultSession.findAll({
                attributes: ['batch_id', 'semester'],
                order: [['semester', 'ASC']],
                raw: true
            });
            res.render('dashboard/index', {
                ...base,
                batches: batches.map(b => ({
                    batch_id: b.batch_id,
                    batch_name: b.batch_name
                })),
                semesters: [...new Set(semesters.map(s => s.semester))],
                batchSemesters: semesters
            });
        } catch (err) {
            console.error('Dashboard render error:', err);
            res.render('dashboard/index', {
                ...base,
                batches: [],
                semesters: [],
                batchSemesters: []
            });
        }
    },

    // GET /dashboard/analytics - statistics + subject-wise averages
    analytics: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = { session_id: { [Op.in]: sessionIds } };
            const subjectWhere = { session_id: { [Op.in]: sessionIds } };

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

            // Highest score
            const highestScore = await SubjectResult.max('marks', {
                include: [{ model: Result, where: resultWhere, attributes: [] }]
            });

            // Average CGPA
            const cgpaAgg = await Result.findOne({
                where: resultWhere,
                attributes: [[fn('AVG', col('cgpa')), 'avgCgpa']],
                raw: true
            });
            const averageCGPA = cgpaAgg?.avgCgpa == null ? null : Number(Number(cgpaAgg.avgCgpa).toFixed(2));

            // Subject-wise averages
            const subjectAverages = await SubjectResult.findAll({
                attributes: [
                    [col('Subject.subject_id'), 'subject_id'],
                    [col('Subject.subject_code'), 'subject_code'],
                    [col('Subject.subject_name'), 'subject_name'],
                    [col('Subject.max_marks'), 'max_marks'],
                    [fn('AVG', col('SubjectResult.marks')), 'average_marks'],
                    [fn('COUNT', col('SubjectResult.subject_result_id')), 'attempted'],
                    [literal("SUM(CASE WHEN SubjectResult.result_status = 'pass' THEN 1 ELSE 0 END)"), 'passed'],
                    [literal("SUM(CASE WHEN SubjectResult.result_status = 'fail' THEN 1 ELSE 0 END)"), 'failed']
                ],
                include: [{ model: Subject, attributes: [], where: subjectWhere }, { model: Result, attributes: [], where: resultWhere }],
                group: ['Subject.subject_id', 'Subject.subject_code', 'Subject.subject_name', 'Subject.max_marks'],
                order: [[fn('AVG', col('SubjectResult.marks')), 'DESC']],
                raw: true
            });

            const gradeRows = await SubjectResult.findAll({
                attributes: ['grade', [fn('COUNT', col('SubjectResult.subject_result_id')), 'count']],
                include: [{ model: Subject, attributes: [], where: subjectWhere }, { model: Result, attributes: [], where: resultWhere }],
                group: ['SubjectResult.grade'], order: [['grade', 'ASC']], raw: true
            });
            const gradeCounts = new Map(Object.keys(POINTS).map(grade => [grade, 0]));
            let missingGrades = 0;
            for (const row of gradeRows) {
                const grade = String(row.grade ?? '').trim().toUpperCase();
                const count = Number(row.count);
                if (!grade) missingGrades += count;
                else gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + count);
            }
            const gradedAttempts = [...gradeCounts.values()].reduce((sum, count) => sum + count, 0);
            const gradeTotal = gradedAttempts + missingGrades;
            const gradeDistribution = gradeTotal ? [...gradeCounts].map(([grade, count]) => ({ grade, count })) : [];
            if (missingGrades) gradeDistribution.push({ grade: 'Not recorded', count: missingGrades });

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
                        highestScore: highestScore == null ? null : Number(highestScore),
                        averageCGPA
                    },
                    subjectAverages: subjectAverages.map(s => ({
                        subject_id: s.subject_id,
                        subject_code: s.subject_code,
                        subject_name: s.subject_name,
                        max_marks: Number(s.max_marks),
                        average_marks: Number(Number(s.average_marks).toFixed(2)),
                        attempted: Number(s.attempted), passed: Number(s.passed), failed: Number(s.failed),
                        pass_percentage: Number(s.attempted) ? Number((Number(s.passed) / Number(s.attempted) * 100).toFixed(2)) : 0
                    })),
                    gradeDistribution: gradeDistribution.map(row => ({ ...row, percentage: Number((row.count / gradeTotal * 100).toFixed(2)) })),
                    gradeSummary: { graded: gradedAttempts, missing: missingGrades, total: gradeTotal },
                    basis: 'original', attempt: 'all'
                }
            });
        } catch (err) {
            console.error('Analytics error:', err);
            res.status(err.status || 500).json({ success: false, message: err.status === 400 ? err.message : 'Unable to load dashboard analytics. Please try again.' });
        }
    },

    // GET /dashboard/pass-fail - pass/fail counts for charts
    passFail: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = { session_id: { [Op.in]: sessionIds } };
            const pass = await Result.count({ where: { ...resultWhere, result_status: 'pass' } });
            const fail = await Result.count({ where: { ...resultWhere, result_status: 'fail' } });
            res.json({ success: true, data: { pass, fail } });
        } catch (err) {
            console.error('Pass-fail error:', err);
            res.status(err.status || 500).json({ success: false, message: err.status === 400 ? err.message : 'Unable to load result counts. Please try again.' });
        }
    },

    // GET /dashboard/top-scorers - top 10 scorers
    // Only PASSED results are eligible, mirroring the Toppers policy: a failed
    // result never belongs in a "top scorers" list even if its CGPA is high.
    // Ordering falls back to result_id so the top 10 is deterministic when
    // several students share the same CGPA/SGPA.
    topScorers: async (req, res) => {
        try {
            const sessionIds = await resolveSessionIds(buildSessionFilter(req.query));
            const resultWhere = { session_id: { [Op.in]: sessionIds } };
            const topScorers = await Result.findAll({
                where: { ...resultWhere, result_status: 'pass', cgpa: { [Op.ne]: null } },
                attributes: ['result_id', 'session_id', 'attempt_no', 'sgpa', 'cgpa', 'result_status'],
                include: [{ model: Student, attributes: ['student_id', 'batch_id', 'usn', 'student_name'], required: true }],
                order: [['cgpa', 'DESC'], ['sgpa', 'DESC'], ['result_id', 'ASC']],
                limit: 10,
                raw: true,
                nest: true
            });
            res.json({
                success: true,
                data: topScorers.map((r, i) => ({
                    rank: i + 1,
                    student_name: r.Student?.student_name || 'N/A',
                    usn: r.Student?.usn || 'N/A',
                    student_id: r.Student.student_id,
                    batch_id: r.Student.batch_id,
                    session_id: r.session_id,
                    attempt_no: r.attempt_no,
                    sgpa: r.sgpa,
                    cgpa: r.cgpa,
                    result_status: r.result_status
                }))
            });
        } catch (err) {
            console.error('Top scorers error:', err);
            res.status(err.status || 500).json({ success: false, message: err.status === 400 ? err.message : 'Unable to load top scorers. Please try again.' });
        }
    }
};

module.exports = dashboardController;
