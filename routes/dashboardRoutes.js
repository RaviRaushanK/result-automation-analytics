const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const path = require('path');
const fs = require('fs');

// Load sidebar configuration
const sidebarPath = path.join(__dirname, '..', 'config', 'sidebar.json');
let menuConfig = [];
try {
  const raw = fs.readFileSync(sidebarPath, 'utf-8');
  const json = JSON.parse(raw);
  menuConfig = json.menu || [];
} catch (err) {
  console.error('Dashboard: failed to load sidebar config', err);
}

// Protect all dashboard routes
router.use(authMiddleware);

// GET /dashboard
router.get('/', (req, res) => {
  // Filter menu based on user role
  const role = req.user?.role || 'guest';
  const filterMenu = (items) => {
    return items
      .filter(item => !item.roles || item.roles.includes(role))
      .map(item => ({
        ...item,
        children: item.children ? filterMenu(item.children) : undefined
      }));
  };

  res.render('dashboard/index', {
    layout: 'layouts/main',
    title: 'Dashboard - SRAAS',
    user: req.user || null,
    menuConfig: filterMenu(menuConfig),
    currentPath: req.path,
    breadcrumbItems: [
      { href: '/dashboard', label: 'Dashboard' }
    ]
  });
});

module.exports = router;