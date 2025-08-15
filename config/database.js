const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Connection pool settings
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000, // Close connections after 30 seconds of inactivity
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection cannot be established
  maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test database connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
    client.release();
    
    console.log('✅ Database connected successfully');
    console.log(`📅 Current time: ${result.rows[0].current_time}`);
    console.log(`🗄️  PostgreSQL version: ${result.rows[0].postgres_version.split(' ')[0]}`);
    
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  }
};

// Database health check query
const healthCheck = async () => {
  try {
    const client = await pool.connect();
    const start = Date.now();
    
    // Simple query to test connection
    const result = await client.query('SELECT 1 as health_check, NOW() as timestamp');
    
    const duration = Date.now() - start;
    client.release();
    
    return {
      status: 'healthy',
      message: 'Database connection successful',
      response_time_ms: duration,
      timestamp: result.rows[0].timestamp,
      pool_stats: {
        total_connections: pool.totalCount,
        idle_connections: pool.idleCount,
        waiting_clients: pool.waitingCount
      }
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      message: 'Database connection failed',
      error: err.message
    };
  }
};

// Graceful shutdown
const closePool = async () => {
  try {
    await pool.end();
    console.log('📊 Database pool closed');
  } catch (err) {
    console.error('Error closing database pool:', err.message);
  }
};

module.exports = {
  pool,
  testConnection,
  healthCheck,
  closePool
};
