const Cognito = require("@aws-sdk/client-cognito-identity-provider");
const { secretHash, userPoolId, clientId } = require('../middleware/authMiddleware');
const path = require('path');
const db = require('../config/db');

// Initialize Cognito client
const cognitoClient = new Cognito.CognitoIdentityProviderClient({
  region: "ap-southeast-2",
});

exports.registerUser = async (req, res) => {
  let connection = null;
  
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Username, password, and email required' });
    }

    const command = new Cognito.SignUpCommand({
      ClientId: clientId,
      SecretHash: await secretHash(clientId, username), // Now async
      Username: username,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email }
      ],
    });

    const result = await cognitoClient.send(command);
    console.log('User registered in Cognito:', username);
    
    // Store user info in your database
    try {
      connection = await db.getConnection();
      await connection.query(
        'INSERT INTO users (username, email, cognito_sub, verified) VALUES ($1, $2, $3, $4)',
        [username, email, result.UserSub, false]
      );
      console.log('User stored in database:', username);
    } catch (dbError) {
      console.log('Database error (user may already exist):', dbError.message);
      // Don't fail registration if DB insert fails - user still exists in Cognito
    } finally {
      if (connection) connection.release();
    }

    res.status(201).json({ 
      message: 'User registered successfully. Check your email for confirmation code.',
      userSub: result.UserSub,
      needsConfirmation: true
    });

  } catch (error) {
    if (connection) connection.release();
    console.log('Registration error:', error);
    
    if (error.name === 'UsernameExistsException') {
      return res.status(400).json({ error: 'Username already exists' });
    } else if (error.name === 'InvalidPasswordException') {
      return res.status(400).json({ error: 'Password does not meet requirements' });
    } else if (error.name === 'InvalidParameterException') {
      return res.status(400).json({ error: 'Invalid parameters provided' });
    }
    
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.confirmSignUp = async (req, res) => {
  let connection = null;
  
  try {
    const { username, confirmationCode } = req.body;
    
    if (!username || !confirmationCode) {
      return res.status(400).json({ error: 'Username and confirmation code required' });
    }

    const command = new Cognito.ConfirmSignUpCommand({
      ClientId: clientId,
      SecretHash: await secretHash(clientId, username), // Now async
      Username: username,
      ConfirmationCode: confirmationCode,
    });

    await cognitoClient.send(command);
    console.log('User confirmed:', username);
    
    // Update user verification status in database
    try {
      connection = await db.getConnection();
      await connection.query(
        'UPDATE users SET verified = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2',
        [true, username]
      );
    } catch (dbError) {
      console.log('Database update error:', dbError.message);
    } finally {
      if (connection) connection.release();
    }

    res.json({ message: 'Email confirmed successfully. You can now login.' });

  } catch (error) {
    if (connection) connection.release();
    console.log('Confirmation error:', error);
    
    if (error.name === 'CodeMismatchException') {
      return res.status(400).json({ error: 'Invalid confirmation code' });
    } else if (error.name === 'ExpiredCodeException') {
      return res.status(400).json({ error: 'Confirmation code expired' });
    } else if (error.name === 'NotAuthorizedException') {
      return res.status(400).json({ error: 'User already confirmed or invalid code' });
    }
    
    res.status(500).json({ error: 'Confirmation failed' });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const command = new Cognito.InitiateAuthCommand({
      AuthFlow: Cognito.AuthFlowType.USER_PASSWORD_AUTH,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
        SECRET_HASH: await secretHash(clientId, username), // Now async
      },
      ClientId: clientId,
    });

    const result = await cognitoClient.send(command);
    console.log('Login success:', username);

    // Return both ID and Access tokens
    const tokens = {
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      refreshToken: result.AuthenticationResult.RefreshToken
    };

    res.json({ 
      message: 'Login successful',
      tokens: tokens,
      // For backward compatibility, return idToken as authToken
      authToken: tokens.idToken
    });

  } catch (error) {
    console.log('Login error:', error);
    
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({ error: 'Invalid username or password' });
    } else if (error.name === 'UserNotConfirmedException') {
      return res.status(400).json({ error: 'User not confirmed. Please check your email.' });
    } else if (error.name === 'TooManyRequestsException') {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
    
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken, username } = req.body;
    
    if (!refreshToken || !username) {
      return res.status(400).json({ error: 'Refresh token and username required' });
    }

    const command = new Cognito.InitiateAuthCommand({
      AuthFlow: Cognito.AuthFlowType.REFRESH_TOKEN_AUTH,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        SECRET_HASH: await secretHash(clientId, username), // Now async
      },
      ClientId: clientId,
    });

    const result = await cognitoClient.send(command);

    res.json({
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      authToken: result.AuthenticationResult.IdToken // For compatibility
    });

  } catch (error) {
    console.log('Refresh token error:', error);
    
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    res.status(401).json({ error: 'Token refresh failed' });
  }
};

exports.logout = async (req, res) => {
  try {
    // For more comprehensive logout, you could implement GlobalSignOut here
    // But for basic use, client-side token removal is sufficient
    console.log('User logged out:', req.user?.username || 'unknown');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.log('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

exports.getMe = async (req, res) => {
  let connection = null;
  
  try {
    // req.user is set by the Cognito middleware
    const userInfo = {
      username: req.user.username,
      email: req.user.email,
      sub: req.user.sub,
      tokenType: req.user.tokenType
    };

    // Fetch additional user data from your database
    try {
      connection = await db.getConnection();
      const users = await connection.query(
        'SELECT username, email, admin, verified, created_at FROM users WHERE username = $1',
        [req.user.username]
      );
      
      if (users.length > 0) {
        userInfo.dbData = users[0];
      }
    } catch (dbError) {
      console.log('Database fetch error:', dbError.message);
      // Don't fail the request if DB fetch fails
    } finally {
      if (connection) connection.release();
    }

    res.json(userInfo);
  } catch (error) {
    if (connection) connection.release();
    console.log('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user information' });
  }
};

exports.getMainPage = (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } catch (error) {
    console.log('Main page error:', error);
    res.status(500).json({ error: 'Failed to load main page' });
  }
};

exports.getAdminPage = async (req, res) => {
  let connection = null;
  
  try {
    // Check if user is admin
    connection = await db.getConnection();
    const users = await connection.query(
      'SELECT admin FROM users WHERE username = $1',
      [req.user.username]
    );

    if (users.length === 0 || !users[0].admin) {
      console.log('Unauthorized admin access attempt:', req.user.username);
      return res.status(403).json({ error: 'Admin access required' });
    }

    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    
  } catch (error) {
    console.log('Admin page error:', error);
    res.status(500).json({ error: 'Failed to load admin page' });
  } finally {
    if (connection) connection.release();
  }
};