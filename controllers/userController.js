const Cognito = require("@aws-sdk/client-cognito-identity-provider");
const { secretHash, userPoolId, clientId, clientSecret } = require('../middleware/authMiddleware');
const path = require('path');
const db = require('../config/db');

// Initialize Cognito client
const cognitoClient = new Cognito.CognitoIdentityProviderClient({
  region: "ap-southeast-2",
});

exports.registerUser = async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Username, password, and email required' });
    }

    const command = new Cognito.SignUpCommand({
      ClientId: clientId,
      SecretHash: secretHash(clientId, clientSecret, username),
      Username: username,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email }
      ],
    });

    const result = await cognitoClient.send(command);
    console.log('User registered in Cognito:', username);
    
    // Store user info in your database if needed
    try {
      const connection = await db.getConnection();
      await connection.query(
        'INSERT INTO users (username, email, cognito_sub, verified) VALUES (?, ?, ?, ?)',
        [username, email, result.UserSub, 0]
      );
      connection.release();
    } catch (dbError) {
      console.log('Database error (user may already exist):', dbError.message);
    }

    res.status(201).json({ 
      message: 'User registered successfully. Check your email for confirmation code.',
      userSub: result.UserSub,
      needsConfirmation: true
    });

  } catch (error) {
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
  try {
    const { username, confirmationCode } = req.body;
    
    if (!username || !confirmationCode) {
      return res.status(400).json({ error: 'Username and confirmation code required' });
    }

    const command = new Cognito.ConfirmSignUpCommand({
      ClientId: clientId,
      SecretHash: secretHash(clientId, clientSecret, username),
      Username: username,
      ConfirmationCode: confirmationCode,
    });

    await cognitoClient.send(command);
    console.log('User confirmed:', username);
    
    // Update user verification status in database
    try {
      const connection = await db.getConnection();
      await connection.query(
        'UPDATE users SET verified = ? WHERE username = ?',
        [1, username]
      );
      connection.release();
    } catch (dbError) {
      console.log('Database update error:', dbError.message);
    }

    res.json({ message: 'Email confirmed successfully. You can now login.' });

  } catch (error) {
    console.log('Confirmation error:', error);
    
    if (error.name === 'CodeMismatchException') {
      return res.status(400).json({ error: 'Invalid confirmation code' });
    } else if (error.name === 'ExpiredCodeException') {
      return res.status(400).json({ error: 'Confirmation code expired' });
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
        SECRET_HASH: secretHash(clientId, clientSecret, username),
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
        SECRET_HASH: secretHash(clientId, clientSecret, username),
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
    res.status(401).json({ error: 'Token refresh failed' });
  }
};

exports.logout = (req, res) => {
  // With Cognito, logout is mainly handled client-side by discarding tokens
  // You could implement global sign-out here if needed
  console.log('User logged out');
  res.json({ message: 'Logged out successfully' });
};

exports.getMe = async (req, res) => {
  try {
    // req.user is set by the Cognito middleware
    const userInfo = {
      username: req.user.username,
      email: req.user.email,
      sub: req.user.sub
    };

    // Optionally fetch additional user data from your database
    try {
      const connection = await db.getConnection();
      const users = await connection.query(
        'SELECT * FROM users WHERE username = ?',
        [req.user.username]
      );
      connection.release();
      
      if (users.length > 0) {
        userInfo.dbData = users[0];
      }
    } catch (dbError) {
      console.log('Database fetch error:', dbError.message);
    }

    res.json(userInfo);
  } catch (error) {
    console.log('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user information' });
  }
};

exports.getMainPage = (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
};

exports.getAdminPage = async (req, res) => {
  try {
    // Check if user is admin (you'll need to implement this logic)
    // This could be stored in Cognito user attributes or your database
    const connection = await db.getConnection();
    const users = await connection.query(
      'SELECT admin FROM users WHERE username = ?',
      [req.user.username]
    );
    connection.release();

    if (users.length === 0 || !users[0].admin) {
      console.log('Unauthorized admin access:', req.user.username);
      return res.sendStatus(403);
    }

    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  } catch (error) {
    console.log('Admin page error:', error);
    res.status(500).json({ error: 'Failed to load admin page' });
  }
};