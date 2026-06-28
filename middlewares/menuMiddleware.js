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

    const role = req.user?.role ?? 'guest';

    function filterMenu(items) {
        return items.reduce((filtered, item) => {

            const children = Array.isArray(item.children)
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

    res.locals.sidebarMenu = filterMenu(sidebarMenu);

    res.locals.currentPath =
        (req.originalUrl || req.path).split('?')[0];

    next();
};