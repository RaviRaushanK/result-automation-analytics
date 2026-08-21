const express = require('express');
const router = express.Router();

/**
 * GET /
 * Render the public landing page using the dedicated landing layout.
 */
router.get('/', (req, res) => {
  res.render('landing/index', {
    layout: 'layouts/landing',
    pageStyles: ['/css/landing.css']
  });
});

module.exports = router;