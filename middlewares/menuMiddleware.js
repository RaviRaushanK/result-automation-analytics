const fs = require('fs');
const path = require('path');

// ======================
// Load Sidebar Configuration (Once)
// ======================

const sidebarConfigPath = path.join(__dirname, '..', 'config', 'sidebar.json');

let sidebarMenu = [];

try {
    const raw = fs.readFileSync(sidebarConfigPath, 'utf8');
    sidebarMenu = JSON.parse(raw).menu || [];
} catch (err) {
    console.error('Failed to load sidebar configuration:', err);
}

// ======================
// Menu Middleware
// ======================

module.exports = function menuMiddleware(req, res, next) {

    // Default to guest if no authenticated user exists
    const role = req.user?.role || 'guest';

    /**
     * Recursively filter menu items based on role.
     * A parent item is kept if:
     *  - it is directly accessible, OR
     *  - it contains at least one accessible child.
     */
    function filterMenu(items) {
        return items.reduce((filtered, item) => {

            const children = item.children
                ? filterMenu(item.children)
                : [];

            const hasAccess =
                !item.roles ||
                item.roles.includes(role);

            if (hasAccess || children.length > 0) {
                filtered.push({
                    ...item,
                    children: children.length ? children : undefined
                });
            }

            return filtered;

        }, []);
    }

    // Make sidebar available to all views
    res.locals.menuConfig = filterMenu(sidebarMenu);

    // Current URL for active menu highlighting
    res.locals.currentPath = (req.originalUrl || req.path).split('?')[0];

    next();
};