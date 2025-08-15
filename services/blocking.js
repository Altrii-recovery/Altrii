const { pool } = require('../config/database');

// Define available content categories
const CONTENT_CATEGORIES = {
  adult_content: {
    name: 'Adult Content',
    description: 'Pornography, explicit content, and adult websites',
    defaultBlocked: true
  },
  gambling: {
    name: 'Gambling',
    description: 'Online casinos, betting sites, and gambling platforms',
    defaultBlocked: true
  },
  social_media: {
    name: 'Social Media',
    description: 'Facebook, Instagram, TikTok, Twitter, and other social platforms',
    defaultBlocked: false
  },
  gaming: {
    name: 'Gaming',
    description: 'Online games, gaming platforms, and game streaming',
    defaultBlocked: false
  },
  news: {
    name: 'News',
    description: 'News websites and current events platforms',
    defaultBlocked: false
  },
  entertainment: {
    name: 'Entertainment',
    description: 'Streaming services, movie sites, and entertainment platforms',
    defaultBlocked: false
  },
  shopping: {
    name: 'Shopping',
    description: 'E-commerce sites and online shopping platforms',
    defaultBlocked: false
  },
  dating: {
    name: 'Dating',
    description: 'Dating apps and relationship platforms',
    defaultBlocked: false
  }
};

// Get default blocking settings
const getDefaultBlockingSettings = () => {
  const settings = {};
  
  Object.keys(CONTENT_CATEGORIES).forEach(category => {
    settings[`block_${category}`] = CONTENT_CATEGORIES[category].defaultBlocked;
  });
  
  return {
    ...settings,
    custom_blocked_domains: [],
    custom_allowed_domains: [],
    enable_time_restrictions: false,
    allowed_hours_start: null,
    allowed_hours_end: null,
    blocked_days: [],
    enable_safe_search: true,
    block_explicit_content: true,
    settings_locked: false
  };
};

// Validate domain format
const validateDomain = (domain) => {
  if (!domain || typeof domain !== 'string') {
    return false;
  }
  
  // Remove protocol if present
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  
  // Basic domain validation regex
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
  
  return domainRegex.test(cleanDomain);
};

// Validate time format (HH:MM)
const validateTimeFormat = (time) => {
  if (!time) return true; // null/undefined is valid
  
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
};

// Validate blocking settings data
const validateBlockingSettings = (settings) => {
  const errors = [];
  
  // Validate category settings
  Object.keys(CONTENT_CATEGORIES).forEach(category => {
    const key = `block_${category}`;
    if (settings[key] !== undefined && typeof settings[key] !== 'boolean') {
      errors.push(`${key} must be true or false`);
    }
  });
  
  // Validate custom domains
  if (settings.custom_blocked_domains) {
    if (!Array.isArray(settings.custom_blocked_domains)) {
      errors.push('custom_blocked_domains must be an array');
    } else {
      settings.custom_blocked_domains.forEach((domain, index) => {
        if (!validateDomain(domain)) {
          errors.push(`Invalid blocked domain at index ${index}: ${domain}`);
        }
      });
    }
  }
  
  if (settings.custom_allowed_domains) {
    if (!Array.isArray(settings.custom_allowed_domains)) {
      errors.push('custom_allowed_domains must be an array');
    } else {
      settings.custom_allowed_domains.forEach((domain, index) => {
        if (!validateDomain(domain)) {
          errors.push(`Invalid allowed domain at index ${index}: ${domain}`);
        }
      });
    }
  }
  
  // Validate time restrictions
  if (settings.enable_time_restrictions !== undefined && typeof settings.enable_time_restrictions !== 'boolean') {
    errors.push('enable_time_restrictions must be true or false');
  }
  
  if (settings.allowed_hours_start && !validateTimeFormat(settings.allowed_hours_start)) {
    errors.push('allowed_hours_start must be in HH:MM format');
  }
  
  if (settings.allowed_hours_end && !validateTimeFormat(settings.allowed_hours_end)) {
    errors.push('allowed_hours_end must be in HH:MM format');
  }
  
  // Validate blocked days
  if (settings.blocked_days) {
    if (!Array.isArray(settings.blocked_days)) {
      errors.push('blocked_days must be an array');
    } else {
      settings.blocked_days.forEach((day, index) => {
        if (!Number.isInteger(day) || day < 0 || day > 6) {
          errors.push(`Invalid day at index ${index}: ${day} (must be 0-6)`);
        }
      });
    }
  }
  
  return errors;
};

// Get blocking settings for user/device
const getBlockingSettings = async (userId, deviceId = null) => {
  try {
    console.log('🛡️ Getting blocking settings for user:', userId, 'device:', deviceId);
    
    let query, params;
    
    if (deviceId) {
      // Get device-specific settings
      query = `
        SELECT * FROM blocking_settings 
        WHERE user_id = $1 AND device_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;
      params = [userId, deviceId];
    } else {
      // Get user's default settings (no device_id)
      query = `
        SELECT * FROM blocking_settings 
        WHERE user_id = $1 AND device_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
      params = [userId];
    }
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      // Return default settings if none exist
      const defaultSettings = getDefaultBlockingSettings();
      return {
        success: true,
        settings: {
          id: null,
          userId: userId,
          deviceId: deviceId,
          isDefault: true,
          ...defaultSettings,
          createdAt: null,
          updatedAt: null
        }
      };
    }
    
    const settings = result.rows[0];
    
    return {
      success: true,
      settings: {
        id: settings.id,
        userId: settings.user_id,
        deviceId: settings.device_id,
        isDefault: false,
        
        // Content categories
        blockAdultContent: settings.block_adult_content,
        blockGambling: settings.block_gambling,
        blockSocialMedia: settings.block_social_media,
        blockGaming: settings.block_gaming,
        blockNews: settings.block_news,
        blockEntertainment: settings.block_entertainment,
        blockShopping: settings.block_shopping,
        blockDating: settings.block_dating,
        
        // Custom domains
        customBlockedDomains: settings.custom_blocked_domains || [],
        customAllowedDomains: settings.custom_allowed_domains || [],
        
        // Time restrictions
        enableTimeRestrictions: settings.enable_time_restrictions,
        allowedHoursStart: settings.allowed_hours_start,
        allowedHoursEnd: settings.allowed_hours_end,
        blockedDays: settings.blocked_days || [],
        
        // Safe search
        enableSafeSearch: settings.enable_safe_search,
        blockExplicitContent: settings.block_explicit_content,
        
        // Meta
        settingsLocked: settings.settings_locked,
        settingsVersion: settings.settings_version,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    };
    
  } catch (error) {
    console.error('❌ Failed to get blocking settings:', error.message);
    return {
      success: false,
      error: 'Failed to retrieve blocking settings'
    };
  }
};

// Create or update blocking settings
const saveBlockingSettings = async (userId, deviceId, settingsData) => {
  try {
    console.log('🛡️ Saving blocking settings for user:', userId, 'device:', deviceId);
    
    // Validate settings data
    const validationErrors = validateBlockingSettings(settingsData);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: 'Validation failed',
        details: validationErrors
      };
    }
    
    // Check if settings are locked (timer active)
    if (deviceId) {
      const lockCheck = await checkSettingsLocked(userId, deviceId);
      if (lockCheck.locked) {
        return {
          success: false,
          error: 'Settings are locked due to active timer commitment',
          lockInfo: lockCheck
        };
      }
    }
    
    // Check if settings already exist
    const existingResult = await pool.query(
      'SELECT id FROM blocking_settings WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)',
      [userId, deviceId]
    );
    
    const settingsExists = existingResult.rows.length > 0;
    const settingsId = settingsExists ? existingResult.rows[0].id : null;
    
    // Prepare data for database
    const dbData = {
      user_id: userId,
      device_id: deviceId,
      block_adult_content: settingsData.blockAdultContent ?? false,
      block_gambling: settingsData.blockGambling ?? false,
      block_social_media: settingsData.blockSocialMedia ?? false,
      block_gaming: settingsData.blockGaming ?? false,
      block_news: settingsData.blockNews ?? false,
      block_entertainment: settingsData.blockEntertainment ?? false,
      block_shopping: settingsData.blockShopping ?? false,
      block_dating: settingsData.blockDating ?? false,
      custom_blocked_domains: settingsData.customBlockedDomains || [],
      custom_allowed_domains: settingsData.customAllowedDomains || [],
      enable_time_restrictions: settingsData.enableTimeRestrictions ?? false,
      allowed_hours_start: settingsData.allowedHoursStart || null,
      allowed_hours_end: settingsData.allowedHoursEnd || null,
      blocked_days: settingsData.blockedDays || [],
      enable_safe_search: settingsData.enableSafeSearch ?? true,
      block_explicit_content: settingsData.blockExplicitContent ?? true
    };
    
    let result;
    
    if (settingsExists) {
      // Update existing settings
      result = await pool.query(`
        UPDATE blocking_settings 
        SET 
          block_adult_content = $3,
          block_gambling = $4,
          block_social_media = $5,
          block_gaming = $6,
          block_news = $7,
          block_entertainment = $8,
          block_shopping = $9,
          block_dating = $10,
          custom_blocked_domains = $11,
          custom_allowed_domains = $12,
          enable_time_restrictions = $13,
          allowed_hours_start = $14,
          allowed_hours_end = $15,
          blocked_days = $16,
          enable_safe_search = $17,
          block_explicit_content = $18,
          settings_version = settings_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2)
        RETURNING *
      `, [
        userId, deviceId,
        dbData.block_adult_content, dbData.block_gambling, dbData.block_social_media,
        dbData.block_gaming, dbData.block_news, dbData.block_entertainment,
        dbData.block_shopping, dbData.block_dating, dbData.custom_blocked_domains,
        dbData.custom_allowed_domains, dbData.enable_time_restrictions,
        dbData.allowed_hours_start, dbData.allowed_hours_end, dbData.blocked_days,
        dbData.enable_safe_search, dbData.block_explicit_content
      ]);
    } else {
      // Create new settings
      result = await pool.query(`
        INSERT INTO blocking_settings (
          user_id, device_id, block_adult_content, block_gambling, block_social_media,
          block_gaming, block_news, block_entertainment, block_shopping, block_dating,
          custom_blocked_domains, custom_allowed_domains, enable_time_restrictions,
          allowed_hours_start, allowed_hours_end, blocked_days, enable_safe_search,
          block_explicit_content, settings_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 1)
        RETURNING *
      `, [
        dbData.user_id, dbData.device_id, dbData.block_adult_content, dbData.block_gambling,
        dbData.block_social_media, dbData.block_gaming, dbData.block_news,
        dbData.block_entertainment, dbData.block_shopping, dbData.block_dating,
        dbData.custom_blocked_domains, dbData.custom_allowed_domains,
        dbData.enable_time_restrictions, dbData.allowed_hours_start, dbData.allowed_hours_end,
        dbData.blocked_days, dbData.enable_safe_search, dbData.block_explicit_content
      ]);
    }
    
    console.log('✅ Blocking settings saved successfully');
    
    return {
      success: true,
      settings: result.rows[0],
      action: settingsExists ? 'updated' : 'created'
    };
    
  } catch (error) {
    console.error('❌ Failed to save blocking settings:', error.message);
    return {
      success: false,
      error: 'Failed to save blocking settings',
      message: error.message
    };
  }
};

// Check if settings are locked due to timer commitment
const checkSettingsLocked = async (userId, deviceId) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        timer_end_time,
        timer_status
      FROM timer_commitments 
      WHERE user_id = $1 
        AND (device_id = $2 OR device_id IS NULL)
        AND timer_status = 'active'
        AND timer_end_time > NOW()
      ORDER BY timer_end_time DESC
      LIMIT 1
    `, [userId, deviceId]);
    
    if (result.rows.length > 0) {
      const timer = result.rows[0];
      return {
        locked: true,
        timerId: timer.id,
        unlockTime: timer.timer_end_time,
        message: 'Settings are locked due to active timer commitment'
      };
    }
    
    return { locked: false };
    
  } catch (error) {
    console.error('❌ Failed to check settings lock:', error.message);
    return { locked: false }; // Fail open for safety
  }
};

// Get all blocking settings for user (default + device-specific)
const getAllUserBlockingSettings = async (userId) => {
  try {
    console.log('🛡️ Getting all blocking settings for user:', userId);
    
    const result = await pool.query(`
      SELECT 
        bs.*,
        dp.device_name,
        dp.device_type
      FROM blocking_settings bs
      LEFT JOIN device_profiles dp ON bs.device_id = dp.id
      WHERE bs.user_id = $1
      ORDER BY bs.device_id IS NULL DESC, dp.device_name ASC, bs.created_at DESC
    `, [userId]);
    
    const settings = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      deviceId: row.device_id,
      deviceName: row.device_name || 'Default Settings',
      deviceType: row.device_type,
      isDefault: row.device_id === null,
      
      blockAdultContent: row.block_adult_content,
      blockGambling: row.block_gambling,
      blockSocialMedia: row.block_social_media,
      blockGaming: row.block_gaming,
      blockNews: row.block_news,
      blockEntertainment: row.block_entertainment,
      blockShopping: row.block_shopping,
      blockDating: row.block_dating,
      
      customBlockedDomains: row.custom_blocked_domains || [],
      customAllowedDomains: row.custom_allowed_domains || [],
      
      enableTimeRestrictions: row.enable_time_restrictions,
      allowedHoursStart: row.allowed_hours_start,
      allowedHoursEnd: row.allowed_hours_end,
      blockedDays: row.blocked_days || [],
      
      enableSafeSearch: row.enable_safe_search,
      blockExplicitContent: row.block_explicit_content,
      
      settingsLocked: row.settings_locked,
      settingsVersion: row.settings_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    
    return {
      success: true,
      settings: settings
    };
    
  } catch (error) {
    console.error('❌ Failed to get all blocking settings:', error.message);
    return {
      success: false,
      error: 'Failed to retrieve blocking settings'
    };
  }
};

// Delete blocking settings
const deleteBlockingSettings = async (userId, deviceId) => {
  try {
    console.log('🛡️ Deleting blocking settings for user:', userId, 'device:', deviceId);
    
    // Check if settings are locked
    if (deviceId) {
      const lockCheck = await checkSettingsLocked(userId, deviceId);
      if (lockCheck.locked) {
        return {
          success: false,
          error: 'Cannot delete settings while timer is active',
          lockInfo: lockCheck
        };
      }
    }
    
    const result = await pool.query(
      'DELETE FROM blocking_settings WHERE user_id = $1 AND ($2::integer IS NULL AND device_id IS NULL OR device_id = $2) RETURNING id',
      [userId, deviceId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Blocking settings not found'
      };
    }
    
    console.log('✅ Blocking settings deleted successfully');
    
    return {
      success: true,
      message: 'Blocking settings deleted successfully'
    };
    
  } catch (error) {
    console.error('❌ Failed to delete blocking settings:', error.message);
    return {
      success: false,
      error: 'Failed to delete blocking settings'
    };
  }
};

module.exports = {
  CONTENT_CATEGORIES,
  getDefaultBlockingSettings,
  validateBlockingSettings,
  getBlockingSettings,
  saveBlockingSettings,
  checkSettingsLocked,
  getAllUserBlockingSettings,
  deleteBlockingSettings,
  validateDomain,
  validateTimeFormat
};
