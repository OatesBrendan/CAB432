const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { uploadToS3, generatePresignedUrl } = require('../services/s3bucket');

exports.uploadFile = async (req, res) => {
  try {
    if (!req.files || !req.files.sampleFile) {
      return res.status(400).json({ error: 'No file' });
    }

    const sampleFile = req.files.sampleFile;
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];

    if (sampleFile.size > maxSize) {
      return res.status(400).json({ error: 'File too big (max 5MB)' });
    }
    if (!allowedTypes.includes(sampleFile.mimetype)) {
      return res.status(400).json({ 
        error: 'Invalid file type. Only JPEG, PNG, and PDF allowed.' 
      });
    }

    // Create S3 key with user namespace and unique identifier
    const fileExt = path.extname(sampleFile.name);
    const s3Key = `uploads/${req.user.username}/${uuidv4()}${fileExt}`;

    console.log(`Uploading file to S3: ${s3Key}`);
    
    // Upload directly to S3
    const s3Result = await uploadToS3(
      sampleFile.tempFilePath,  // Use tempFilePath instead of .data
      s3Key,
      sampleFile.mimetype
    );

    // Store file information in database
    const connection = await db.getConnection();
    const result = await connection.query(
      'INSERT INTO files (username, file_name, file_path) VALUES ($1, $2, $3) RETURNING id',
      [req.user.username, sampleFile.name, s3Key] // file_path now stores S3 key
    );
    connection.release();

    res.json({ 
      message: 'File uploaded successfully',
      fileName: sampleFile.name,
      fileId: result.insertId,
      s3Key: s3Key,
      s3Location: s3Result.location
    });

  } catch (err) {
    console.log('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
};

// New endpoint to get user's uploaded files
exports.getUserFiles = async (req, res) => {
  try {
    const connection = await db.getConnection();
    const files = await connection.query(
      'SELECT id, file_name, uploaded_at, file_path FROM files WHERE username = $1 ORDER BY uploaded_at DESC',
      [req.user.username]
    );
    connection.release();

    res.json({ files });
  } catch (err) {
    console.log('Error fetching files:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
};

// New endpoint to download a file using pre-signed URL
exports.downloadFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    const connection = await db.getConnection();
    const files = await connection.query(
      'SELECT * FROM files WHERE id = $1 AND username = $2',
      [fileId, req.user.username]
    );
    connection.release();

    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = files[0];
    const s3Key = file.file_path; // This is now an S3 key

    // Generate pre-signed URL for download (valid for 5 minutes)
    const downloadUrl = await generatePresignedUrl(s3Key, 300);

    res.json({
      downloadUrl: downloadUrl,
      filename: file.file_name,
      expiresIn: 300 // 5 minutes
    });

  } catch (err) {
    console.log('Download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
};

// New endpoint to get file information without downloading
exports.getFileInfo = async (req, res) => {
  try {
    const { fileId } = req.params;

    const connection = await db.getConnection();
    const files = await connection.query(
      'SELECT id, file_name, uploaded_at FROM files WHERE id = $1 AND username = $2',
      [fileId, req.user.username]
    );
    connection.release();

    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(files[0]);
  } catch (err) {
    console.log('Error fetching file info:', err);
    res.status(500).json({ error: 'Failed to fetch file information' });
  }
};

module.exports = exports;
