const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', (req, res) => {
    res.render('dashboard/index', {
        layout: 'layouts/main',
        title: 'Dashboard - SRAAS',
        breadcrumbItems: [
            {
                href: '/dashboard',
                label: 'Dashboard'
            }
        ]
    });
});

module.exports = router;