const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../config/database');

const router = express.Router();

// Middleware to check if user has supervision features (premium subscription required)
const requireSupervisionAccess = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Check user's subscription status from your existing database structure
        const result = await pool.query(`
            SELECT subscription_status, subscription_plan, subscription_end_date
            FROM users 
            WHERE id = $1
        `, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        const user = result.rows[0];
        
        // Check if user has active subscription with supervision features
        // Supervision is available for 3-months, 6-months, and 1-year plans
        const hasActiveSubscription = user.subscription_status === 'active' && 
            new Date(user.subscription_end_date) > new Date();
        
        const hasSupervisionPlan = ['3-months', '6-months', '1-year'].includes(user.subscription_plan);
        
        if (!hasActiveSubscription || !hasSupervisionPlan) {
            return res.status(403).json({
                error: 'Premium subscription required',
                message: 'Supervision features require an active premium subscription (3+ months)',
                currentPlan: user.subscription_plan || 'free',
                subscriptionStatus: user.subscription_status || 'inactive'
            });
        }
        
        // Add subscription info to request for use in routes
        req.subscription = {
            status: user.subscription_status,
            plan: user.subscription_plan,
            endDate: user.subscription_end_date
        };
        
        next();
        
    } catch (error) {
        console.error('Supervision access check error:', error);
        res.status(500).json({ 
            error: 'Access verification failed',
            message: 'An error occurred while verifying subscription access'
        });
    }
};

// Get supervision status for user's devices
router.get('/status', authenticateToken, requireSupervisionAccess, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user's devices with their supervision levels
        const devicesResult = await pool.query(`
            SELECT 
                d.id,
                d.device_name,
                d.device_type,
                d.device_model,
                d.profile_installed,
                d.created_at,
                COALESCE(ds.supervision_level, 0) as supervision_level,
                ds.supervisor_email,
                ds.notification_settings,
                ds.created_at as supervision_enabled_at
            FROM devices d
            LEFT JOIN device_supervision ds ON d.id = ds.device_id
            WHERE d.user_id = $1
            ORDER BY d.created_at DESC
        `, [userId]);
        
        const devices = devicesResult.rows.map(device => ({
            id: device.id,
            deviceName: device.device_name,
            deviceType: device.device_type,
            deviceModel: device.device_model,
            profileInstalled: device.profile_installed,
            createdAt: device.created_at,
            supervisionLevel: device.supervision_level,
            supervisorEmail: device.supervisor_email,
            notificationSettings: device.notification_settings ? JSON.parse(device.notification_settings) : null,
            supervisionEnabledAt: device.supervision_enabled_at
        }));
        
        // Get supervision statistics
        const totalDevices = devices.length;
        const supervisedDevices = devices.filter(d => d.supervisionLevel > 0).length;
        const maxSupervisionLevel = Math.max(...devices.map(d => d.supervisionLevel), 0);
        
        res.json({
            message: 'Supervision status retrieved',
            subscription: req.subscription,
            devices: devices,
            summary: {
                totalDevices,
                supervisedDevices,
                unsupervisedDevices: totalDevices - supervisedDevices,
                maxSupervisionLevel,
                supervisionEnabled: supervisedDevices > 0
            }
        });
        
    } catch (error) {
        console.error('Failed to get supervision status:', error);
        res.status(500).json({
            error: 'Failed to get supervision status',
            message: 'An error occurred while retrieving supervision information'
        });
    }
});

// Enable supervision for a device
router.post('/enable', [
    authenticateToken,
    requireSupervisionAccess,
    body('deviceId').isUUID().withMessage('Valid device ID is required'),
    body('supervisionLevel').isInt({ min: 1, max: 3 }).withMessage('Supervision level must be 1, 2, or 3'),
    body('supervisorEmail').isEmail().withMessage('Valid supervisor email is required'),
    body('notificationSettings').optional().isObject().withMessage('Notification settings must be an object')
], async (req, res) => {
    try {
        // Check validation results
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        
        const userId = req.user.id;
        const { deviceId, supervisionLevel, supervisorEmail, notificationSettings } = req.body;
        
        // Verify device belongs to user
        const deviceResult = await pool.query(
            'SELECT id, device_name FROM devices WHERE id = $1 AND user_id = $2',
            [deviceId, userId]
        );
        
        if (deviceResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Device not found',
                message: 'Device not found or does not belong to you'
            });
        }
        
        const device = deviceResult.rows[0];
        
        // Check if supervision already exists
        const existingResult = await pool.query(
            'SELECT id FROM device_supervision WHERE device_id = $1',
            [deviceId]
        );
        
        if (existingResult.rows.length > 0) {
            // Update existing supervision
            await pool.query(`
                UPDATE device_supervision 
                SET 
                    supervision_level = $1,
                    supervisor_email = $2,
                    notification_settings = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE device_id = $4
            `, [
                supervisionLevel,
                supervisorEmail,
                JSON.stringify(notificationSettings || {}),
                deviceId
            ]);
            
            console.log(`✅ Updated supervision for device ${deviceId} to level ${supervisionLevel}`);
        } else {
            // Create new supervision record
            await pool.query(`
                INSERT INTO device_supervision (
                    device_id, 
                    user_id, 
                    supervision_level, 
                    supervisor_email, 
                    notification_settings,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                deviceId,
                userId,
                supervisionLevel,
                supervisorEmail,
                JSON.stringify(notificationSettings || {})
            ]);
            
            console.log(`✅ Enabled supervision for device ${deviceId} at level ${supervisionLevel}`);
        }
        
        res.json({
            message: 'Supervision enabled successfully',
            device: {
                id: deviceId,
                name: device.device_name,
                supervisionLevel,
                supervisorEmail,
                notificationSettings: notificationSettings || {}
            }
        });
        
    } catch (error) {
        console.error('Failed to enable supervision:', error);
        res.status(500).json({
            error: 'Failed to enable supervision',
            message: 'An error occurred while enabling device supervision'
        });
    }
});

// Disable supervision for a device
router.post('/disable', [
    authenticateToken,
    requireSupervisionAccess,
    body('deviceId').isUUID().withMessage('Valid device ID is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        
        const userId = req.user.id;
        const { deviceId } = req.body;
        
        // Verify device belongs to user
        const deviceResult = await pool.query(
            'SELECT id, device_name FROM devices WHERE id = $1 AND user_id = $2',
            [deviceId, userId]
        );
        
        if (deviceResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Device not found',
                message: 'Device not found or does not belong to you'
            });
        }
        
        const device = deviceResult.rows[0];
        
        // Remove supervision record
        const deleteResult = await pool.query(
            'DELETE FROM device_supervision WHERE device_id = $1 AND user_id = $2',
            [deviceId, userId]
        );
        
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({
                error: 'Supervision not found',
                message: 'No supervision configuration found for this device'
            });
        }
        
        console.log(`✅ Disabled supervision for device ${deviceId}`);
        
        res.json({
            message: 'Supervision disabled successfully',
            device: {
                id: deviceId,
                name: device.device_name
            }
        });
        
    } catch (error) {
        console.error('Failed to disable supervision:', error);
        res.status(500).json({
            error: 'Failed to disable supervision',
            message: 'An error occurred while disabling device supervision'
        });
    }
});

// Get supervision settings for a specific device
router.get('/device/:deviceId', authenticateToken, requireSupervisionAccess, async (req, res) => {
    try {
        const userId = req.user.id;
        const { deviceId } = req.params;
        
        // Verify device belongs to user and get supervision info
        const result = await pool.query(`
            SELECT 
                d.id,
                d.device_name,
                d.device_type,
                d.device_model,
                d.profile_installed,
                ds.supervision_level,
                ds.supervisor_email,
                ds.notification_settings,
                ds.created_at as supervision_enabled_at,
                ds.updated_at as supervision_updated_at
            FROM devices d
            LEFT JOIN device_supervision ds ON d.id = ds.device_id
            WHERE d.id = $1 AND d.user_id = $2
        `, [deviceId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Device not found',
                message: 'Device not found or does not belong to you'
            });
        }
        
        const device = result.rows[0];
        
        res.json({
            message: 'Device supervision settings retrieved',
            device: {
                id: device.id,
                deviceName: device.device_name,
                deviceType: device.device_type,
                deviceModel: device.device_model,
                profileInstalled: device.profile_installed,
                supervision: device.supervision_level ? {
                    level: device.supervision_level,
                    supervisorEmail: device.supervisor_email,
                    notificationSettings: device.notification_settings ? JSON.parse(device.notification_settings) : {},
                    enabledAt: device.supervision_enabled_at,
                    updatedAt: device.supervision_updated_at
                } : null
            }
        });
        
    } catch (error) {
        console.error('Failed to get device supervision settings:', error);
        res.status(500).json({
            error: 'Failed to get device supervision settings',
            message: 'An error occurred while retrieving device supervision information'
        });
    }
});

// Get supervision features available based on subscription
router.get('/features', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user's subscription info
        const result = await pool.query(`
            SELECT subscription_status, subscription_plan, subscription_end_date
            FROM users 
            WHERE id = $1
        `, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        const user = result.rows[0];
        const hasActiveSubscription = user.subscription_status === 'active' && 
            new Date(user.subscription_end_date) > new Date();
        
        // Define supervision features by plan
        const features = {
            supervision: {
                enabled: false,
                maxLevel: 0,
                maxDevices: 0,
                notificationTypes: []
            }
        };
        
        if (hasActiveSubscription) {
            switch (user.subscription_plan) {
                case '1-month':
                    features.supervision = {
                        enabled: true,
                        maxLevel: 1,
                        maxDevices: 3,
                        notificationTypes: ['email']
                    };
                    break;
                    
                case '3-months':
                    features.supervision = {
                        enabled: true,
                        maxLevel: 2,
                        maxDevices: 5,
                        notificationTypes: ['email', 'sms']
                    };
                    break;
                    
                case '6-months':
                case '1-year':
                    features.supervision = {
                        enabled: true,
                        maxLevel: 3,
                        maxDevices: 10,
                        notificationTypes: ['email', 'sms', 'push']
                    };
                    break;
            }
        }
        
        res.json({
            message: 'Supervision features retrieved',
            subscription: {
                status: user.subscription_status || 'inactive',
                plan: user.subscription_plan || 'free',
                endDate: user.subscription_end_date
            },
            ...features
        });
        
    } catch (error) {
        console.error('Failed to get supervision features:', error);
        res.status(500).json({
            error: 'Failed to get supervision features',
            message: 'An error occurred while retrieving supervision features'
        });
    }
});

// Test endpoint for development
router.get('/test', authenticateToken, async (req, res) => {
    res.json({
        message: 'Supervision routes are working',
        user: {
            id: req.user.id,
            email: req.user.email
        },
        endpoints: {
            status: 'GET /api/supervision/status - Get supervision status for all devices',
            enable: 'POST /api/supervision/enable - Enable supervision for a device',
            disable: 'POST /api/supervision/disable - Disable supervision for a device',
            device: 'GET /api/supervision/device/:deviceId - Get supervision settings for specific device',
            features: 'GET /api/supervision/features - Get available supervision features'
        },
        requiredFields: {
            enable: {
                deviceId: 'UUID of the device',
                supervisionLevel: 'Integer 1-3',
                supervisorEmail: 'Email address of supervisor',
                notificationSettings: 'Optional object with notification preferences'
            },
            disable: {
                deviceId: 'UUID of the device'
            }
        }
    });
});

module.exports = router;
