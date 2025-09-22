const { Pool } = require('pg');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

let pool;

// Initialize Secrets Manager client
const secretsClient = new SecretsManagerClient({
  region: "ap-southeast-2",
});

async function getSecrets() {
  const secret_name = "n11610557-secret";
  
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT",
      })
    );
    
    const secret = JSON.parse(response.SecretString);
    return secret;
  } catch (error) {
    console.error('Error retrieving secrets:', error);
    throw error;
  }
}

async function initializePool() {
  try {
    const secrets = await getSecrets();
    
    // PostgreSQL connection configuration using secrets
    pool = new Pool({
      host: 'database-1-instance-1.ce2haupt2cta.ap-southeast-2.rds.amazonaws.com',
      port: 5432,
      database: 'cohort_2025',
      user: secrets.username, // From Secrets Manager
      password: secrets.password, // From Secrets Manager
      ssl: {
        rejectUnauthorized: false,
        sslmode: 'require'
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    console.log('Database pool initialized with Secrets Manager credentials');
    await initializeTables();
    
  } catch (error) {
    console.error('Failed to initialize database pool:', error);
    throw error;
  }
}

// Initialize tables with PostgreSQL syntax
async function initializeTables() {
  const client = await pool.connect();
  
  try {
    // Tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Files table
    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Videos table
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        s3_location TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Processing jobs table
    await client.query(`
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

    // User preferences table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        default_video_quality TEXT DEFAULT '720p',
        default_format TEXT DEFAULT 'mp4',
        email_notifications BOOLEAN DEFAULT TRUE,
        theme TEXT DEFAULT 'light',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        cognito_sub TEXT UNIQUE,
        admin BOOLEAN DEFAULT FALSE,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('PostgreSQL tables initialized successfully');
  } catch (error) {
    console.error('Error initializing tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Wrapper to maintain compatibility with your existing code
const dbWrapper = {
  getConnection: async () => {
    if (!pool) {
      throw new Error('Database pool not initialized. Call initializePool() first.');
    }
    
    const client = await pool.connect();
    return {
      query: async (text, params = []) => {
        try {
          const result = await client.query(text, params);
          
          // Handle SELECT vs INSERT/UPDATE differences
          if (text.trim().toUpperCase().startsWith('SELECT')) {
            return result.rows;
          } else {
            // For INSERT statements, return the id if available
            if (text.trim().toUpperCase().startsWith('INSERT') && result.rows.length > 0) {
              return {
                insertId: result.rows[0].id,
                affectedRows: result.rowCount
              };
            } else {
              return {
                insertId: null,
                affectedRows: result.rowCount
              };
            }
          }
        } catch (error) {
          throw error;
        }
      },
      release: () => client.release()
    };
  }
};

// Initialize pool when module loads
initializePool().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  if (pool) {
    console.log('Closing PostgreSQL pool...');
    pool.end();
  }
  process.exit(0);
});

module.exports = dbWrapper;