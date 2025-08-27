const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

exports.uploadFile = async (req, res) => {
  try {
    if (!req.files || !req.files.sampleFile) {
      return res.status(400).json({ error: 'No file' });
    }

    const sampleFile = req.files.sampleFile;
    const maxSize = 5 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];

    if (sampleFile.size > maxSize) {
      return res.status(400).json({ error: 'File too big' });
    }
    if (!allowedTypes.includes(sampleFile.mimetype)) {
      return res.status(400).json({ error: 'Wrong file type' });
    }

    const fileExt = path.extname(sampleFile.name);
    const fileName = `${uuidv4()}${fileExt}`;
    const uploadDir = path.join(__dirname, '..', 'uploads');
    const uploadPath = path.join(uploadDir, fileName);

    await fs.mkdir(uploadDir, { recursive: true });
    await sampleFile.mv(uploadPath);

    const connection = await db.getConnection();
    await connection.query(
      'INSERT INTO files (username, file_name, file_path) VALUES (?, ?, ?)',
      [req.user.username, sampleFile.name, uploadPath]
    );

    res.json({ message: 'File uploaded', fileName: sampleFile.name });
  } catch (err) {
    console.log('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
};