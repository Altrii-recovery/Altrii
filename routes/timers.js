const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Simple test route to check if timer routes work at all
router.get('/test', (req, res) => {
  console.log('⏰ Timer test route accessed');
  res.json({ 
    message: 'Timer routes are working',
    timestamp: new Date().toISOString(),
    route: '/api/timers/test'
  });
});

// Test route with authentication
router.get('/test-auth', authenticateToken, (req, res) => {
  console.log('⏰ Timer auth test route accessed by user:', req.user.userId);
  res.json({ 
    message: 'Timer routes with auth are working',
    user: {
      userId: req.user.userId,
      email: req.user.email
    },
    timestamp: new Date().toISOString(),
    route: '/api/timers/test-auth'
  });
});

// Get timer status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    console.log('⏰ Timer status request for user:', req.user.userId);
    
    if (!req.user.userId) {
      console.error('❌ No userId in status request');
      return res.status(400).json({ error: 'Invalid user authentication' });
    }
    
    const result = await pool.query(
      `SELECT id, duration, start_time, end_time, status, device_id,
              EXTRACT(EPOCH FROM (end_time - NOW())) / 3600 as time_remaining
       FROM timer_commitments 
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.userId]
    );

    console.log('⏰ Timer status query result:', result.rows.length, 'rows');

    if (result.rows.length > 0) {
      const timer = result.rows[0];
      const response = {
        hasActiveTimer: true,
        activeTimer: {
          id: timer.id,
          duration: timer.duration,
          startTime: timer.start_time,
          endTime: timer.end_time,
          timeRemaining: Math.max(0, timer.time_remaining || 0),
          deviceId: timer.device_id,
          status: timer.status
        }
      };
      console.log('✅ Returning active timer:', response.activeTimer.id);
      res.json(response);
    } else {
      console.log('✅ No active timer found');
      res.json({
        hasActiveTimer: false,
        activeTimer: null
      });
    }
  } catch (error) {
    console.error('❌ Timer status error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: 'Failed to get timer status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get timer history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    console.log('⏰ Timer history request for user:', req.user.userId);
    
    if (!req.user.userId) {
      return res.status(400).json({ error: 'Invalid user authentication' });
    }
    
    const result = await pool.query(
      `SELECT id, duration, start_time, end_time, status, device_id, created_at
       FROM timer_commitments 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.userId]
    );

    const timers = result.rows.map(timer => ({
      id: timer.id,
      duration: timer.duration,
      startTime: timer.start_time,
      endTime: timer.end_time,
      status: timer.status,
      deviceId: timer.device_id,
      createdAt: timer.created_at
    }));

    console.log('✅ Timer history returned:', timers.length, 'timers');

    res.json({
      timers,
      total: result.rows.length
    });
  } catch (error) {
    console.error('❌ Timer history error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: 'Failed to get timer history',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create new timer
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('🚀 === TIMER CREATION START ===');
    console.log('User from token:', {
      userId: req.user.userId,
      email: req.user.email,
      type: typeof req.user.userId
    });
    console.log('Request body:', req.body);

    const { duration, deviceId } = req.body;

    // Validate duration
    if (!duration || isNaN(duration) || duration < 1 || duration > 8760) {
      console.log('❌ Invalid duration:', duration);
      return res.status(400).json({ 
        error: 'Invalid duration. Must be a number between 1 and 8760 hours.',
        received: duration,
        type: typeof duration
      });
    }

    // Check userId exists and is valid
    if (!req.user.userId || isNaN(req.user.userId)) {
      console.error('❌ Invalid userId:', req.user.userId, typeof req.user.userId);
      return res.status(400).json({ 
        error: 'Invalid user authentication',
        userId: req.user.userId,
        type: typeof req.user.userId
      });
    }

    // Check for existing active timer
    console.log('🔍 Checking for existing active timer...');
    const activeTimer = await pool.query(
      'SELECT id, duration, start_time FROM timer_commitments WHERE user_id = $1 AND status = $2',
      [req.user.userId, 'active']
    );

    console.log('Active timer check result:', activeTimer.rows.length, 'active timers');

    if (activeTimer.rows.length > 0) {
      console.log('❌ Active timer already exists:', activeTimer.rows[0]);
      return res.status(400).json({ 
        error: 'You already have an active timer',
        existingTimer: {
          id: activeTimer.rows[0].id,
          duration: activeTimer.rows[0].duration,
          startTime: activeTimer.rows[0].start_time
        }
      });
    }

    // Validate device if provided
    if (deviceId) {
      console.log('🔍 Validating device ID:', deviceId);
      const deviceCheck = await pool.query(
        'SELECT id, device_name FROM device_profiles WHERE id = $1 AND user_id = $2',
        [deviceId, req.user.userId]
      );
      
      if (deviceCheck.rows.length === 0) {
        console.log('❌ Invalid device ID:', deviceId);
        return res.status(400).json({ 
          error: 'Invalid device ID or device does not belong to user',
          deviceId: deviceId
        });
      }
      console.log('✅ Device validated:', deviceCheck.rows[0].device_name);
    }

    // Prepare timer data
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (parseInt(duration) * 60 * 60 * 1000));

    console.log('📝 Creating timer with values:', {
      userId: req.user.userId,
      deviceId: deviceId || null,
      duration: parseInt(duration),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    });

    // Insert timer
    const result = await pool.query(
      `INSERT INTO timer_commitments (user_id, device_id, duration, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, start_time, end_time, created_at`,
      [
        req.user.userId, 
        deviceId || null, 
        parseInt(duration), 
        startTime, 
        endTime, 
        'active'
      ]
    );

    console.log('✅ Timer created successfully!');
    console.log('Database result:', result.rows[0]);

    const responseData = {
      success: true,
      timer: {
        id: result.rows[0].id,
        duration: parseInt(duration),
        startTime: result.rows[0].start_time,
        endTime: result.rows[0].end_time,
        status: 'active',
        createdAt: result.rows[0].created_at
      }
    };

    console.log('📤 Sending response:', responseData);
    console.log('🏁 === TIMER CREATION END ===');

    res.status(201).json(responseData);

  } catch (error) {
    console.error('💥 === TIMER CREATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error constraint:', error.constraint);
    console.error('Error hint:', error.hint);
    console.error('Full error stack:', error.stack);
    
    // Handle specific database errors
    if (error.code === '23503') {
      console.error('Foreign key constraint violation');
      return res.status(400).json({ 
        error: 'Invalid user or device reference',
        code: error.code,
        constraint: error.constraint
      });
    } else if (error.code === '42P01') {
      console.error('Table not found');
      return res.status(500).json({ 
        error: 'Timer table not found. Database setup issue.',
        code: error.code
      });
    } else if (error.code === '23505') {
      console.error('Unique constraint violation');
      return res.status(400).json({ 
        error: 'Duplicate timer constraint violation',
        code: error.code
      });
    } else if (error.code === '23514') {
      console.error('Check constraint violation');
      return res.status(400).json({ 
        error: 'Timer validation failed',
        code: error.code,
        constraint: error.constraint
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create timer',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        constraint: error.constraint
      } : undefined
    });
  }
});

// Emergency unlock
router.post('/emergency-unlock', authenticateToken, async (req, res) => {
  try {
    console.log('🚨 Emergency unlock requested by user:', req.user.userId);
    
    // Find active timer
    const activeTimer = await pool.query(
      'SELECT id, duration, start_time FROM timer_commitments WHERE user_id = $1 AND status = $2',
      [req.user.userId, 'active']
    );

    if (activeTimer.rows.length === 0) {
      console.log('❌ No active timer found for emergency unlock');
      return res.status(400).json({ error: 'No active timer found' });
    }

    const timerId = activeTimer.rows[0].id;
    console.log('🔓 Cancelling timer:', timerId);

    // Cancel the timer and increment emergency unlock count
    await pool.query(
      `UPDATE timer_commitments 
       SET status = $1, end_time = NOW(), emergency_unlock_count = emergency_unlock_count + 1
       WHERE id = $2`,
      ['cancelled', timerId]
    );

    console.log('✅ Emergency unlock completed for timer:', timerId);

    res.json({
      success: true,
      message: 'Timer unlocked successfully',
      timerId: timerId
    });
  } catch (error) {
    console.error('❌ Emergency unlock error:', error);
    res.status(500).json({ 
      error: 'Failed to unlock timer',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Check if settings are locked
router.get('/lock-status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, end_time FROM timer_commitments WHERE user_id = $1 AND status = $2',
      [req.user.userId, 'active']
    );

    const locked = result.rows.length > 0;
    
    res.json({
      locked: locked,
      hasActiveTimer: locked,
      timerId: locked ? result.rows[0].id : null,
      unlockTime: locked ? result.rows[0].end_time : null
    });
  } catch (error) {
    console.error('❌ Lock status error:', error);
    res.status(500).json({ 
      error: 'Failed to check lock status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get timer info and limits
router.get('/info', authenticateToken, async (req, res) => {
  try {
    // TODO: Get actual subscription limits
    const limits = {
      inactive: 24, // 1 day
      '1_month': 720, // 30 days
      '3_months': 2160, // 90 days
      '6_months': 4320, // 180 days
      '1_year': 8760 // 365 days
    };

    const currentPlan = 'inactive'; // TODO: Get from subscription service

    res.json({
      maxDuration: limits[currentPlan],
      currentPlan: currentPlan,
      allLimits: limits,
      message: 'Timer system operational',
      features: {
        emergencyUnlock: true,
        settingsLock: true,
        deviceSpecific: true
      }
    });
  } catch (error) {
    console.error('❌ Timer info error:', error);
    res.status(500).json({ error: 'Failed to get timer info' });
  }
});

module.exports = router;
