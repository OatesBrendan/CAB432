const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database file
const dbPath = path.join(__dirname, '../tasks.db');
const db = new sqlite3.Database(dbPath);

// Initialize tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      completed BOOLEAN DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      video_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      output_path TEXT,
      format TEXT,
      resolution TEXT,
      bitrate TEXT,
      progress INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos (id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      default_video_quality TEXT DEFAULT '720p',
      default_format TEXT DEFAULT 'mp4',
      email_notifications BOOLEAN DEFAULT 1,
      theme TEXT DEFAULT 'light',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database tables initialized successfully');
});

const pool = {
  getConnection: () => {
    return Promise.resolve({
      query: (sql, params = []) => {
        return new Promise((resolve, reject) => {
          if (sql.trim().toUpperCase().startsWith('SELECT')) {
            db.all(sql, params, (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          } else {
            db.run(sql, params, function(err) {
              if (err) reject(err);
              else resolve({ 
                insertId: this.lastID, 
                affectedRows: this.changes 
              });
            });
          }
        });
      },
      release: () => {}
    });
  }
};

console.log(`SQLite database created at: ${dbPath}`);

module.exports = pool;