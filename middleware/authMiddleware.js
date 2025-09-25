const jwt = require("aws-jwt-verify");
const crypto = require("crypto");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

// Your Cognito configuration - move sensitive data to secrets
const userPoolId = "ap-southeast-2_A3uPttUWG"; 
const clientId = "31vh9dmicv8jgmmetpqjh5for0";

// Cache for secrets to avoid repeated API calls
let cachedSecrets = null;

// Initialize Secrets Manager client
const secretsClient = new SecretsManagerClient({
  region: "ap-southeast-2",
});

async function getSecrets() {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const secret_name = "n11610557-secret";
  
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT",
      })
    );
    
    cachedSecrets = JSON.parse(response.SecretString);
    return cachedSecrets;
  } catch (error) {
    console.error('Error retrieving secrets:', error);
    throw error;
  }
}

// Create JWT verifiers for Cognito tokens
const accessVerifier = jwt.CognitoJwtVerifier.create({
  userPoolId: userPoolId,
  tokenUse: "access",
  clientId: clientId,
});

const idVerifier = jwt.CognitoJwtVerifier.create({
  userPoolId: userPoolId,
  tokenUse: "id",
  clientId: clientId,
});

async function secretHash(clientId, username) {
  const secrets = await getSecrets();
  const clientSecret = secrets.cognitoClientSecret; // Assuming this key in your secret
  
  const hasher = crypto.createHmac('sha256', clientSecret);
  hasher.update(`${username}${clientId}`);
  return hasher.digest('base64');
}

// Middleware to authenticate Cognito tokens
// In authMiddleware.js, modify authenticateCognitoToken:
const authenticateCognitoToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    // STORE RAW TOKEN FIRST
    const rawToken = token;

    // Try to verify as ID token first
    try {
      const payload = await idVerifier.verify(token);
      req.user = {
        username: payload['cognito:username'],
        email: payload.email,
        sub: payload.sub,
        tokenType: 'id',
        accessToken: rawToken  // Store raw token for MFA operations
      };
      return next();
    } catch (idTokenError) {
      // Try access token
      try {
        const payload = await accessVerifier.verify(token);
        req.user = {
          username: payload.username,
          sub: payload.sub,
          tokenType: 'access',
          accessToken: rawToken  // Store raw token for MFA operations
        };
        return next();
      } catch (accessTokenError) {
        return res.status(403).json({ error: 'Invalid token' });
      }
    }
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = {
  authenticateCognitoToken,
  secretHash,
  userPoolId,
  clientId,
  getSecrets
};