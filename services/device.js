const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Generate unique profile UUID for device
const generateProfileUUID = () => {
  return uuidv4().toUpperCase();
};

// Get device limits based on subscription plan
const getDeviceLimits = (subscriptionPlan) => {
  const limits = {
    'inactive': { maxDevices: 1, maxTimerDays: 1 },
    '1-month': { maxDevices: 3, maxTimerDays: 30 },
    '3-months': { maxDevices: 5, maxTimerDays: 90 },
    '6-months': { maxDevices: 8, maxTimerDays: 180 },
    '1-year': { maxDevices: 10, maxTimerDays: 365 }
  };
  
  return limits[subscriptionPlan] || limits['inactive'];
};

// Validate device registration request
const validateDeviceData = (deviceData) => {
  const errors = [];
  
  if (!deviceData.deviceName || deviceData.deviceName.trim().length === 0) {
    errors.push('Device name is required');
  }
  
  if (deviceData.deviceName && deviceData.deviceName.length > 100) {
    errors.push('Device name must be less than 100 characters');
  }
  
  if (deviceData.deviceUdid && deviceData.deviceUdid.length !== 40) {
    errors.push('Device UDID must be exactly 40 characters if provided');
  }
  
  if (deviceData.deviceType && !['ios', 'android'].includes(deviceData.deviceType)) {
    errors.push('Device type must be either "ios" or "android"');
  }
  
  return errors;
};

// Check if user can add more devices
const checkDeviceLimit = async (userId) => {
  try {
    // Get user's current subscription and device count
    const result = await pool.query(`
      SELECT 
        subscription_plan,
        subscription_status,
        (SELECT COUNT(*) FROM device_profiles WHERE user_id = $1 AND device_status = 'active') as device_count
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return { canAdd: false, error: 'User not found' };
    }
    
    const { subscription_plan, subscription_status, device_count } = result.rows[0];
    const limits = getDeviceLimits(subscription_plan);
    
    if (parseInt(device_count) >= limits.maxDevices) {
      return {
        canAdd: false,
        error: `Device limit reached. Your ${subscription_plan || 'inactive'} plan allows ${limits.maxDevices} device(s).`,
        currentCount: parseInt(device_count),
        maxDevices: limits.maxDevices,
        subscriptionPlan: subscription_plan
      };
    }
    
    return {
      canAdd: true,
      currentCount: parseInt(device_count),
      maxDevices: limits.maxDevices,
      subscriptionPlan: subscription_plan
    };
    
  } catch (error) {
    console.error('❌ Error checking device limit:', error.message);
    return { canAdd: false, error: 'Failed to check device limit' };
  }
};

// Register new device for user
const registerDevice = async (userId, deviceData) => {
  try {
    console.log('📱 Registering device for user:', userId);
    
    // Validate device data
    const validationErrors = validateDeviceData(deviceData);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: 'Validation failed',
        details: validationErrors
      };
    }
    
    // Check device limits
    const limitCheck = await checkDeviceLimit(userId);
    if (!limitCheck.canAdd) {
      return {
        success: false,
        error: limitCheck.error,
        limits: limitCheck
      };
    }
    
    // Check if device with same name already exists for user
    const existingDevice = await pool.query(
      'SELECT id FROM device_profiles WHERE user_id = $1 AND device_name = $2 AND device_status = $3',
      [userId, deviceData.deviceName.trim(), 'active']
    );
    
    if (existingDevice.rows.length > 0) {
      return {
        success: false,
        error: 'A device with this name already exists'
      };
    }
    
    // Check if UDID already exists (if provided)
    if (deviceData.deviceUdid) {
      const existingUdid = await pool.query(
        'SELECT id, user_id FROM device_profiles WHERE device_udid = $1 AND device_status = $2',
        [deviceData.deviceUdid, 'active']
      );
      
      if (existingUdid.rows.length > 0) {
        return {
          success: false,
          error: 'This device is already registered'
        };
      }
    }
    
    // Generate profile UUID and name
    const profileUuid = generateProfileUUID();
    const profileName = `Altrii Recovery - ${deviceData.deviceName}`;
    
    // Insert device record
    const result = await pool.query(`
      INSERT INTO device_profiles (
        user_id,
        device_name,
        device_udid,
        device_type,
        device_model,
        ios_version,
        profile_uuid,
        profile_name,
        profile_description,
        device_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      userId,
      deviceData.deviceName.trim(),
      deviceData.deviceUdid || null,
      deviceData.deviceType || 'ios',
      deviceData.deviceModel || null,
      deviceData.iosVersion || null,
      profileUuid,
      profileName,
      `Content blocking profile for ${deviceData.deviceName}`,
      'active'
    ]);
    
    const newDevice = result.rows[0];
    console.log('✅ Device registered successfully:', newDevice.id);
    
    return {
      success: true,
      device: {
        id: newDevice.id,
        deviceName: newDevice.device_name,
        deviceType: newDevice.device_type,
        deviceModel: newDevice.device_model,
        iosVersion: newDevice.ios_version,
        profileUuid: newDevice.profile_uuid,
        profileName: newDevice.profile_name,
        profileInstalled: newDevice.profile_installed,
        deviceStatus: newDevice.device_status,
        createdAt: newDevice.created_at
      }
    };
    
  } catch (error) {
    console.error('❌ Device registration failed:', error.message);
    return {
      success: false,
      error: 'Device registration failed',
      message: error.message
    };
  }
};

// Get all devices for user
const getUserDevices = async (userId) => {
  try {
    console.log('📱 Getting devices for user:', userId);
    
    const result = await pool.query(`
      SELECT 
        id,
        device_name,
        device_udid,
        device_type,
        device_model,
        ios_version,
        profile_uuid,
        profile_name,
        profile_installed,
        profile_install_date,
        mdm_enrolled,
        mdm_enrollment_date,
        device_status,
        last_checkin,
        created_at,
        updated_at
      FROM device_profiles 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [userId]);
    
    const devices = result.rows.map(device => ({
      id: device.id,
      deviceName: device.device_name,
      deviceUdid: device.device_udid,
      deviceType: device.device_type,
      deviceModel: device.device_model,
      iosVersion: device.ios_version,
      profileUuid: device.profile_uuid,
      profileName: device.profile_name,
      profileInstalled: device.profile_installed,
      profileInstallDate: device.profile_install_date,
      mdmEnrolled: device.mdm_enrolled,
      mdmEnrollmentDate: device.mdm_enrollment_date,
      deviceStatus: device.device_status,
      lastCheckin: device.last_checkin,
      createdAt: device.created_at,
      updatedAt: device.updated_at
    }));
    
    return {
      success: true,
      devices: devices,
      deviceCount: devices.filter(d => d.deviceStatus === 'active').length
    };
    
  } catch (error) {
    console.error('❌ Failed to get user devices:', error.message);
    return {
      success: false,
      error: 'Failed to retrieve devices'
    };
  }
};

// Get single device by ID
const getDeviceById = async (userId, deviceId) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        device_name,
        device_udid,
        device_type,
        device_model,
        ios_version,
        profile_uuid,
        profile_name,
        profile_description,
        profile_installed,
        profile_install_date,
        mdm_enrolled,
        mdm_enrollment_date,
        mdm_device_id,
        device_status,
        last_checkin,
        created_at,
        updated_at
      FROM device_profiles 
      WHERE id = $1 AND user_id = $2
    `, [deviceId, userId]);
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Device not found'
      };
    }
    
    const device = result.rows[0];
    
    return {
      success: true,
      device: {
        id: device.id,
        deviceName: device.device_name,
        deviceUdid: device.device_udid,
        deviceType: device.device_type,
        deviceModel: device.device_model,
        iosVersion: device.ios_version,
        profileUuid: device.profile_uuid,
        profileName: device.profile_name,
        profileDescription: device.profile_description,
        profileInstalled: device.profile_installed,
        profileInstallDate: device.profile_install_date,
        mdmEnrolled: device.mdm_enrolled,
        mdmEnrollmentDate: device.mdm_enrollment_date,
        mdmDeviceId: device.mdm_device_id,
        deviceStatus: device.device_status,
        lastCheckin: device.last_checkin,
        createdAt: device.created_at,
        updatedAt: device.updated_at
      }
    };
    
  } catch (error) {
    console.error('❌ Failed to get device:', error.message);
    return {
      success: false,
      error: 'Failed to retrieve device'
    };
  }
};

// Update device information
const updateDevice = async (userId, deviceId, updateData) => {
  try {
    console.log('📱 Updating device:', deviceId);
    
    // Validate update data
    const allowedFields = ['device_name', 'device_model', 'ios_version'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        updates[field] = updateData[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return {
        success: false,
        error: 'No valid fields to update'
      };
    }
    
    // Build query
    const setClause = Object.keys(updates).map((key, index) => `${key} = $${index + 3}`).join(', ');
    const values = [deviceId, userId, ...Object.values(updates)];
    
    const result = await pool.query(`
      UPDATE device_profiles 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, values);
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Device not found'
      };
    }
    
    console.log('✅ Device updated successfully');
    
    return {
      success: true,
      device: result.rows[0]
    };
    
  } catch (error) {
    console.error('❌ Device update failed:', error.message);
    return {
      success: false,
      error: 'Device update failed'
    };
  }
};

// Remove device (soft delete)
const removeDevice = async (userId, deviceId) => {
  try {
    console.log('📱 Removing device:', deviceId);
    
    const result = await pool.query(`
      UPDATE device_profiles 
      SET 
        device_status = 'removed',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND device_status = 'active'
      RETURNING device_name
    `, [deviceId, userId]);
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Device not found or already removed'
      };
    }
    
    console.log('✅ Device removed successfully:', result.rows[0].device_name);
    
    return {
      success: true,
      message: 'Device removed successfully',
      deviceName: result.rows[0].device_name
    };
    
  } catch (error) {
    console.error('❌ Device removal failed:', error.message);
    return {
      success: false,
      error: 'Device removal failed'
    };
  }
};

// Update device profile installation status
const updateProfileStatus = async (deviceId, installed, installDate = null) => {
  try {
    await pool.query(`
      UPDATE device_profiles 
      SET 
        profile_installed = $1,
        profile_install_date = $2,
        last_checkin = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [installed, installDate, deviceId]);
    
    console.log('✅ Profile status updated for device:', deviceId);
    return true;
    
  } catch (error) {
    console.error('❌ Failed to update profile status:', error.message);
    return false;
  }
};

// Update device MDM enrollment status
const updateMDMStatus = async (deviceId, enrolled, mdmDeviceId = null) => {
  try {
    await pool.query(`
      UPDATE device_profiles 
      SET 
        mdm_enrolled = $1,
        mdm_enrollment_date = $2,
        mdm_device_id = $3,
        last_checkin = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [enrolled, enrolled ? new Date() : null, mdmDeviceId, deviceId]);
    
    console.log('✅ MDM status updated for device:', deviceId);
    return true;
    
  } catch (error) {
    console.error('❌ Failed to update MDM status:', error.message);
    return false;
  }
};

module.exports = {
  getDeviceLimits,
  checkDeviceLimit,
  registerDevice,
  getUserDevices,
  getDeviceById,
  updateDevice,
  removeDevice,
  updateProfileStatus,
  updateMDMStatus,
  generateProfileUUID
};
