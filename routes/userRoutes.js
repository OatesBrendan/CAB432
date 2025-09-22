const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateCognitoToken } = require('../middleware/authMiddleware');

// Public routes (no authentication required)
router.post('/register', userController.registerUser);
router.post('/confirm', userController.confirmSignUp);
router.post('/login', userController.loginUser);
router.post('/refresh', userController.refreshToken);
router.post('/logout', userController.logout);

// Protected routes (require Cognito authentication)
router.get('/me', authenticateCognitoToken, userController.getMe);
router.get('/', authenticateCognitoToken, userController.getMainPage);
router.get('/admin', authenticateCognitoToken, userController.getAdminPage);

module.exports = router;