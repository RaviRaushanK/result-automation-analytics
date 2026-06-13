const { User } = require('../models/models');
const bcrypt = require('bcryptjs');

const authController = {
  login: async (req, res) => {
    try {
      const { username, password } = req.body;
      const [users] = await User.findByUsername(username);
      
      if (users.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const user = users[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      req.session.userId = user.id;
      req.session.role = user.role;
      
      res.json({ message: 'Login successful', user: { username: user.username, role: user.role } });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  logout: (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logout successful' });
  },

  register: async (req, res) => {
    try {
      const { username, email, password, role } = req.body;
      const passwordHash = await bcrypt.hash(password, 10);
      await User.create({ username, email, password_hash: passwordHash, role });
      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
};

module.exports = authController;