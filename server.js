const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// Import database configuration
const { testConnection, healthCheck, closePool } = require('./config/database');

// Test email configuration on startup
const { testEmailConfig } = require('./services/email');

// Test Stripe configuration on startup
const { testStripeConfig } = require('./services/stripe');

// Import ALL route files
const authRoutes = require('./routes/auth');
const protectedRoutes = require('./routes/protected');
const subscriptionRoutes = require('./routes/subscriptions');
const deviceRoutes = require('./routes/devices');
const blockingRoutes = require('./routes/blocking');
const profileRoutes = require('./routes/profiles');
const timerRoutes = require('./routes/timers');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware - Updated for serving static files
app.use(helmet({
  contentSecurityPolicy: false // Temporarily disable for testing
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || `http://localhost:${PORT}`,
  credentials: true
}));

// Logging middleware
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static('public'));

// Root route to serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Register ALL API routes
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/blocking', blockingRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/timers', timerRoutes);

// Debug route to show registered routes
app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  
  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      // Direct routes
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      // Router middleware
      const baseUrl = middleware.regexp.source
        .replace('\\/?(?=\\/|$)', '')
        .replace(/[\\^$]/g, '')
        .replace('\\/', '/')
        .replace('(?:[^\\/', '/');
      
      middleware.handle.stack.forEach(handler => {
        if (handler.route) {
          routes.push({
            path: baseUrl + handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  
  res.json({ 
    registeredRoutes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    totalRoutes: routes.length
  });
});

// Enhanced health check endpoint with database status
app.get('/health', async (req, res) => {
  const dbHealth = await healthCheck();
  
  const healthData = {
    status: dbHealth.status === 'healthy' ? 'OK' : 'DEGRADED',
    message: 'Altrii Recovery API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: '1.0.0',
    database: dbHealth
  };
  
  console.log('Health check requested:', {
    status: healthData.status,
    db_status: dbHealth.status,
    response_time: dbHealth.response_time_ms
  });
  
  const statusCode = dbHealth.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthData);
});

// Database-only health check endpoint
app.get('/health/database', async (req, res) => {
  const dbHealth = await healthCheck();
  const statusCode = dbHealth.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(dbHealth);
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Altrii Recovery API',
    version: '1.0.0',
    description: 'Digital wellness platform for content blocking',
    endpoints: {
      health: '/health',
      database_health: '/health/database',
      info: '/api/info',
      debug_routes: '/api/debug/routes'
    },
    features: {
      authentication: true,
      deviceManagement: true,
      contentBlocking: true,
      timerCommitments: true,
      subscriptionManagement: true,
      profileGeneration: true
    }
  });
});

// 404 handler for API routes only
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: '/api/debug/routes'
  });
});

// Serve frontend for all other routes (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server with database connection test
const startServer = async () => {
  try {
    // Test database connection first
    console.log('🔍 Testing database connection...');
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.warn('⚠️  Database connection failed, but starting server anyway');
      console.warn('   Health checks will show degraded status');
    }
    
    // Test email configuration
    console.log('📧 Testing email configuration...');
    const emailConfigured = await testEmailConfig();
    
    if (!emailConfigured) {
      console.warn('⚠️  Email configuration failed, email features may not work');
      console.warn('   Check your EMAIL_* environment variables');
    }
    
    // Test Stripe configuration
    console.log('💳 Testing Stripe configuration...');
    const stripeConfigured = await testStripeConfig();
    
    if (!stripeConfigured) {
      console.warn('⚠️  Stripe configuration failed, payment features may not work');
      console.warn('   Check your STRIPE_* environment variables');
    }
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Altrii Recovery API + Frontend started successfully`);
      console.log(`📍 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🎨 Frontend available at: http://localhost:${PORT}`);
      console.log(`✅ Health check: http://localhost:${PORT}/health`);
      console.log(`🗄️  Database health: http://localhost:${PORT}/health/database`);
      console.log(`📋 API info: http://localhost:${PORT}/api/info`);
      console.log(`🔍 Debug routes: http://localhost:${PORT}/api/debug/routes`);
      console.log('---');
      console.log('✅ Phase 13 testing ready! All routes registered.');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  
  try {
    await closePool();
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

module.exports = app;

