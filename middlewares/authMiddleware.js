/**
 * Authentication Middleware
 * Verifies session, redirects unauthenticated users to /login,
 * reloads current account permissions, and attaches the account to the request.
 */
module.exports = async function authMiddleware(req, res, next) {

    if (req.session?.adminId) {
        try {
            if (!req.account) req.account = await require('../repositories/settingsRepository').account(req.session.adminId);
            if (!req.account) {
                return require('./accountAccessResponse')(req, res);
            }
            const account = req.account;
            req.user = { adminId: account.admin_id, username: account.username, role: account.role, facultyId: account.faculty_id };
            req.session.role = account.role;
            req.session.username = account.username;
            req.session.user = req.user;
            res.locals.user = req.user;
            return require('./menuMiddleware')(req, res, next);
        } catch (err) { return next(err); }
    }

    if (req.accepts('html')) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/login');
    }

    return res.status(401).json({
        error: 'Authentication required'
    });

};
