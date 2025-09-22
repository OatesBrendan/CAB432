const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateCognitoToken } = require('../middleware/authMiddleware');

router.post('/', authenticateCognitoToken, uploadController.uploadFile);

module.exports = router;