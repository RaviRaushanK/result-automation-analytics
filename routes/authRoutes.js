const express = require('express');
const router = express.Router();

// Controller import
const authController = require('../controllers/authController');

/**
 * Auth Routes
 * Base URL: /auth
 */

// ========================
// Authentication Endpoints
// ========================
router.post('/login', authController.login);      // POST /auth/login → login user
router.post('/logout', authController.logout);    // POST /auth/logout → logout user
router.post('/register', authController.register); // POST /auth/register → register new user

module.exports = router;