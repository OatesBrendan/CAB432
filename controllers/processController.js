const path = require("path");
const fs = require("fs").promises;
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const db = require("../config/db");
const { uploadToS3, downloadFromS3, generatePresignedUrl } = require("../services/s3bucket");

ffmpeg.setFfmpegPath(ffmpegStatic);

exports.processVideo = async (req, res) => {
  try {
    console.log("Request body:", req.body);

    const { videoId, format, resolution, bitrate } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: "Video ID required" });
    }

    const processFormat = format || "mp4";
    const processResolution = resolution || "720p";
    const processBitrate = bitrate || "1000k";

    console.log(
      `Processing ${videoId} - ${processFormat}/${processResolution}`
    );

    const connection = await db.getConnection();
    const videos = await connection.query(
      "SELECT * FROM videos WHERE id = $1 AND username = $2",
      [videoId, req.user.username]
    );

    if (videos.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = videos[0];
    const s3Key = video.file_path;  // This is now the S3 key

    const outputId = uuidv4();
    const outputS3Key = `processed/${req.user.username}/${outputId}.${processFormat}`;

    const jobResult = await connection.query(
      "INSERT INTO processing_jobs (id, video_id, username, status, output_path, format, resolution, bitrate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        outputId,
        videoId,
        req.user.username,
        "processing",
        outputS3Key, // Store S3 key instead of local path
        processFormat,
        processResolution,
        processBitrate,
      ]
    );

    console.log("Created job " + outputId);

    // Start processing in background
    processVideoAsync(
      s3Key,
      outputS3Key,
      {
        format: processFormat,
        resolution: processResolution,
        bitrate: processBitrate,
      },
      outputId,
      connection
    );

    res.json({
      message: "Processing started",
      jobId: outputId,
      status: "processing",
    });
  } catch (err) {
    console.log("Processing error:", err);
    res.status(500).json({ error: "Failed to start processing" });
  }
};

async function processVideoAsync(s3Key, outputS3Key, options, jobId, connection) {
  let tempInputPath = null;
  let tempOutputPath = null;

  try {
    console.log(`Starting job ${jobId} - downloading from S3: ${s3Key}`);

    await connection.query(
      "UPDATE processing_jobs SET status = $1, started_at = CURRENT_TIMESTAMP WHERE id = $2",
      ["processing", jobId]
    );

    // Create temp directory
    const tempDir = path.join(__dirname, '..', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    tempInputPath = path.join(tempDir, `input_${jobId}.tmp`);
    tempOutputPath = path.join(tempDir, `output_${jobId}.${options.format}`);

    // Download from S3 to temp file - FIXED VERSION
    console.log(`Downloading ${s3Key} from S3...`);
    const fileBuffer = await downloadFromS3(s3Key);
    await fs.writeFile(tempInputPath, fileBuffer);
    console.log(`Downloaded to temp file: ${tempInputPath} (${fileBuffer.length} bytes)`);

    let command = ffmpeg(tempInputPath);

    // Handle different resolutions
    let scaleFilter;
    if (options.resolution === "480p") {
      scaleFilter = "scale=854:480";
    } else if (options.resolution === "720p") {
      scaleFilter = "scale=1280:720";
    } else if (options.resolution === "1080p") {
      scaleFilter = "scale=1920:1080";
    } else {
      scaleFilter = "scale=1280:720";
    }

    if (options.resolution) {
      console.log("Scale filter:", scaleFilter);
      command = command.videoFilters(scaleFilter);
    }

    command = command
      .videoCodec("libx264")
      .audioCodec("aac")
      .addOption("-preset", "slow")
      .addOption("-crf", "23")
      .addOption("-x264opts", "keyint=24:min-keyint=24:no-scenecut")
      .videoBitrate(options.bitrate || "1000k")
      .format(options.format || "mp4")
      .output(tempOutputPath);

    command
      .on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
      })
      .on("progress", async (progress) => {
        const percent = Math.round(progress.percent) || 0;
        console.log(`Job ${jobId}: ${percent}%`);
        try {
          await connection.query(
            "UPDATE processing_jobs SET progress = $1 WHERE id = $2",
            [percent, jobId]
          );
        } catch (err) {
          // Ignore progress update errors
        }
      })
      .on("end", async () => {
        try {
          console.log(`Job ${jobId} processing complete, uploading to S3...`);
          
          // Upload processed video back to S3
          const processedBuffer = await fs.readFile(tempOutputPath);
          await uploadToS3(processedBuffer, outputS3Key, `video/${options.format}`);
          
          console.log(`Uploaded processed video to S3: ${outputS3Key}`);
          
          // Update job with completion status
          await connection.query(
            "UPDATE processing_jobs SET status = $1, completed_at = CURRENT_TIMESTAMP, progress = 100 WHERE id = $2",
            ["completed", jobId]
          );

          // Clean up temp files
          await cleanupTempFiles(tempInputPath, tempOutputPath);
          
        } catch (err) {
          console.log(`Error completing job ${jobId}:`, err);
          await connection.query(
            "UPDATE processing_jobs SET status = $1, error_message = $2 WHERE id = $3",
            ["failed", err.message, jobId]
          );
          await cleanupTempFiles(tempInputPath, tempOutputPath);
        }
      })
      .on("error", async (err) => {
        console.log(`Job ${jobId} failed:`, err);
        try {
          await connection.query(
            "UPDATE processing_jobs SET status = $1, error_message = $2 WHERE id = $3",
            ["failed", err.message, jobId]
          );
        } catch (dbErr) {
          console.log("DB error during failure handling:", dbErr);
        }
        await cleanupTempFiles(tempInputPath, tempOutputPath);
      })
      .run();

  } catch (err) {
    console.log(`Job ${jobId} setup failed:`, err);
    try {
      await connection.query(
        "UPDATE processing_jobs SET status = $1, error_message = $2 WHERE id = $3",
        ["failed", err.message, jobId]
      );
    } catch (dbErr) {
      console.log("DB error during setup failure:", dbErr);
    }
    await cleanupTempFiles(tempInputPath, tempOutputPath);
  }
}

async function cleanupTempFiles(...filePaths) {
  for (const filePath of filePaths) {
    if (filePath) {
      try {
        await fs.unlink(filePath);
        console.log(`Cleaned up temp file: ${filePath}`);
      } catch (err) {
        // Ignore cleanup errors
        console.log(`Failed to cleanup ${filePath}:`, err.message);
      }
    }
  }
}

exports.uploadVideo = async (req, res) => {
  try {
    if (!req.files || !req.files.videoFile) {
      return res.status(400).json({ error: "No file" });
    }

    const videoFile = req.files.videoFile;

    const maxSize = 100 * 1024 * 1024;
    const allowedTypes = [
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/quicktime",
    ];

    console.log(`File: ${videoFile.name}, size: ${videoFile.size}`);

    if (videoFile.size > maxSize) {
      return res.status(400).json({ error: "File too big" });
    }
    if (!allowedTypes.includes(videoFile.mimetype)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    // Create S3 key with user namespace and timestamp
    const fileName = `videos/${req.user.username}/${Date.now()}-${videoFile.name}`;
    
    console.log(`Uploading to S3: ${fileName}`);
    const s3Result = await uploadToS3(
      videoFile.tempFilePath,  // Use tempFilePath instead of .data
      fileName,
      videoFile.mimetype
    );

    const connection = await db.getConnection();
    const result = await connection.query(
      "INSERT INTO videos (username, original_name, file_path, file_size, mime_type, s3_location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [
        req.user.username,
        videoFile.name,
        fileName,  // Store S3 key as file_path
        videoFile.size,
        videoFile.mimetype,
        s3Result.location,
      ]
    );
    connection.release();

    res.json({
      message: "Upload successful",
      videoId: result.insertId,
      s3Key: fileName,
      s3Location: s3Result.location,
    });
  } catch (err) {
    console.log("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};

exports.getUserVideos = async (req, res) => {
  try {
    const connection = await db.getConnection();
    const videos = await connection.query(
      "SELECT id, original_name, file_size, mime_type, uploaded_at, s3_location FROM videos WHERE username = $1 ORDER BY uploaded_at DESC",
      [req.user.username]
    );
    connection.release();

    res.json({ videos });
  } catch (err) {
    console.log("Error fetching videos:", err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
};

exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const connection = await db.getConnection();
    const jobs = await connection.query(
      "SELECT * FROM processing_jobs WHERE id = $1 AND username = $2",
      [jobId, req.user.username]
    );
    connection.release();

    if (jobs.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(jobs[0]);
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
};

exports.getUserJobs = async (req, res) => {
  try {
    const connection = await db.getConnection();
    const jobs = await connection.query(
      "SELECT pj.*, v.original_name FROM processing_jobs pj LEFT JOIN videos v ON pj.video_id = v.id WHERE pj.username = $1 ORDER BY pj.created_at DESC",
      [req.user.username]
    );
    connection.release();

    res.json({ jobs });
  } catch (err) {
    console.log("Error fetching jobs:", err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
};

exports.downloadProcessedVideo = async (req, res) => {
  try {
    const { jobId } = req.params;

    const connection = await db.getConnection();
    const jobs = await connection.query(
      "SELECT * FROM processing_jobs WHERE id = $1 AND username = $2 AND status = $3",
      [jobId, req.user.username, "completed"]
    );
    connection.release();

    if (jobs.length === 0) {
      return res.status(404).json({ error: "Job not found or not completed" });
    }

    const job = jobs[0];
    const s3Key = job.output_path;  // This is now an S3 key

    // Generate pre-signed URL for download (valid for 5 minutes)
    const downloadUrl = await generatePresignedUrl(s3Key, 300);

    res.json({ 
      downloadUrl: downloadUrl,
      filename: `processed_${job.id}.${job.format}`,
      expiresIn: 300 // 5 minutes
    });

  } catch (err) {
    console.log("Download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
};

// New endpoint for getting original video download URL
exports.downloadOriginalVideo = async (req, res) => {
  try {
    const { videoId } = req.params;

    const connection = await db.getConnection();
    const videos = await connection.query(
      "SELECT * FROM videos WHERE id = $1 AND username = $2",
      [videoId, req.user.username]
    );
    connection.release();

    if (videos.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = videos[0];
    const s3Key = video.file_path;

    // Generate pre-signed URL for download
    const downloadUrl = await generatePresignedUrl(s3Key, 300);

    res.json({
      downloadUrl: downloadUrl,
      filename: video.original_name,
      expiresIn: 300
    });

  } catch (err) {
    console.log("Download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
};

module.exports = exports;
