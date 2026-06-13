// Import required libraries
const bcrypt = require('bcryptjs');
const { User } = require('../database/models');

const authController = {

  // ========================
  // LOGIN USER
  // ========================
  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      // Find user by username
      const user = await User.findOne({
        where: { username }
      });

      // If user not found
      if (!user) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      // Compare password with hashed password
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (!isMatch) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      // Store session data
      req.session.userId = user.admin_id;
      req.session.role = user.role;

      // Send response
      res.json({
        message: 'Login successful',
        user: {
          username: user.username,
          role: user.role
        }
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  },

  // ========================
  // LOGOUT USER
  // ========================
  logout: (req, res) => {
    req.session.destroy();
    res.json({
      message: 'Logout successful'
    });
  },

  // ========================
  // REGISTER USER
  // ========================
  register: async (req, res) => {
    try {
      const { username, email, password, role } = req.body;

      // Hash password before saving
      const password_hash = await bcrypt.hash(password, 10);

      // Create new user
      await User.create({
        username,
        email,
        password_hash,
        role
      });

      res.status(201).json({
        message: 'User registered successfully'
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
};

module.exports = authController;