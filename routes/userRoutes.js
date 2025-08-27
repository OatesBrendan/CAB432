const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.post('/logout', userController.logout);
router.get('/me', authenticateToken, userController.getMe);
router.get('/', authenticateToken, userController.getMainPage);
router.get('/admin', authenticateToken, userController.getAdminPage);

module.exports = router;