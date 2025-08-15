const express = require('express');
const { pool } = require('../config/database');
const {
  hashPassword,
  comparePassword,
  generateJWT,
  generateVerificationToken,
  generatePasswordResetToken,
  validatePassword,
  validateEmail,
  generateExpirationTime
} = require('../utils/auth');
const { sendVerificationEmail } = require('../services/email');

const router = express.Router();

// User Registration Endpoint
router.post('/register', async (req, res) => {
  console.log('📝 Registration attempt:', { email: req.body.email, timestamp: new Date().toISOString() });

// Email verification endpoint
router.post('/verify-email', async (req, res) => {
  console.log('📧 Email verification attempt:', { token: req.body.token?.substring(0, 10) + '...', timestamp: new Date().toISOString() });
  
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        error: 'Verification failed',
        message: 'Verification token is required'
      });
    }
    
    // Find user with this verification token
    const result = await pool.query(`
      SELECT 
        id, 
        email, 
        first_name, 
        email_verified,
        email_verification_expires
      FROM users 
      WHERE email_verification_token = $1
    `, [token]);
    
    if (result.rows.length === 0) {
      console.log('❌ Email verification failed: Invalid token');
      return res.status(400).json({
        error: 'Verification failed',
        message: 'Invalid verification token'
      });
    }
    
    const user = result.rows[0];
    
    // Check if already verified
    if (user.email_verified) {
      console.log('✅ Email already verified:', user.email);
      return res.json({
        message: 'Email already verified',
        user: {
          id: user.id,
          email: user.email,
          emailVerified: true
        }
      });
    }
    
    // Check if token expired
    if (new Date() > user.email_verification_expires) {
      console.log('❌ Email verification failed: Token expired');
      return res.status(400).json({
        error: 'Verification failed',
        message: 'Verification token has expired. Please request a new verification email.'
      });
    }
    
    // Update user as verified
    await pool.query(`
      UPDATE users 
      SET 
        email_verified = true,
        email_verification_token = NULL,
        email_verification_expires = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [user.id]);
    
    console.log('✅ Email verified successfully:', user.email);
    
    // Generate new JWT token with updated verification status
    const token_jwt = generateJWT(user.id, user.email);
    
    res.json({
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        emailVerified: true
      },
      token: token_jwt
    });
    
  } catch (error) {
    console.error('❌ Email verification error:', error.message);
    res.status(500).json({
      error: 'Verification failed',
      message: 'An error occurred during email verification'
    });
  }
});

// Resend verification email endpoint
router.post('/resend-verification', async (req, res) => {
  console.log('📧 Resend verification request:', { email: req.body.email, timestamp: new Date().toISOString() });
  
  try {
    const { email } = req.body;
    
    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({
        error: 'Validation failed',
        message: emailError
      });
    }
    
    // Find user
    const result = await pool.query(`
      SELECT 
        id, 
        email, 
        first_name, 
        email_verified
      FROM users 
      WHERE email = $1
    `, [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      // Don't reveal if email exists for security
      return res.json({
        message: 'If an account with this email exists and is not verified, a verification email has been sent.'
      });
    }
    
    const user = result.rows[0];
    
    if (user.email_verified) {
      return res.json({
        message: 'Email is already verified'
      });
    }
    
    // Generate new verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = generateExpirationTime(24); // 24 hours
    
    // Update user with new token
    await pool.query(`
      UPDATE users 
      SET 
        email_verification_token = $1,
        email_verification_expires = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [verificationToken, verificationExpires, user.id]);
    
    // Send verification email
    const emailResult = await sendVerificationEmail(
      user.email, 
      user.first_name, 
      verificationToken
    );
    
    if (emailResult.success) {
      console.log('✅ Verification email resent successfully');
      res.json({
        message: 'Verification email sent successfully',
        // Include for testing - remove in production
        verificationToken,
        verificationUrl: emailResult.verificationUrl
      });
    } else {
      console.error('❌ Failed to send verification email:', emailResult.error);
      res.status(500).json({
        error: 'Email sending failed',
        message: 'Unable to send verification email. Please try again later.'
      });
    }
    
  } catch (error) {
    console.error('❌ Resend verification error:', error.message);
    res.status(500).json({
      error: 'Resend failed',
      message: 'An error occurred while resending verification email'
    });
  }
});
  
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // Validation
    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({
        error: 'Validation failed',
        message: emailError
      });
    }
    
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Password does not meet requirements',
        details: passwordErrors
      });
    }
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      console.log('❌ Registration failed: Email already exists', email);
      return res.status(409).json({
        error: 'Registration failed',
        message: 'An account with this email already exists'
      });
    }
    
    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await hashPassword(password);
    
    // Generate email verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = generateExpirationTime(24); // 24 hours
    
    // Create user in database
    console.log('💾 Creating user in database...');
    const result = await pool.query(`
      INSERT INTO users (
        email, 
        password_hash, 
        first_name, 
        last_name, 
        email_verification_token, 
        email_verification_expires
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, first_name, last_name, created_at
    `, [
      email.toLowerCase(),
      passwordHash,
      firstName || null,
      lastName || null,
      verificationToken,
      verificationExpires
    ]);
    
    const newUser = result.rows[0];
    console.log('✅ User created successfully:', { id: newUser.id, email: newUser.email });
    
    // Generate JWT token for immediate login
    const token = generateJWT(newUser.id, newUser.email);
    
    // Return success response (without password hash)
    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        emailVerified: false,
        createdAt: newUser.created_at
      },
      token,
      verificationToken // Include for testing - remove in production
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error.message);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        error: 'Registration failed',
        message: 'An account with this email already exists'
      });
    }
    
    res.status(500).json({
      error: 'Registration failed',
      message: 'An error occurred during registration'
    });
  }
});

// User Login Endpoint
router.post('/login', async (req, res) => {
  console.log('🔑 Login attempt:', { email: req.body.email, timestamp: new Date().toISOString() });
  
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Login failed',
        message: 'Email and password are required'
      });
    }
    
    // Find user in database
    const result = await pool.query(`
      SELECT 
        id, 
        email, 
        password_hash, 
        first_name, 
        last_name, 
        email_verified,
        account_status,
        login_attempts,
        locked_until
      FROM users 
      WHERE email = $1
    `, [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      console.log('❌ Login failed: User not found', email);
      return res.status(401).json({
        error: 'Login failed',
        message: 'Invalid email or password'
      });
    }
    
    const user = result.rows[0];
    
    // Check if account is locked
    if (user.locked_until && new Date() < user.locked_until) {
      console.log('❌ Login failed: Account locked', email);
      return res.status(423).json({
        error: 'Account locked',
        message: 'Account is temporarily locked due to too many failed login attempts'
      });
    }
    
    // Check if account is active
    if (user.account_status !== 'active') {
      console.log('❌ Login failed: Account not active', email);
      return res.status(403).json({
        error: 'Login failed',
        message: 'Account is not active'
      });
    }
    
    // Verify password
    console.log('🔐 Verifying password...');
    const passwordValid = await comparePassword(password, user.password_hash);
    
    if (!passwordValid) {
      console.log('❌ Login failed: Invalid password', email);
      
      // Increment login attempts
      await pool.query(`
        UPDATE users 
        SET login_attempts = login_attempts + 1,
            locked_until = CASE 
              WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '30 minutes'
              ELSE NULL
            END
        WHERE id = $1
      `, [user.id]);
      
      return res.status(401).json({
        error: 'Login failed',
        message: 'Invalid email or password'
      });
    }
    
    // Reset login attempts and update last login
    await pool.query(`
      UPDATE users 
      SET login_attempts = 0, 
          locked_until = NULL, 
          last_login = NOW() 
      WHERE id = $1
    `, [user.id]);
    
    // Generate JWT token
    const token = generateJWT(user.id, user.email);
    
    console.log('✅ Login successful:', { id: user.id, email: user.email });
    
    // Return success response
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: user.email_verified
      },
      token
    });
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({
      error: 'Login failed',
      message: 'An error occurred during login'
    });
  }
});

// Test endpoint to verify authentication system
router.get('/test', (req, res) => {
  res.json({
    message: 'Authentication routes are working',
    endpoints: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      verifyEmail: 'POST /api/auth/verify-email',
      resendVerification: 'POST /api/auth/resend-verification',
      test: 'GET /api/auth/test',
      testRegister: 'GET /api/auth/test-register',
      testLogin: 'GET /api/auth/test-login',
      testEmailVerification: 'GET /api/auth/test-email-verification'
    }
  });
});

// Test email verification with existing test user
router.get('/test-email-verification', async (req, res) => {
  try {
    console.log('🧪 TEST: Email verification test');
    
    // Get test user (ID 1)
    const result = await pool.query(`
      SELECT 
        id, 
        email, 
        first_name, 
        email_verified,
        email_verification_token
      FROM users 
      WHERE id = 1
    `);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        status: '❌ FAILED',
        message: 'Test user not found',
        suggestion: 'Run /api/auth/test-register first'
      });
    }
    
    const user = result.rows[0];
    
    if (user.email_verified) {
      return res.json({
        status: '✅ ALREADY VERIFIED',
        message: 'Test user email is already verified',
        user: {
          id: user.id,
          email: user.email,
          emailVerified: true
        }
      });
    }
    
    // Generate new verification token if none exists
    let verificationToken = user.email_verification_token;
    
    if (!verificationToken) {
      verificationToken = generateVerificationToken();
      const verificationExpires = generateExpirationTime(24);
      
      await pool.query(`
        UPDATE users 
        SET 
          email_verification_token = $1,
          email_verification_expires = $2
        WHERE id = $3
      `, [verificationToken, verificationExpires, user.id]);
    }
    
    // Send test verification email
    const { sendVerificationEmail } = require('../services/email');
    const emailResult = await sendVerificationEmail(
      user.email,
      user.first_name,
      verificationToken
    );
    
    if (emailResult.success) {
      res.json({
        status: '✅ SUCCESS',
        message: 'Test verification email sent successfully',
        user: {
          id: user.id,
          email: user.email,
          emailVerified: false
        },
        verificationToken,
        verificationUrl: emailResult.verificationUrl,
        nextSteps: [
          'Check your email for the verification message',
          'Or use the verification token to test /api/auth/verify-email',
          'Or visit the verificationUrl shown above'
        ]
      });
    } else {
      res.status(500).json({
        status: '❌ EMAIL FAILED',
        message: 'Failed to send verification email',
        error: emailResult.error,
        verificationToken,
        note: 'You can still test verification with the token above'
      });
    }
    
  } catch (error) {
    console.error('❌ TEST Email verification error:', error.message);
    res.status(500).json({
      status: '❌ FAILED',
      error: 'Test email verification failed',
      message: error.message
    });
  }
});

// Test registration endpoint (GET request for easy browser testing)
router.get('/test-register', async (req, res) => {
  try {
    // Test with hardcoded data
    const testData = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User'
    };
    
    console.log('🧪 TEST: Registration attempt with:', testData.email);
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [testData.email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.json({
        status: 'skipped',
        message: 'Test user already exists',
        existingUser: {
          id: existingUser.rows[0].id,
          email: existingUser.rows[0].email
        },
        nextStep: 'Try /api/auth/test-login instead'
      });
    }
    
    // Hash password
    const passwordHash = await hashPassword(testData.password);
    
    // Generate verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = generateExpirationTime(24);
    
    // Create user
    const result = await pool.query(`
      INSERT INTO users (
        email, 
        password_hash, 
        first_name, 
        last_name, 
        email_verification_token, 
        email_verification_expires
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, first_name, last_name, created_at
    `, [
      testData.email.toLowerCase(),
      passwordHash,
      testData.firstName,
      testData.lastName,
      verificationToken,
      verificationExpires
    ]);
    
    const newUser = result.rows[0];
    const token = generateJWT(newUser.id, newUser.email);
    
    res.json({
      status: '✅ SUCCESS',
      message: 'Test registration successful',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        emailVerified: false,
        createdAt: newUser.created_at
      },
      token: token.substring(0, 20) + '...', // Truncated for display
      nextStep: 'Now try /api/auth/test-login'
    });
    
  } catch (error) {
    console.error('❌ TEST Registration error:', error.message);
    res.status(500).json({
      status: '❌ FAILED',
      error: 'Test registration failed',
      message: error.message
    });
  }
});

// Test login endpoint (GET request for easy browser testing)
router.get('/test-login', async (req, res) => {
  try {
    const testData = {
      email: 'test@example.com',
      password: 'TestPassword123!'
    };
    
    console.log('🧪 TEST: Login attempt with:', testData.email);
    
    // Find user
    const result = await pool.query(`
      SELECT 
        id, 
        email, 
        password_hash, 
        first_name, 
        last_name, 
        email_verified,
        account_status,
        login_attempts,
        locked_until
      FROM users 
      WHERE email = $1
    `, [testData.email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        status: '❌ FAILED',
        message: 'Test user not found',
        suggestion: 'Try /api/auth/test-register first'
      });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const passwordValid = await comparePassword(testData.password, user.password_hash);
    
    if (!passwordValid) {
      return res.status(401).json({
        status: '❌ FAILED',
        message: 'Password verification failed'
      });
    }
    
    // Update last login
    await pool.query(`
      UPDATE users 
      SET login_attempts = 0, 
          locked_until = NULL, 
          last_login = NOW() 
      WHERE id = $1
    `, [user.id]);
    
    // Generate token
    const token = generateJWT(user.id, user.email);
    
    res.json({
      status: '✅ SUCCESS',
      message: 'Test login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: user.email_verified
      },
      token: token.substring(0, 20) + '...', // Truncated for display
      fullTokenLength: token.length
    });
    
  } catch (error) {
    console.error('❌ TEST Login error:', error.message);
    res.status(500).json({
      status: '❌ FAILED',
      error: 'Test login failed',
      message: error.message
    });
  }
});

module.exports = router;
