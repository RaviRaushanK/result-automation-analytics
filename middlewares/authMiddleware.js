/**
 * Authentication Middleware
 * Verifies session, redirects unauthenticated users to /login,
 * and attaches authenticated administrator to req.user and res.locals.user.
 */
module.exports = function authMiddleware(req, res, next) {

    if (req.session?.adminId) {
        return next();
    }

    if (req.accepts('html')) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/login');
    }

    return res.status(401).json({
        error: 'Authentication required'
    });

};