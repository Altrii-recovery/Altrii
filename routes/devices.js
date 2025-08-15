const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all devices for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('📱 Getting devices for user:', req.user.userId);
    
    const result = await pool.query(
      `SELECT id, device_name, device_model, device_type, device_udid, 
              profile_uuid, profile_installed, mdm_enrolled, created_at
       FROM device_profiles 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    const devices = result.rows.map(device => ({
      id: device.id,
      deviceName: device.device_name,
      deviceModel: device.device_model,
      deviceType: device.device_type,
      deviceUdid: device.device_udid,
      profileUuid: device.profile_uuid,
      profileInstalled: device.profile_installed,
      mdmEnrolled: device.mdm_enrolled,
      createdAt: device.created_at
    }));

    // Get device limits based on subscription
    const deviceLimit = 10; // Increased for testing
    
    console.log('✅ Returning', devices.length, 'devices');

    res.json({
      devices,
      summary: {
        totalDevices: devices.length,
        deviceLimit,
        profilesInstalled: devices.filter(d => d.profileInstalled).length
      }
    });
  } catch (error) {
    console.error('❌ Get devices error:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

// Register new device
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('📱 === DEVICE CREATION START ===');
    console.log('User:', { userId: req.user.userId, email: req.user.email });
    console.log('Request body:', req.body);

    const { deviceName, deviceModel, deviceType = 'iOS', deviceUdid } = req.body;

    if (!deviceName || deviceName.trim().length === 0) {
      console.log('❌ Invalid device name:', deviceName);
      return res.status(400).json({ error: 'Device name is required' });
    }

    if (deviceName.length > 100) {
      console.log('❌ Device name too long:', deviceName.length);
      return res.status(400).json({ error: 'Device name too long' });
    }

    // Check device limit (simplified - you'll want to check actual subscription)
    console.log('🔍 Checking device limit...');
    const existingDevices = await pool.query(
      'SELECT COUNT(*) as count FROM device_profiles WHERE user_id = $1',
      [req.user.userId]
    );

    console.log('Current device count:', existingDevices.rows[0].count);

    const deviceLimit = 10; // Increased for testing - was 1
    if (parseInt(existingDevices.rows[0].count) >= deviceLimit) {
      console.log('❌ Device limit reached');
      return res.status(403).json({ 
        error: 'Device limit reached. Upgrade your subscription to add more devices.' 
      });
    }

    // Check for duplicate UDID if provided
    if (deviceUdid) {
      console.log('🔍 Checking for duplicate UDID...');
      const duplicateCheck = await pool.query(
        'SELECT id FROM device_profiles WHERE device_udid = $1 AND user_id != $2',
        [deviceUdid, req.user.userId]
      );

      if (duplicateCheck.rows.length > 0) {
        console.log('❌ Duplicate UDID found');
        return res.status(400).json({ error: 'Device already registered by another user' });
      }
    }

    // Generate profile UUID
    const profileUuid = uuidv4();
    console.log('Generated profile UUID:', profileUuid);

    console.log('📝 Inserting device with values:', {
      userId: req.user.userId,
      deviceName: deviceName.trim(),
      deviceModel: deviceModel ? deviceModel.trim() : null,
      deviceType,
      deviceUdid: deviceUdid || null,
      profileUuid
    });

    // Insert new device - using the actual column names from your table
    const result = await pool.query(
      `INSERT INTO device_profiles 
       (user_id, device_name, device_model, device_type, device_udid, profile_uuid, profile_name, profile_installed, mdm_enrolled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, device_name, device_model, device_type, profile_uuid, created_at`,
      [
        req.user.userId,
        deviceName.trim(),
        deviceModel ? deviceModel.trim() : null,
        deviceType.toLowerCase(), // Your table has lowercase default
        deviceUdid || null,
        profileUuid,
        `${deviceName.trim()} Profile`, // profile_name is required
        false,
        false
      ]
    );

    console.log('✅ Device created successfully:', result.rows[0]);

    const device = result.rows[0];

    res.status(201).json({
      success: true,
      device: {
        id: device.id,
        deviceName: device.device_name,
        deviceModel: device.device_model,
        deviceType: device.device_type,
        profileUuid: device.profile_uuid,
        profileInstalled: false,
        mdmEnrolled: false,
        createdAt: device.created_at
      }
    });

    console.log('🏁 === DEVICE CREATION END ===');

  } catch (error) {
    console.error('💥 === DEVICE CREATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error constraint:', error.constraint);
    console.error('Error hint:', error.hint);
    console.error('Full error stack:', error.stack);

    // Handle specific database errors
    if (error.code === '42703') {
      console.error('Missing column in device_profiles table');
      return res.status(500).json({ 
        error: 'Database schema issue - missing column in device_profiles table',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else if (error.code === '42P01') {
      console.error('device_profiles table not found');
      return res.status(500).json({ 
        error: 'Device table not found. Database setup issue.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else if (error.code === '23503') {
      console.error('Foreign key constraint violation');
      return res.status(400).json({ 
        error: 'Invalid user reference',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else if (error.code === '23505') {
      console.error('Unique constraint violation');
      return res.status(400).json({ 
        error: 'Device already exists',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else if (error.code === '23502') {
      console.error('NOT NULL constraint violation');
      return res.status(400).json({ 
        error: 'Required field missing',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    res.status(500).json({ 
      error: 'Failed to add device',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        constraint: error.constraint
      } : undefined
    });
  }
});

// Update device
router.put('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { deviceName, deviceModel, profileInstalled, mdmEnrolled } = req.body;

    // Verify device ownership
    const deviceCheck = await pool.query(
      'SELECT id FROM device_profiles WHERE id = $1 AND user_id = $2',
      [deviceId, req.user.userId]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (deviceName !== undefined) {
      updates.push(`device_name = $${paramCount++}`);
      values.push(deviceName.trim());
    }

    if (deviceModel !== undefined) {
      updates.push(`device_model = $${paramCount++}`);
      values.push(deviceModel ? deviceModel.trim() : null);
    }

    if (profileInstalled !== undefined) {
      updates.push(`profile_installed = $${paramCount++}`);
      values.push(profileInstalled);
    }

    if (mdmEnrolled !== undefined) {
      updates.push(`mdm_enrolled = $${paramCount++}`);
      values.push(mdmEnrolled);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(deviceId);

    const result = await pool.query(
      `UPDATE device_profiles SET ${updates.join(', ')} 
       WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
       RETURNING id, device_name, device_model, profile_installed, mdm_enrolled`,
      [...values, req.user.userId]
    );

    res.json({
      success: true,
      device: {
        id: result.rows[0].id,
        deviceName: result.rows[0].device_name,
        deviceModel: result.rows[0].device_model,
        profileInstalled: result.rows[0].profile_installed,
        mdmEnrolled: result.rows[0].mdm_enrolled
      }
    });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// Delete device
router.delete('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;

    // Check if settings are locked by active timer
    const timerCheck = await pool.query(
      'SELECT id FROM timer_commitments WHERE user_id = $1 AND status = $2 AND device_id = $3',
      [req.user.userId, 'active', deviceId]
    );

    if (timerCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot remove device while timer is active for this device' 
      });
    }

    // Delete device
    const result = await pool.query(
      'DELETE FROM device_profiles WHERE id = $1 AND user_id = $2 RETURNING id',
      [deviceId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({
      success: true,
      message: 'Device removed successfully'
    });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

// Get device limits based on subscription
router.get('/limits', authenticateToken, async (req, res) => {
  try {
    const limits = {
      inactive: { devices: 1, timerDuration: 24 },
      '1_month': { devices: 3, timerDuration: 720 },
      '3_months': { devices: 5, timerDuration: 2160 },
      '6_months': { devices: 8, timerDuration: 4320 },
      '1_year': { devices: 10, timerDuration: 8760 }
    };

    const currentPlan = 'inactive'; // TODO: Get from subscription service

    res.json({
      currentPlan,
      limits: limits[currentPlan],
      allLimits: limits
    });
  } catch (error) {
    console.error('Get limits error:', error);
    res.status(500).json({ error: 'Failed to get device limits' });
  }
});

// Get device by ID
router.get('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await pool.query(
      `SELECT id, device_name, device_model, device_type, device_udid, 
              profile_uuid, profile_installed, mdm_enrolled, created_at, updated_at
       FROM device_profiles 
       WHERE id = $1 AND user_id = $2`,
      [deviceId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = result.rows[0];

    res.json({
      device: {
        id: device.id,
        deviceName: device.device_name,
        deviceModel: device.device_model,
        deviceType: device.device_type,
        deviceUdid: device.device_udid,
        profileUuid: device.profile_uuid,
        profileInstalled: device.profile_installed,
        mdmEnrolled: device.mdm_enrolled,
        createdAt: device.created_at,
        updatedAt: device.updated_at
      }
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ error: 'Failed to get device' });
  }
});

module.exports = router;
