// services/dynamoService.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  DeleteCommand,
  UpdateCommand,
  QueryCommand
} = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: "ap-southeast-2" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "n11610557-user-sessions";

// Function 1: Store user login session with preferences
async function storeUserSession(username, sessionData) {
  try {
    const sessionId = `session_${username}_${Date.now()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now
    
    const item = {
      session_id: sessionId,
      username: username,
      login_time: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      preferences: sessionData.preferences || {},
      device_info: sessionData.deviceInfo || 'unknown',
      expires_at: expiresAt  // DynamoDB will auto-delete expired items
    };
    
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item
    }));
    
    console.log(`✅ User session stored in DynamoDB: ${username}`);
    return sessionId;
    
  } catch (error) {
    console.error('❌ DynamoDB store session error:', error.message);
    // Don't throw - let app continue without session storage
    return null;
  }
}

// Function 2: Get user's active sessions
async function getUserSessions(username) {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'username-index', // We'll create this index
      KeyConditionExpression: 'username = :username',
      ExpressionAttributeValues: {
        ':username': username
      }
    }));
    
    console.log(`✅ Retrieved ${response.Items?.length || 0} sessions for ${username}`);
    return response.Items || [];
    
  } catch (error) {
    console.error('❌ DynamoDB get sessions error:', error.message);
    return [];
  }
}

// Function 3: Update user activity (prove we're using DynamoDB actively)
async function updateUserActivity(sessionId, activityData) {
  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { session_id: sessionId },
      UpdateExpression: 'SET last_activity = :activity, activity_count = if_not_exists(activity_count, :zero) + :inc',
      ExpressionAttributeValues: {
        ':activity': new Date().toISOString(),
        ':zero': 0,
        ':inc': 1
      }
    }));
    
    console.log(`✅ Updated activity for session: ${sessionId}`);
    return true;
    
  } catch (error) {
    console.error('❌ DynamoDB update activity error:', error.message);
    return false;
  }
}

// Function 4: Store video processing job metadata (alternative use case)
async function storeJobMetadata(jobId, username, jobData) {
  try {
    const item = {
      session_id: `job_${jobId}`, // Using session_id as our primary key
      username: username,
      job_id: jobId,
      job_type: 'video_processing',
      metadata: {
        original_filename: jobData.originalFilename,
        target_format: jobData.format,
        target_resolution: jobData.resolution,
        file_size: jobData.fileSize
      },
      created_at: new Date().toISOString(),
      expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };
    
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item
    }));
    
    console.log(`✅ Job metadata stored in DynamoDB: ${jobId}`);
    return true;
    
  } catch (error) {
    console.error('❌ DynamoDB store job metadata error:', error.message);
    return false;
  }
}

// Function 5: Clean up expired sessions (housekeeping)
async function cleanupExpiredSessions() {
  try {
    // DynamoDB TTL will handle this automatically, but we can log it
    console.log('🧹 DynamoDB TTL will automatically clean up expired sessions');
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
  }
}

module.exports = {
  storeUserSession,
  getUserSessions,
  updateUserActivity,
  storeJobMetadata,
  cleanupExpiredSessions
};