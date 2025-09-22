const jwt = require("aws-jwt-verify");
const crypto = require("crypto");

// Your Cognito configuration
const userPoolId = "ap-southeast-2_A3uPttUWG"; 
const clientId = "31vh9dmicv8jgmmetpqjh5for0";
const clientSecret = "1sujajep6v0dlrqjq14vvcg77llj761rn5p4p9asqlo3aqr3bcs3";

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

function secretHash(clientId, clientSecret, username) {
  const hasher = crypto.createHmac('sha256', clientSecret);
  hasher.update(`${username}${clientId}`);
  return hasher.digest('base64');
}

// Middleware to authenticate Cognito tokens
const authenticateCognitoToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    // Try to verify as ID token first (contains user info)
    try {
      const payload = await idVerifier.verify(token);
      req.user = {
        username: payload['cognito:username'],
        email: payload.email,
        sub: payload.sub,
        tokenType: 'id'
      };
      return next();
    } catch (idTokenError) {
      // If ID token fails, try access token
      try {
        const payload = await accessVerifier.verify(token);
        req.user = {
          username: payload.username,
          sub: payload.sub,
          tokenType: 'access'
        };
        return next();
      } catch (accessTokenError) {
        console.log('Token verification failed:', accessTokenError.message);
        return res.status(403).json({ error: 'Invalid token' });
      }
    }
  } catch (error) {
    console.log('Authentication error:', error.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = {
  authenticateCognitoToken,
  secretHash,
  userPoolId,
  clientId,
  clientSecret
};