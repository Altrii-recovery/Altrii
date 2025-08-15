const jwt = require('jsonwebtoken');

// Main authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('🔐 Auth middleware - Token present:', !!token);
  console.log('🔐 Auth header:', authHeader ? 'Present' : 'Missing');

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('❌ JWT verification error:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    console.log('✅ Raw JWT payload:', user);
    
    // Handle different possible JWT payload structures
    let userId = user.userId || user.id || user.user_id;
    
    if (!userId) {
      console.error('❌ No userId found in JWT payload:', user);
      return res.status(403).json({ error: 'Invalid token payload - missing user ID' });
    }

    // Ensure consistent user object
    req.user = {
      userId: parseInt(userId), // Ensure it's a number
      id: parseInt(userId), // Include both for compatibility
      email: user.email,
      ...user
    };
    
    console.log('✅ Processed user object:', {
      userId: req.user.userId,
      email: req.user.email,
      type: typeof req.user.userId
    });
    
    next();
  });
};

// Optional authentication middleware (for endpoints that work with or without auth)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
    } else {
      let userId = user.userId || user.id || user.user_id;
      req.user = userId ? {
        userId: parseInt(userId),
        id: parseInt(userId),
        email: user.email,
        ...user
      } : null;
    }
    next();
  });
};

// Email verification required middleware
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (!req.user.emailVerified) {
    return res.status(403).json({ 
      error: 'Email verification required',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  
  next();
};

// Active subscription required middleware
const requireActiveSubscription = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // TODO: Check subscription status from database
  // For now, allow all authenticated users
  next();
};

// Admin only middleware
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireEmailVerification,
  requireActiveSubscription,
  requireAdmin
};
