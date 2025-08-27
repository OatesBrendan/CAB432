const express = require('express');
const router = express.Router();
const userRoutes = require('./userRoutes');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use('/api/users', userRoutes);

module.exports = router;