const jwt = require('jsonwebtoken');
const { generateAccessToken, authenticateToken } = require('../middleware/authMiddleware');
const path = require('path');

// replace with real database
const users = {
  'user1': { username: 'user1', password: 'password123', admin: false },
  'admin1': { username: 'admin1', password: 'adminpass', admin: true }
};

exports.registerUser = (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (users[username]) {
    return res.status(400).json({ error: 'User exists' });
  }
  users[username] = { username, password, admin: false };
  console.log('User registered:', username);
  res.status(201).json({ message: 'User registered' });
};

exports.loginUser = (req, res) => {
  const { username, password } = req.body;
  const user = users[username];

  if (!user || password !== user.password) {
    console.log('Failed login:', username);
    return res.sendStatus(401);
  }

  console.log('Login success:', username);
  const token = generateAccessToken({ username });
  res.json({ authToken: token });
};

exports.logout = (req, res) => {
  console.log('User logged out');
  res.json({ message: 'Logged out' });
};

exports.getMe = (req, res) => {
  res.json({ username: req.user.username });
};

exports.getMainPage = (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
};

exports.getAdminPage = (req, res) => {
  const user = users[req.user.username];
  if (!user || !user.admin) {
    console.log('Unauthorized admin access:', req.user.username);
    return res.sendStatus(403);
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
};