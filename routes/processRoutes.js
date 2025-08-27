const express = require('express');
const router = express.Router();
const processController = require('../controllers/processController');
const { authenticateToken } = require('../middleware/authMiddleware');
// Make sure user is authenticaated
router.use(authenticateToken);

router.post('/upload', processController.uploadVideo);
router.get('/', processController.getUserVideos);
router.post('/process', processController.processVideo);

router.get('/jobs/:jobId', processController.getJobStatus);
router.get('/jobs', processController.getUserJobs);
router.get('/download/:jobId', processController.downloadProcessedVideo);

module.exports = router;