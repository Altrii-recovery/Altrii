const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Content categories with descriptions
const CONTENT_CATEGORIES = [
  {
    key: 'adult',
    name: 'Adult Content',
    description: 'Block pornography, explicit content, and adult websites',
    defaultEnabled: true
  },
  {
    key: 'gambling',
    name: 'Gambling',
    description: 'Block gambling sites, casinos, and betting platforms',
    defaultEnabled: true
  },
  {
    key: 'social',
    name: 'Social Media',
    description: 'Block Facebook, Instagram, Twitter, TikTok, and other social platforms',
    defaultEnabled: false
  },
  {
    key: 'gaming',
    name: 'Gaming',
    description: 'Block gaming websites, online games, and gaming platforms',
    defaultEnabled: false
  },
  {
    key: 'news',
    name: 'News',
    description: 'Block news websites and current events platforms',
    defaultEnabled: false
  },
  {
    key: 'entertainment',
    name: 'Entertainment',
    description: 'Block streaming services, video platforms, and entertainment sites',
    defaultEnabled: false
  },
  {
    key: 'shopping',
    name: 'Shopping',
    description: 'Block e-commerce sites and online shopping platforms',
    defaultEnabled: false
  },
  {
    key: 'dating',
    name: 'Dating',
    description: 'Block dating apps and relationship websites',
    defaultEnabled: false
  }
];

// Get content categories
router.get('/categories', (req, res) => {
  res.json({
    categories: CONTENT_CATEGORIES,
    total: CONTENT_CATEGORIES.length
  });
});

// Get user's blocking settings - FIXED to match database schema
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Getting blocking settings for user:', req.user.userId || req.user.id);
    
    const userId = req.user.userId || req.user.id;
    
    if (!userId) {
      console.error('❌ No valid user ID found in GET request');
      return res.status(401).json({ 
        error: 'Invalid user authentication',
        debug: { reqUser: req.user }
      });
    }

    const result = await pool.query(
      `SELECT 
        device_id, 
        block_adult_content, block_gambling, block_social_media, block_gaming, 
        block_news, block_entertainment, block_shopping, block_dating,
        custom_blocked_domains, custom_allowed_domains, 
        enable_time_restrictions, allowed_hours_start, allowed_hours_end, blocked_days,
        enable_safe_search, block_explicit_content, 
        created_at, updated_at
       FROM blocking_settings 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      console.log('📝 No existing settings found, returning defaults');
      // Return default settings if none exist
      return res.json({
        settings: {
          categories: ['adult', 'gambling'], // Default enabled categories
          customBlockedDomains: [],
          customAllowedDomains: [],
          timeRestrictions: null,
          enabled: true
        }
      });
    }

    const settings = result.rows[0];

    // Convert boolean columns back to categories array
    const categories = [];
    if (settings.block_adult_content) categories.push('adult');
    if (settings.block_gambling) categories.push('gambling');
    if (settings.block_social_media) categories.push('social');
    if (settings.block_gaming) categories.push('gaming');
    if (settings.block_news) categories.push('news');
    if (settings.block_entertainment) categories.push('entertainment');
    if (settings.block_shopping) categories.push('shopping');
    if (settings.block_dating) categories.push('dating');

    console.log('✅ Found existing settings for user');

    res.json({
      settings: {
        deviceId: settings.device_id,
        categories: categories,
        customBlockedDomains: settings.custom_blocked_domains || [],
        customAllowedDomains: settings.custom_allowed_domains || [],
        timeRestrictions: settings.enable_time_restrictions ? {
          enabled: settings.enable_time_restrictions,
          allowedHoursStart: settings.allowed_hours_start,
          allowedHoursEnd: settings.allowed_hours_end,
          blockedDays: settings.blocked_days || []
        } : null,
        enabled: !settings.settings_locked, // Use settings_locked as enabled inverse
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });
  } catch (error) {
    console.error('❌ Get blocking settings error:', error);
    res.status(500).json({ 
      error: 'Failed to get blocking settings',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Save blocking settings - FIXED to match database schema
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('🔧 === BLOCKING SETTINGS SAVE DEBUG ===');
    console.log('👤 req.user:', req.user);
    console.log('📝 req.body:', JSON.stringify(req.body, null, 2));

    const { 
      categories = [], 
      customBlockedDomains = [], 
      customAllowedDomains = [],
      timeRestrictions = null,
      deviceId = null,
      enabled = true
    } = req.body;

    // Fix: Use the correct user ID field
    const userId = req.user.userId || req.user.id;
    
    if (!userId) {
      console.error('❌ No valid user ID found');
      return res.status(401).json({ 
        error: 'Invalid user authentication',
        debug: { reqUser: req.user }
      });
    }

    console.log('✅ Using userId:', userId);

    // Check timer with correct field name for your database
    console.log('🔍 Checking for active timer...');
    const timerCheck = await pool.query(
      `SELECT id, end_time 
       FROM timer_commitments 
       WHERE user_id = $1 
         AND status = $2 
         AND end_time > NOW()`,
      [userId, 'active']
    );

    console.log('⏰ Timer check result:', timerCheck.rows.length, 'active timers');

    if (timerCheck.rows.length > 0) {
      const timer = timerCheck.rows[0];
      const timeRemaining = Math.ceil((new Date(timer.end_time) - new Date()) / 1000 / 60 / 60);
      
      console.log('❌ Settings locked by active timer');
      return res.status(400).json({ 
        error: 'Settings are locked while timer is active',
        details: `Timer has ${timeRemaining} hours remaining. Use emergency unlock if needed.`,
        lockInfo: {
          timerId: timer.id,
          unlockTime: timer.end_time,
          timeRemaining: timeRemaining
        }
      });
    }

    console.log('✅ No active timer found, proceeding with save');

    // Validate categories
    const validCategories = CONTENT_CATEGORIES.map(c => c.key);
    const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
    
    if (invalidCategories.length > 0) {
      console.log('❌ Invalid categories:', invalidCategories);
      return res.status(400).json({ 
        error: `Invalid categories: ${invalidCategories.join(', ')}`,
        validCategories: validCategories
      });
    }

    // Convert categories array to boolean columns
    const categoryBooleans = {
      block_adult_content: categories.includes('adult'),
      block_gambling: categories.includes('gambling'),
      block_social_media: categories.includes('social'),
      block_gaming: categories.includes('gaming'),
      block_news: categories.includes('news'),
      block_entertainment: categories.includes('entertainment'),
      block_shopping: categories.includes('shopping'),
      block_dating: categories.includes('dating')
    };

    console.log('📝 Category booleans:', categoryBooleans);

    // Validate domains (basic validation)
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$/;
    
    const invalidBlockedDomains = customBlockedDomains.filter(domain => 
      domain && !domainRegex.test(domain)
    );
    
    const invalidAllowedDomains = customAllowedDomains.filter(domain => 
      domain && !domainRegex.test(domain)
    );

    if (invalidBlockedDomains.length > 0) {
      console.log('❌ Invalid blocked domains:', invalidBlockedDomains);
      return res.status(400).json({ 
        error: `Invalid blocked domains: ${invalidBlockedDomains.join(', ')}` 
      });
    }

    if (invalidAllowedDomains.length > 0) {
      console.log('❌ Invalid allowed domains:', invalidAllowedDomains);
      return res.status(400).json({ 
        error: `Invalid allowed domains: ${invalidAllowedDomains.join(', ')}` 
      });
    }

    console.log('✅ All validation passed');

    // Check if settings already exist
    console.log('🔍 Checking for existing settings...');
    const existingSettings = await pool.query(
      'SELECT id FROM blocking_settings WHERE user_id = $1',
      [userId]
    );

    console.log('📊 Existing settings check:', existingSettings.rows.length, 'records found');

    let result;

    if (existingSettings.rows.length > 0) {
      // Update existing settings
      console.log('🔄 Updating existing settings...');
      result = await pool.query(
        `UPDATE blocking_settings 
         SET 
           device_id = $1,
           block_adult_content = $2,
           block_gambling = $3,
           block_social_media = $4,
           block_gaming = $5,
           block_news = $6,
           block_entertainment = $7,
           block_shopping = $8,
           block_dating = $9,
           custom_blocked_domains = $10,
           custom_allowed_domains = $11,
           enable_time_restrictions = $12,
           allowed_hours_start = $13,
           allowed_hours_end = $14,
           blocked_days = $15,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $16
         RETURNING id, created_at, updated_at`,
        [
          deviceId,
          categoryBooleans.block_adult_content,
          categoryBooleans.block_gambling,
          categoryBooleans.block_social_media,
          categoryBooleans.block_gaming,
          categoryBooleans.block_news,
          categoryBooleans.block_entertainment,
          categoryBooleans.block_shopping,
          categoryBooleans.block_dating,
          customBlockedDomains,
          customAllowedDomains,
          timeRestrictions?.enabled || false,
          timeRestrictions?.allowedHoursStart || null,
          timeRestrictions?.allowedHoursEnd || null,
          timeRestrictions?.blockedDays || [],
          userId
        ]
      );
      console.log('✅ Settings updated successfully');
    } else {
      // Create new settings
      console.log('🆕 Creating new settings...');
      result = await pool.query(
        `INSERT INTO blocking_settings 
         (user_id, device_id, 
          block_adult_content, block_gambling, block_social_media, block_gaming,
          block_news, block_entertainment, block_shopping, block_dating,
          custom_blocked_domains, custom_allowed_domains,
          enable_time_restrictions, allowed_hours_start, allowed_hours_end, blocked_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id, created_at, updated_at`,
        [
          userId,
          deviceId,
          categoryBooleans.block_adult_content,
          categoryBooleans.block_gambling,
          categoryBooleans.block_social_media,
          categoryBooleans.block_gaming,
          categoryBooleans.block_news,
          categoryBooleans.block_entertainment,
          categoryBooleans.block_shopping,
          categoryBooleans.block_dating,
          customBlockedDomains,
          customAllowedDomains,
          timeRestrictions?.enabled || false,
          timeRestrictions?.allowedHoursStart || null,
          timeRestrictions?.allowedHoursEnd || null,
          timeRestrictions?.blockedDays || []
        ]
      );
      console.log('✅ Settings created successfully');
    }

    const responseData = {
      success: true,
      settings: {
        id: result.rows[0].id,
        categories,
        customBlockedDomains,
        customAllowedDomains,
        timeRestrictions,
        enabled,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      }
    };

    console.log('📤 Sending success response');
    console.log('🏁 === BLOCKING SETTINGS SAVE END ===');

    res.json(responseData);

  } catch (error) {
    console.error('💥 === DETAILED BLOCKING SETTINGS ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Full error stack:', error.stack);
    console.error('req.user:', req.user);
    console.error('req.body:', req.body);
    
    res.status(500).json({ 
      error: 'Failed to save blocking settings',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code
      } : undefined
    });
  }
});

// Get settings for specific device
router.get('/device/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid user authentication' });
    }

    // Verify device ownership
    const deviceCheck = await pool.query(
      'SELECT id FROM device_profiles WHERE id = $1 AND user_id = $2',
      [deviceId, userId]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await pool.query(
      `SELECT 
        block_adult_content, block_gambling, block_social_media, block_gaming,
        block_news, block_entertainment, block_shopping, block_dating,
        custom_blocked_domains, custom_allowed_domains,
        enable_time_restrictions, allowed_hours_start, allowed_hours_end, blocked_days,
        updated_at
       FROM blocking_settings 
       WHERE user_id = $1 AND (device_id = $2 OR device_id IS NULL)
       ORDER BY device_id DESC LIMIT 1`,
      [userId, deviceId]
    );

    if (result.rows.length === 0) {
      return res.json({
        settings: {
          categories: ['adult', 'gambling'],
          customBlockedDomains: [],
          customAllowedDomains: [],
          timeRestrictions: null,
          enabled: true
        }
      });
    }

    const settings = result.rows[0];

    // Convert boolean columns back to categories array
    const categories = [];
    if (settings.block_adult_content) categories.push('adult');
    if (settings.block_gambling) categories.push('gambling');
    if (settings.block_social_media) categories.push('social');
    if (settings.block_gaming) categories.push('gaming');
    if (settings.block_news) categories.push('news');
    if (settings.block_entertainment) categories.push('entertainment');
    if (settings.block_shopping) categories.push('shopping');
    if (settings.block_dating) categories.push('dating');

    res.json({
      settings: {
        categories: categories,
        customBlockedDomains: settings.custom_blocked_domains || [],
        customAllowedDomains: settings.custom_allowed_domains || [],
        timeRestrictions: settings.enable_time_restrictions ? {
          enabled: settings.enable_time_restrictions,
          allowedHoursStart: settings.allowed_hours_start,
          allowedHoursEnd: settings.allowed_hours_end,
          blockedDays: settings.blocked_days || []
        } : null,
        enabled: true,
        updatedAt: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Get device settings error:', error);
    res.status(500).json({ 
      error: 'Failed to get device settings',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete blocking settings
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid user authentication' });
    }

    // Check if settings are locked by active timer
    const timerCheck = await pool.query(
      `SELECT id FROM timer_commitments 
       WHERE user_id = $1 
         AND status = $2 
         AND end_time > NOW()`,
      [userId, 'active']
    );

    if (timerCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Settings are locked while timer is active' 
      });
    }

    const result = await pool.query(
      'DELETE FROM blocking_settings WHERE user_id = $1 RETURNING id',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No settings found to delete' });
    }

    res.json({
      success: true,
      message: 'Blocking settings deleted successfully'
    });
  } catch (error) {
    console.error('Delete blocking settings error:', error);
    res.status(500).json({ 
      error: 'Failed to delete blocking settings',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Test endpoint for debugging
router.get('/test/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid user authentication' });
    }

    const settingsCount = await pool.query(
      'SELECT COUNT(*) as count FROM blocking_settings WHERE user_id = $1',
      [userId]
    );

    res.json({
      message: 'Blocking system overview',
      userId: userId,
      userIdSource: req.user.userId ? 'userId' : 'id',
      totalCategories: CONTENT_CATEGORIES.length,
      availableCategories: CONTENT_CATEGORIES.map(c => c.key),
      userSettingsCount: parseInt(settingsCount.rows[0].count),
      endpoints: {
        getCategories: 'GET /api/blocking/categories',
        getSettings: 'GET /api/blocking',
        saveSettings: 'POST /api/blocking',
        getDeviceSettings: 'GET /api/blocking/device/:deviceId'
      },
      debug: {
        reqUser: req.user,
        databaseConnected: true
      }
    });
  } catch (error) {
    console.error('Blocking overview error:', error);
    res.status(500).json({ 
      error: 'Failed to get blocking overview',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code
      } : undefined
    });
  }
});

module.exports = router;
