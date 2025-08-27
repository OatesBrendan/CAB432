const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const db = require('../config/db');

ffmpeg.setFfmpegPath(ffmpegStatic);

exports.processVideo = async (req, res) => {
  try {
    console.log('Request body:', req.body);
    
    const { videoId, format, resolution, bitrate } = req.body;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID required' });
    }

    const processFormat = format || "mp4";
    const processResolution = resolution || '720p';
    const processBitrate = bitrate || '1000k';

    console.log(`Processing ${videoId} - ${processFormat}/${processResolution}`);

    const connection = await db.getConnection();
    const videos = await connection.query(
      'SELECT * FROM videos WHERE id = ? AND username = ?',
      [videoId, req.user.username]
    );

    if (videos.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videos[0];
    const inputPath = video.file_path;
    
    try {
      await fs.access(inputPath);
    } catch (error) {
      return res.status(404).json({ error: 'Video file missing' });
    }
    
    const outputId = uuidv4();
    const outputDir = path.join(__dirname, '..', 'processed');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = `${outputDir}/${outputId}.${processFormat}`;

    const jobResult = await connection.query(
      'INSERT INTO processing_jobs (id, video_id, username, status, output_path, format, resolution, bitrate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [outputId, videoId, req.user.username, 'processing', outputPath, processFormat, processResolution, processBitrate]
    );

    console.log('Created job ' + outputId);

    // Start processing in background
    processVideoAsync(inputPath, outputPath, {
      format: processFormat,
      resolution: processResolution,
      bitrate: processBitrate
    }, outputId, connection);

    res.json({ 
      message: 'Processing started',
      jobId: outputId,
      status: 'processing'
    });

  } catch (err) {
    console.log('Processing error:', err);
    res.status(500).json({ error: 'Failed to start processing' });
  }
};

async function processVideoAsync(inputPath, outputPath, options, jobId, connection) {
  try {
    console.log(`Starting job ${jobId}`);
    
    await connection.query(
      'UPDATE processing_jobs SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['processing', jobId]
    );

    let command = ffmpeg(inputPath);

    // Handle different resolutions
    let scaleFilter;
    if (options.resolution === '480p') {
      scaleFilter = 'scale=854:480';
    } else if (options.resolution === '720p') {
      scaleFilter = 'scale=1280:720';
    } else if (options.resolution === '1080p') {
      scaleFilter = 'scale=1920:1080';
    } else {
      scaleFilter = 'scale=1280:720';
    }
    
    if (options.resolution) {
      console.log('Scale filter:', scaleFilter);
      command = command.videoFilters(scaleFilter);
    }

    command = command
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOption('-preset', 'slow')
      .addOption('-crf', '23')
      .addOption('-x264opts', 'keyint=24:min-keyint=24:no-scenecut')
      .videoBitrate(options.bitrate || '1000k');

    // Special DASH handling
    if (options.format === 'dash') {
      const dashOutputDir = path.dirname(outputPath);
      const dashManifest = path.join(dashOutputDir, `${path.basename(outputPath, '.dash')}.mpd`);
      
      command = command
        .format('dash')
        .addOption('-adaptation_sets', 'id=0,streams=v id=1,streams=a')
        .addOption('-seg_duration', '4')
        .addOption('-use_template', '1')
        .addOption('-use_timeline', '1')
        .output(dashManifest);
    } else {
      command = command
        .format(options.format || 'mp4')
        .output(outputPath);
    }

    command
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', async (progress) => {
        const percent = Math.round(progress.percent) || 0;
        console.log(`Job ${jobId}: ${percent}%`);
        // Update progress
        try {
          await connection.query(
            'UPDATE processing_jobs SET progress = ? WHERE id = ?',
            [percent, jobId]
          );
        } catch (err) {
          // ignore
        }
      })
      .on('end', async () => {
        console.log(`Job ${jobId} completed`);
        try {
          await connection.query(
            'UPDATE processing_jobs SET status = ?, completed_at = CURRENT_TIMESTAMP, progress = 100 WHERE id = ?',
            ['completed', jobId]
          );
        } catch (err) {
          console.log('Error updating status:', err);
        }
      })
      .on('error', async (err) => {
        console.log(`Job ${jobId} failed:`, err);
        try {
          await connection.query(
            'UPDATE processing_jobs SET status = ?, error_message = ? WHERE id = ?',
            ['failed', err.message, jobId]
          );
        } catch (dbErr) {
          console.log('DB error:', dbErr);
        }
      })
      .run();

  } catch (err) {
    console.log(`Job ${jobId} failed:`, err);
    try {
      await connection.query(
        'UPDATE processing_jobs SET status = ?, error_message = ? WHERE id = ?',
        ['failed', err.message, jobId]
      );
    } catch (dbErr) {
      
    }
  }
}

exports.uploadVideo = async (req, res) => {
  try {
    console.log('Upload request');
    
    if (!req.files || !req.files.videoFile) {
      return res.status(400).json({ error: 'No file' });
    }

    const videoFile = req.files.videoFile;
    const maxSize = 100 * 1024 * 1024;
    const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/quicktime'];

    console.log(`File: ${videoFile.name}, size: ${videoFile.size}`);

    if (videoFile.size > maxSize) {
      return res.status(400).json({ error: 'File too big' });
    }
    if (!allowedTypes.includes(videoFile.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const fileExt = path.extname(videoFile.name);
    const fileName = uuidv4() + fileExt;
    const uploadDir = path.join(__dirname, '..', 'uploads', 'videos');
    const uploadPath = path.join(uploadDir, fileName);

    console.log('Saving to:', uploadPath);

    await fs.mkdir(uploadDir, { recursive: true });
    await videoFile.mv(uploadPath);

    const connection = await db.getConnection();
    const result = await connection.query(
      'INSERT INTO videos (username, original_name, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?)',
      [req.user.username, videoFile.name, uploadPath, videoFile.size, videoFile.mimetype]
    );

    console.log('Video saved with ID:', result.insertId);

    res.json({ 
      message: 'Upload successful',
      videoId: result.insertId,
      originalName: videoFile.name,
      size: videoFile.size
    });

  } catch (err) {
    console.log('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
};

exports.getUserVideos = async (req, res) => {
  try {
    const connection = await db.getConnection();
    const videos = await connection.query(
      'SELECT id, original_name, file_size, mime_type, uploaded_at FROM videos WHERE username = ? ORDER BY uploaded_at DESC',
      [req.user.username]
    );

    res.json({ videos });
  } catch (err) {
    console.log('Error fetching videos:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
};

exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const connection = await db.getConnection();
    const jobs = await connection.query(
      'SELECT * FROM processing_jobs WHERE id = ? AND username = ?',
      [jobId, req.user.username]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(jobs[0]);
  } catch (err) {
    console.log('Error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

exports.getUserJobs = async (req, res) => {
  try {
    const connection = await db.getConnection();
    const jobs = await connection.query(
      'SELECT pj.*, v.original_name FROM processing_jobs pj LEFT JOIN videos v ON pj.video_id = v.id WHERE pj.username = ? ORDER BY pj.created_at DESC',
      [req.user.username]
    );

    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};

exports.downloadProcessedVideo = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const connection = await db.getConnection();
    const jobs = await connection.query(
      'SELECT * FROM processing_jobs WHERE id = ? AND username = ? AND status = ?',
      [jobId, req.user.username, 'completed']
    );

    if (jobs.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = jobs[0];
    const filePath = job.output_path;

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, `processed_${job.id}.${job.format}`);
  } catch (err) {
    console.log('Download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
};

module.exports = exports;