// migration.js - Run this once to add the users table to your existing database
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'tasks.db'); // Adjust path as needed
const db = new sqlite3.Database(dbPath);

console.log('Running database migration...');

db.serialize(() => {
  // Add users table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      cognito_sub TEXT UNIQUE,
      admin BOOLEAN DEFAULT 0,
      verified BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('✓ Users table created/verified');
    }
  });

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`, (err) => {
    if (err) {
      console.error('Error creating username index:', err);
    } else {
      console.log('✓ Username index created');
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_cognito_sub ON users(cognito_sub)`, (err) => {
    if (err) {
      console.error('Error creating cognito_sub index:', err);
    } else {
      console.log('✓ Cognito sub index created');
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_username ON videos(username)`, (err) => {
    if (err) {
      console.error('Error creating videos username index:', err);
    } else {
      console.log('✓ Videos username index created');
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_processing_jobs_username ON processing_jobs(username)`, (err) => {
    if (err) {
      console.error('Error creating processing jobs username index:', err);
    } else {
      console.log('✓ Processing jobs username index created');
    }
  });

  // Add a default admin user (optional)
  db.run(`
    INSERT OR IGNORE INTO users (username, email, admin, verified) 
    VALUES ('admin', 'admin@example.com', 1, 1)
  `, (err) => {
    if (err) {
      console.error('Error creating admin user:', err);
    } else {
      console.log('✓ Default admin user created (if not exists)');
    }
  });

  console.log('Migration completed!');
  
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
  });
});

// Run: node migration.js