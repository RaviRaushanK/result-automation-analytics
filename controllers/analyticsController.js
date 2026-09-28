/**
 * Analytics Controller — Phase 3.
 *
 * Thin HTTP layer only: extracts query params, delegates to the analytics
 * service, and shapes HTTP responses. It must never query the database,
 * construct SQL, or duplicate service normalization/business logic.
 *
 * Authorization: Analytics is restricted to the roles declared for it in
 * config/sidebar.json (admin, faculty). Sidebar visibility is navigation
 * only — endpoints enforce authorization explicitly.
 */

const analyticsService = require('../services/analyticsService');

// Roles allowed to access Analytics. Kept in sync with config/sidebar.json.
const ANALYTICS_ROLES = ['admin', 'faculty'];

const PAGE_STYLES = ['/css/analytics.css', '/css/dashboard.css'];

const PAGES = {
    overview: {
        view: 'analytics/overview',
        title: 'Analytics Overview - SRAAS',
        breadcrumb: [{ href: '/analytics/overview', label: 'Overview' }]
    },
    toppers: {
        view: 'analytics/toppers',
        title: 'Toppers (Candidates) - SRAAS',
        breadcrumb: [{ href: '/analytics/toppers', label: 'Toppers' }]
    },
    failed: {
        view: 'analytics/failed',
        title: 'Failed Students - SRAAS',
        breadcrumb: [{ href: '/analytics/failed', label: 'Failed Students' }]
    },
    subjects: {
        view: 'analytics/subjects',
        title: 'Subject Analysis - SRAAS',
        breadcrumb: [{ href: '/analytics/subjects', label: 'Subject Analysis' }]
    },
    semesters: {
        view: 'analytics/semesters',
        title: 'Semester Analysis - SRAAS',
        breadcrumb: [{ href: '/analytics/semesters', label: 'Semester Analysis' }]
    },
    students: {
        view: 'analytics/students',
        title: 'Student Analysis - SRAAS',
        breadcrumb: [{ href: '/analytics/students', label: 'Student Analysis' }]
    },
    revaluation: {
        view: 'analytics/revaluation',
        title: 'Revaluation Analysis - SRAAS',
        breadcrumb: [{ href: '/analytics/revaluation', label: 'Revaluation Analysis' }]
    }
};


// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Role-based authorization for Analytics. Runs after authMiddleware so
 * req.session.role / req.user are available. HTML requests get 403; JSON
 * requests get a JSON 403. No analytics data is sent before this passes.
 */
function analyticsAuthorization(req, res, next) {
    const role = req.session?.role || req.user?.role;
    if (role && ANALYTICS_ROLES.includes(role)) {
        return next();
    }

    if (req.accepts('html')) {
        const err = new Error('Forbidden');
        err.status = 403;
        return next(err);
    }

    return res.status(403).json({
        success: false,
        message: 'You are not authorized to access analytics.'
    });
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

/**
 * Consistent error handling: log server-side, return a safe generic JSON 500.
 * Database/service failures are never converted into fake empty analytics.
 * No SQL, stack traces, paths, or credentials are exposed.
 */
function apiError(res, err) {
    console.error('Analytics API error:', err.message || err);
    return res.status(500).json({
        success: false,
        message: 'Failed to load analytics data.'
    });
}

/**
 * Shared API handler factory: passes req.query straight to the service (the
 * service owns all filter normalization). Pagination options are passed
 * through for paginated resources; the service caps/normalizes them.
 */
function apiHandler(serviceMethod, { paginated = false } = {}) {
    return async (req, res) => {
        try {
            const options = paginated
                ? { limit: req.query.limit, offset: req.query.offset }
                : undefined;
            const result = await serviceMethod(req.query, options);
            return res.json(result);
        } catch (err) {
            return apiError(res, err);
        }
    };
}

/**
 * Page handler factory. Prepares only layout-level locals (title, styles,
 * breadcrumbs); no analytics queries run server-side — the future view
 * JavaScript will load data via the /analytics/api/* endpoints.
 */
function pageHandler(pageKey) {
    const page = PAGES[pageKey];
    return (req, res) => {
        res.render(page.view, {
            layout: 'layouts/main',
            title: page.title,
            pageStyles: PAGE_STYLES,
            breadcrumbItems: [
                { href: '/dashboard', label: 'Dashboard' },
                ...page.breadcrumb
            ],
            activeAnalyticsPage: '/analytics/' + pageKey,
            // Raw passthrough only; the service remains the sole normalizer.
            currentQuery: req.query || {}
        });
    };
}

const analyticsController = {
    // API endpoints — pass-through to service (filters normalized by service)
    overview: apiHandler(analyticsService.getOverview),
    toppers: apiHandler(analyticsService.getToppers, { paginated: true }),
    failed: apiHandler(analyticsService.getFailedStudents, { paginated: true }),
    subjects: apiHandler(analyticsService.getSubjectAnalytics),
    semesters: apiHandler(analyticsService.getSemesterAnalytics),
    students: apiHandler(analyticsService.getStudentAnalytics, { paginated: true }),
    gradeDistribution: apiHandler(analyticsService.getGradeDistribution),
    revaluation: apiHandler(analyticsService.getRevaluationAnalytics),
    revaluationBySubject: apiHandler(analyticsService.getRevaluationBySubject),
    revaluationDetail: apiHandler(analyticsService.getRevaluationDetail),
    filterOptions: async (req, res) => {
        try {
            const result = await analyticsService.getFilterOptions(
                req.params.scope,
                req.query
            );
            return res.json(result);
        } catch (err) {
            return apiError(res, err);
        }
    },

    // Page handlers — render-only shells (views arrive in Phase 4)
    overviewPage: pageHandler('overview'),
    toppersPage: pageHandler('toppers'),
    failedPage: pageHandler('failed'),
    subjectsPage: pageHandler('subjects'),
    semestersPage: pageHandler('semesters'),
    studentsPage: pageHandler('students'),
    revaluationPage: pageHandler('revaluation')
};

// Authorization middleware is exported alongside the handlers so the router
// can apply it router-wide.
module.exports = {
    ...analyticsController,
    analyticsAuthorization
};

