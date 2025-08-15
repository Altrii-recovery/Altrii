const express = require('express');
const { 
  authenticateToken, 
  optionalAuth, 
  requireEmailVerification, 
  requireActiveSubscription,
  requireAdmin 
} = require('../middleware/auth');

const router = express.Router();

// Public endpoint (no authentication required)
router.get('/public', (req, res) => {
  res.json({
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString(),
    userAuthenticated: false
  });
});

// Optional authentication endpoint
router.get('/optional', optionalAuth, (req, res) => {
  res.json({
    message: 'This endpoint has optional authentication',
    timestamp: new Date().toISOString(),
    userAuthenticated: !!req.user,
    user: req.user || null
  });
});

// Protected endpoint (requires valid JWT)
router.get('/private', authenticateToken, (req, res) => {
  res.json({
    message: 'This is a protected endpoint',
    timestamp: new Date().toISOString(),
    user: {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      subscriptionStatus: req.user.subscriptionStatus
    }
  });
});

// User profile endpoint
router.get('/profile', authenticateToken, (req, res) => {
  res.json({
    message: 'User profile data',
    user: req.user
  });
});

// Email verification required endpoint
router.get('/verified-only', authenticateToken, requireEmailVerification, (req, res) => {
  res.json({
    message: 'This endpoint requires email verification',
    user: {
      id: req.user.id,
      email: req.user.email,
      emailVerified: req.user.emailVerified
    }
  });
});

// Active subscription required endpoint
router.get('/subscribers-only', authenticateToken, requireActiveSubscription, (req, res) => {
  res.json({
    message: 'This endpoint requires an active subscription',
    user: {
      id: req.user.id,
      email: req.user.email,
      subscriptionStatus: req.user.subscriptionStatus,
      subscriptionPlan: req.user.subscriptionPlan
    }
  });
});

// Admin only endpoint
router.get('/admin-only', authenticateToken, requireAdmin, (req, res) => {
  res.json({
    message: 'This is an admin-only endpoint',
    user: {
      id: req.user.id,
      email: req.user.email,
      isAdmin: req.user.id === 1
    }
  });
});

// Test endpoint with token generation helper
router.get('/test-info', (req, res) => {
  res.json({
    message: 'Protected routes testing information',
    endpoints: {
      public: 'GET /api/protected/public (no auth required)',
      optional: 'GET /api/protected/optional (optional auth)',
      private: 'GET /api/protected/private (auth required)',
      profile: 'GET /api/protected/profile (auth required)',
      verifiedOnly: 'GET /api/protected/verified-only (auth + email verification)',
      subscribersOnly: 'GET /api/protected/subscribers-only (auth + active subscription)',
      adminOnly: 'GET /api/protected/admin-only (auth + admin role)'
    },
    testInstructions: {
      step1: 'Get a token by visiting /api/auth/test-login',
      step2: 'Copy the token from the response',
      step3: 'Test protected endpoints using browser dev tools or curl with Authorization header',
      browserTesting: 'Use /api/protected/browser-test endpoint for easy browser testing'
    }
  });
});

// Browser-friendly test endpoint that reads token from query parameter
router.get('/browser-test', optionalAuth, (req, res) => {
  // For browser testing, allow token as query parameter
  let token = null;
  let user = req.user;
  
  // Check if token provided in query parameter
  if (req.query.token && !req.user) {
    try {
      const { verifyJWT } = require('../utils/auth');
      const { pool } = require('../config/database');
      
      // This is a simplified version for browser testing
      // In production, always use Authorization header
      res.json({
        message: 'For security, tokens should be sent in Authorization header',
        help: 'Use: Authorization: Bearer YOUR_TOKEN_HERE',
        currentUser: req.user,
        testEndpoints: {
          public: '/api/protected/public',
          optional: '/api/protected/optional',
          private: '/api/protected/private (needs auth header)'
        }
      });
      return;
    } catch (error) {
      // Token invalid, continue without user
    }
  }
  
  res.json({
    message: 'Browser testing endpoint',
    authenticated: !!user,
    user: user,
    instructions: {
      getToken: 'Visit /api/auth/test-login to get a token',
      useToken: 'Add Authorization header: Bearer YOUR_TOKEN',
      testEndpoints: 'Try /api/protected/private with the token'
    }
  });
});

module.exports = router;
