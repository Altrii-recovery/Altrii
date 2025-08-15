const { pool } = require('../config/database');
const { getDeviceLimits } = require('./device');

// Timer status constants
const TIMER_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
};

// Get timer limits based on subscription plan
const getTimerLimits = (subscriptionPlan) => {
  const limits = getDeviceLimits(subscriptionPlan);
  return {
    maxTimerDays: limits.maxTimerDays,
    maxTimerHours: limits.maxTimerDays * 24,
    canCreateTimer: limits.maxTimerDays > 0
  };
};

// Validate timer duration against subscription limits
const validateTimerDuration = (durationHours, subscriptionPlan) => {
  const limits = getTimerLimits(subscriptionPlan);
  
  if (!limits.canCreateTimer) {
    return {
      valid: false,
      error: 'Timer commitments require an active subscription',
      maxAllowed: 0
    };
  }
  
  if (durationHours <= 0) {
    return {
      valid: false,
      error: 'Timer duration must be at least 1 hour',
      maxAllowed: limits.maxTimerHours
    };
  }
  
  if (durationHours > limits.maxTimerHours) {
    return {
      valid: false,
      error: `Timer duration exceeds plan limit of ${limits.maxTimerDays} days`,
      maxAllowed: limits.maxTimerHours,
      maxDays: limits.maxTimerDays
    };
  }
  
  return {
    valid: true,
    maxAllowed: limits.maxTimerHours,
    maxDays: limits.maxTimerDays
  };
};

// Check if user has active timer
const checkActiveTimer = async (userId, deviceId = null) => {
  try {
    let query, params;
    
    if (deviceId) {
      // Check for device-specific timer
      query = `
        SELECT 
          id,
          timer_duration_hours,
          timer_start_time,
          timer_end_time,
          timer_status,
          device_id
        FROM timer_commitments 
        WHERE user_id = $1 AND device_id = $2 AND timer_status = $3 AND timer_end_time > NOW()
        ORDER BY timer_end_time DESC
        LIMIT 1
      `;
      params = [userId, deviceId, TIMER_STATUS.ACTIVE];
    } else {
      // Check for any active timer for user
      query = `
        SELECT 
          id,
          timer_duration_hours,
          timer_start_time,
          timer_end_time,
          timer_status,
          device_id
        FROM timer_commitments 
        WHERE user_id = $1 AND timer_status = $2 AND timer_end_time > NOW()
        ORDER BY timer_end_time DESC
        LIMIT 1
      `;
      params = [userId, TIMER_STATUS.ACTIVE];
    }
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return {
        hasActiveTimer: false,
        timer: null
      };
    }
    
    const timer = result.rows[0];
    
    return {
      hasActiveTimer: true,
      timer: {
        id: timer.id,
        durationHours: timer.timer_duration_hours,
        startTime: timer.timer_start_time,
        endTime: timer.timer_end_time,
        status: timer.timer_status,
        deviceId: timer.device_id,
        timeRemaining: Math.max(0, Math.ceil((new Date(timer.timer_end_time) - new Date()) / (1000 * 60 * 60))), // hours remaining
        isExpired: new Date() >= new Date(timer.timer_end_time)
      }
    };
    
  } catch (error) {
    console.error('❌ Failed to check active timer:', error.message);
    return {
      hasActiveTimer: false,
      timer: null,
      error: error.message
    };
  }
};

// Create timer commitment
const createTimer = async (userId, deviceId, durationHours, lockSettings = true) => {
  try {
    console.log('⏰ Creating timer commitment for user:', userId, 'device:', deviceId, 'duration:', durationHours, 'hours');
    
    // Get user's subscription plan
    const userResult = await pool.query(
      'SELECT subscription_plan, subscription_status FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return {
        success: false,
        error: 'User not found'
      };
    }
    
    const { subscription_plan, subscription_status } = userResult.rows[0];
    
    // Validate timer duration against subscription limits
    const validation = validateTimerDuration(durationHours, subscription_plan);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        limits: validation
      };
    }
    
    // Check for existing active timer
    const activeTimerCheck = await checkActiveTimer(userId, deviceId);
    if (activeTimerCheck.hasActiveTimer) {
      return {
        success: false,
        error: 'User already has an active timer commitment',
        activeTimer: activeTimerCheck.timer
      };
    }
    
    // Verify device belongs to user (if device-specific)
    if (deviceId) {
      const deviceResult = await pool.query(
        'SELECT id, device_name FROM device_profiles WHERE id = $1 AND user_id = $2 AND device_status = $3',
        [deviceId, userId, 'active']
      );
      
      if (deviceResult.rows.length === 0) {
        return {
          success: false,
          error: 'Device not found or not accessible'
        };
      }
    }
    
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (durationHours * 60 * 60 * 1000));
    
    // Get current blocking settings to lock
    let lockedSettings = null;
    if (lockSettings) {
      const settingsResult = await pool.query(
        'SELECT * FROM blocking_settings WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)',
        [userId, deviceId]
      );
      
      if (settingsResult.rows.length > 0) {
        lockedSettings = settingsResult.rows[0];
      }
    }
    
    // Create timer commitment
    const timerResult = await pool.query(`
      INSERT INTO timer_commitments (
        user_id,
        device_id,
        timer_duration_hours,
        timer_start_time,
        timer_end_time,
        timer_status,
        max_allowed_hours,
        subscription_validated,
        locked_settings
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      userId,
      deviceId,
      durationHours,
      startTime,
      endTime,
      TIMER_STATUS.ACTIVE,
      validation.maxAllowed,
      subscription_status === 'active',
      lockedSettings ? JSON.stringify(lockedSettings) : null
    ]);
    
    const newTimer = timerResult.rows[0];
    
    // Lock blocking settings if requested
    if (lockSettings) {
      await pool.query(`
        UPDATE blocking_settings 
        SET settings_locked = true 
        WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)
      `, [userId, deviceId]);
    }
    
    console.log('✅ Timer commitment created successfully:', newTimer.id);
    
    return {
      success: true,
      timer: {
        id: newTimer.id,
        userId: newTimer.user_id,
        deviceId: newTimer.device_id,
        durationHours: newTimer.timer_duration_hours,
        startTime: newTimer.timer_start_time,
        endTime: newTimer.timer_end_time,
        status: newTimer.timer_status,
        settingsLocked: lockSettings,
        subscriptionValidated: newTimer.subscription_validated,
        timeRemaining: durationHours,
        createdAt: newTimer.created_at
      }
    };
    
  } catch (error) {
    console.error('❌ Timer creation failed:', error.message);
    return {
      success: false,
      error: 'Timer creation failed',
      message: error.message
    };
  }
};

// Get timer status
const getTimerStatus = async (userId, deviceId = null) => {
  try {
    console.log('⏰ Getting timer status for user:', userId, 'device:', deviceId);
    
    let query, params;
    
    if (deviceId) {
      query = `
        SELECT 
          tc.*,
          dp.device_name
        FROM timer_commitments tc
        LEFT JOIN device_profiles dp ON tc.device_id = dp.id
        WHERE tc.user_id = $1 AND tc.device_id = $2
        ORDER BY tc.created_at DESC
        LIMIT 5
      `;
      params = [userId, deviceId];
    } else {
      query = `
        SELECT 
          tc.*,
          dp.device_name
        FROM timer_commitments tc
        LEFT JOIN device_profiles dp ON tc.device_id = dp.id
        WHERE tc.user_id = $1
        ORDER BY tc.created_at DESC
        LIMIT 10
      `;
      params = [userId];
    }
    
    const result = await pool.query(query, params);
    
    const timers = result.rows.map(timer => {
      const now = new Date();
      const endTime = new Date(timer.timer_end_time);
      const timeRemaining = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));
      const isExpired = now >= endTime;
      
      return {
        id: timer.id,
        deviceId: timer.device_id,
        deviceName: timer.device_name || 'All Devices',
        durationHours: timer.timer_duration_hours,
        startTime: timer.timer_start_time,
        endTime: timer.timer_end_time,
        status: timer.timer_status,
        timeRemaining: timeRemaining,
        isExpired: isExpired,
        isActive: timer.timer_status === TIMER_STATUS.ACTIVE && !isExpired,
        emergencyUnlockRequested: timer.emergency_unlock_requested,
        emergencyUnlockTime: timer.emergency_unlock_time,
        completedSuccessfully: timer.completed_successfully,
        createdAt: timer.created_at
      };
    });
    
    // Find active timer
    const activeTimer = timers.find(t => t.isActive);
    
    return {
      success: true,
      activeTimer: activeTimer || null,
      recentTimers: timers,
      hasActiveTimer: !!activeTimer
    };
    
  } catch (error) {
    console.error('❌ Failed to get timer status:', error.message);
    return {
      success: false,
      error: 'Failed to get timer status'
    };
  }
};

// Request emergency unlock
const requestEmergencyUnlock = async (userId, timerId, reason) => {
  try {
    console.log('🚨 Emergency unlock requested for timer:', timerId, 'reason:', reason);
    
    // Verify timer belongs to user and is active
    const timerResult = await pool.query(`
      SELECT 
        id,
        timer_end_time,
        timer_status,
        emergency_unlock_requested
      FROM timer_commitments 
      WHERE id = $1 AND user_id = $2 AND timer_status = $3
    `, [timerId, userId, TIMER_STATUS.ACTIVE]);
    
    if (timerResult.rows.length === 0) {
      return {
        success: false,
        error: 'Timer not found or not active'
      };
    }
    
    const timer = timerResult.rows[0];
    
    if (timer.emergency_unlock_requested) {
      return {
        success: false,
        error: 'Emergency unlock already requested for this timer'
      };
    }
    
    // Check if timer has significant time remaining (prevent abuse)
    const timeRemaining = Math.ceil((new Date(timer.timer_end_time) - new Date()) / (1000 * 60 * 60));
    
    if (timeRemaining < 1) {
      return {
        success: false,
        error: 'Timer expires in less than 1 hour - please wait for natural expiration'
      };
    }
    
    // Update timer with emergency unlock request
    await pool.query(`
      UPDATE timer_commitments 
      SET 
        emergency_unlock_requested = true,
        emergency_unlock_time = NOW(),
        emergency_unlock_reason = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [reason, timerId]);
    
    console.log('⚠️ Emergency unlock request logged for timer:', timerId);
    
    // Note: In a production system, this would:
    // 1. Send email notification to user
    // 2. Require additional verification (phone, email code, etc.)
    // 3. Implement cooling-off period (24-48 hours)
    // 4. Log for review/support intervention
    
    return {
      success: true,
      message: 'Emergency unlock requested',
      note: 'Your request has been logged. In a production system, this would require additional verification and a cooling-off period.',
      timerId: timerId,
      timeRemaining: timeRemaining
    };
    
  } catch (error) {
    console.error('❌ Emergency unlock request failed:', error.message);
    return {
      success: false,
      error: 'Emergency unlock request failed'
    };
  }
};

// Cancel timer (admin function or emergency)
const cancelTimer = async (userId, timerId, reason = 'User requested') => {
  try {
    console.log('🛑 Cancelling timer:', timerId, 'reason:', reason);
    
    // Verify timer belongs to user and is active
    const timerResult = await pool.query(`
      SELECT 
        id,
        device_id,
        timer_status
      FROM timer_commitments 
      WHERE id = $1 AND user_id = $2 AND timer_status = $3
    `, [timerId, userId, TIMER_STATUS.ACTIVE]);
    
    if (timerResult.rows.length === 0) {
      return {
        success: false,
        error: 'Timer not found or not active'
      };
    }
    
    const timer = timerResult.rows[0];
    
    // Update timer status
    await pool.query(`
      UPDATE timer_commitments 
      SET 
        timer_status = $1,
        completed_successfully = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [TIMER_STATUS.CANCELLED, timerId]);
    
    // Unlock blocking settings
    await pool.query(`
      UPDATE blocking_settings 
      SET settings_locked = false 
      WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)
    `, [userId, timer.device_id]);
    
    console.log('✅ Timer cancelled and settings unlocked');
    
    return {
      success: true,
      message: 'Timer cancelled successfully',
      timerId: timerId
    };
    
  } catch (error) {
    console.error('❌ Timer cancellation failed:', error.message);
    return {
      success: false,
      error: 'Timer cancellation failed'
    };
  }
};

// Process expired timers (background job)
const processExpiredTimers = async () => {
  try {
    console.log('🔄 Processing expired timers...');
    
    // Find all active timers that have expired
    const expiredTimers = await pool.query(`
      SELECT 
        id,
        user_id,
        device_id,
        timer_end_time
      FROM timer_commitments 
      WHERE timer_status = $1 AND timer_end_time <= NOW()
    `, [TIMER_STATUS.ACTIVE]);
    
    let processedCount = 0;
    
    for (const timer of expiredTimers.rows) {
      try {
        // Update timer status to completed
        await pool.query(`
          UPDATE timer_commitments 
          SET 
            timer_status = $1,
            completed_successfully = true,
            completion_time = NOW(),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [TIMER_STATUS.COMPLETED, timer.id]);
        
        // Unlock blocking settings
        await pool.query(`
          UPDATE blocking_settings 
          SET settings_locked = false 
          WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)
        `, [timer.user_id, timer.device_id]);
        
        processedCount++;
        console.log('✅ Processed expired timer:', timer.id);
        
      } catch (error) {
        console.error('❌ Failed to process expired timer:', timer.id, error.message);
      }
    }
    
    console.log(`🔄 Processed ${processedCount} expired timers`);
    
    return {
      success: true,
      processedCount: processedCount,
      totalExpired: expiredTimers.rows.length
    };
    
  } catch (error) {
    console.error('❌ Failed to process expired timers:', error.message);
    return {
      success: false,
      error: 'Failed to process expired timers'
    };
  }
};

// Get user's timer history
const getTimerHistory = async (userId, limit = 20) => {
  try {
    const result = await pool.query(`
      SELECT 
        tc.*,
        dp.device_name
      FROM timer_commitments tc
      LEFT JOIN device_profiles dp ON tc.device_id = dp.id
      WHERE tc.user_id = $1
      ORDER BY tc.created_at DESC
      LIMIT $2
    `, [userId, limit]);
    
    const timers = result.rows.map(timer => ({
      id: timer.id,
      deviceId: timer.device_id,
      deviceName: timer.device_name || 'All Devices',
      durationHours: timer.timer_duration_hours,
      startTime: timer.timer_start_time,
      endTime: timer.timer_end_time,
      status: timer.timer_status,
      completedSuccessfully: timer.completed_successfully,
      emergencyUnlockRequested: timer.emergency_unlock_requested,
      createdAt: timer.created_at,
      completionTime: timer.completion_time
    }));
    
    return {
      success: true,
      timers: timers,
      totalCount: timers.length
    };
    
  } catch (error) {
    console.error('❌ Failed to get timer history:', error.message);
    return {
      success: false,
      error: 'Failed to get timer history'
    };
  }
};

module.exports = {
  TIMER_STATUS,
  getTimerLimits,
  validateTimerDuration,
  checkActiveTimer,
  createTimer,
  getTimerStatus,
  requestEmergencyUnlock,
  cancelTimer,
  processExpiredTimers,
  getTimerHistory
};
