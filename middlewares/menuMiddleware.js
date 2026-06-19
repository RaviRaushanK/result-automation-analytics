const fs = require('fs');
const path = require('path');

/**
 * Menu middleware – loads sidebar configuration, filters by user role,
 * makes menuConfig available to all views, and exposes currentPath.
 */
module.exports = function menuMiddleware(req, res, next) {
  const configPath = path.join(__dirname, '..', 'config', 'sidebar.json');
  let menu = [];

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);
    menu = json.menu || [];
  } catch (err) {
    console.error('Failed to load sidebar config:', err);
  }

  // Assume req.user.role is set by authentication middleware
  const role = req.user?.role || 'guest';

  // Simple role filter – keep items where roles include the current role or roles is undefined
  const filterMenu = (items) => {
    return items
      .filter(item => !item.roles || item.roles.includes(role))
      .map(item => ({
        ...item,
        children: item.children ? filterMenu(item.children) : undefined
      }));
  };

  res.locals.menuConfig = filterMenu(menu);
  // Expose the current request path for active route highlighting in sidebar
  res.locals.currentPath = req.path;
  next();
};