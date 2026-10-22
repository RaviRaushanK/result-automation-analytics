const express = require('express');
const router = express.Router();

/**
 * GET /
 * Render the public landing page using the dedicated landing layout.
 */
router.get('/', (req, res) => {
  res.render('landing/index', {
    title: 'SRAAS - Academic Results & Analytics',
    layout: 'layouts/landing',
    pageStyles: ['/css/home.css', '/css/home-navigation.css']
  });
});

module.exports = router;
