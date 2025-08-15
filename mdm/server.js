// mdm/server.js - Complete Altrii Recovery MDM Server
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const forge = require('node-forge');
const plist = require('plist');
const apn = require('apn');
const { pool } = require('../config/database');

class AltriiMDMServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.deviceSessions = new Map();
    this.pendingCommands = new Map();
    this.enrollmentCodes = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.initializeAPNS();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.raw({ type: 'application/x-apple-aspen-mdm' }));
    this.app.use(express.raw({ type: 'application/x-apple-aspen-mdm-checkin' }));
    
    // MDM-specific headers
    this.app.use((req, res, next) => {
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block'
      });
      next();
    });

    // Internal API authentication
    this.app.use((req, res, next) => {
      const apiKey = req.headers['x-api-key'];
      if (apiKey && apiKey === this.config.apiKey) {
        next();
      } else if (req.path.startsWith('/mdm/checkin/') || req.path.startsWith('/mdm/server/')) {
        // MDM protocol endpoints don't need API key
        next();
      } else {
        res.status(401).json({ error: 'Invalid API key' });
      }
    });
  }

  setupRoutes() {
    // MDM Check-in endpoint
    this.app.put('/mdm/checkin/:deviceId', this.handleCheckIn.bind(this));
    
    // MDM Command endpoint
    this.app.put('/mdm/server/:deviceId', this.handleCommand.bind(this));
    
    // Enrollment endpoints
    this.app.post('/mdm/enroll', this.handleEnrollment.bind(this));
    this.app.get('/mdm/enroll/:code', this.getEnrollmentProfile.bind(this));
    
    // Profile endpoints
    this.app.post('/mdm/profiles/generate', this.generateSupervisionProfile.bind(this));
    this.app.get('/mdm/profiles/:profileId', this.getProfile.bind(this));
    
    // Device management
    this.app.get('/mdm/devices/:deviceId/status', this.getDeviceStatus.bind(this));
    this.app.post('/mdm/devices/:deviceId/command', this.sendCommand.bind(this));
    this.app.post('/mdm/devices/:deviceId/verify', this.verifyDevice.bind(this));
    
    // Health check
    this.app.get('/mdm/health', (req, res) => {
      res.json({
        status: 'healthy',
        activeDevices: this.deviceSessions.size,
        pendingCommands: this.pendingCommands.size,
        uptime: process.uptime()
      });
    });
  }

  async initializeAPNS() {
    if (!this.config.apns) {
      console.warn('APNS not configured - push notifications disabled');
      return;
    }

    try {
      this.apnProvider = new apn.Provider({
        token: {
          key: this.config.apns.key,
          keyId: this.config.apns.keyId,
          teamId: this.config.apns.teamId
        },
        production: this.config.production || false
      });
      
      console.log('APNS initialized successfully');
    } catch (error) {
      console.error('APNS initialization failed:', error);
    }
  }

  // MDM Check-in Handler
  async handleCheckIn(req, res) {
    const { deviceId } = req.params;
    
    try {
      const checkInData = plist.parse(req.body);
      console.log(`Check-in from device: ${deviceId}`, checkInData.MessageType);

      switch (checkInData.MessageType) {
        case 'Authenticate':
          return this.handleAuthenticate(deviceId, checkInData, res);
        
        case 'TokenUpdate':
          return this.handleTokenUpdate(deviceId, checkInData, res);
        
        case 'CheckOut':
          return this.handleCheckOut(deviceId, checkInData, res);
        
        default:
          console.warn(`Unknown check-in type: ${checkInData.MessageType}`);
          res.status(400).send();
      }
    } catch (error) {
      console.error('Check-in error:', error);
      res.status(500).send();
    }
  }

  async handleAuthenticate(deviceId, data, res) {
    try {
      // Get device from database using profile UUID
      const device = await db.query(
        'SELECT * FROM device_profiles WHERE profile_uuid = $1',
        [deviceId]
      );
      
      if (device.rows.length === 0) {
        console.error(`Unknown device: ${deviceId}`);
        return res.status(401).send();
      }

      const deviceRecord = device.rows[0];

      // Create or update device session
      const sessionExists = await db.query(
        'SELECT id FROM mdm_device_sessions WHERE device_id = $1',
        [deviceRecord.id]
      );

      if (sessionExists.rows.length > 0) {
        await db.query(`
          UPDATE mdm_device_sessions 
          SET udid = $1, serial_number = $2, model = $3, os_version = $4, 
              build_version = $5, supervised = $6, last_check_in = NOW()
          WHERE device_id = $7
        `, [
          data.UDID,
          data.SerialNumber,
          data.Model,
          data.OSVersion,
          data.BuildVersion,
          data.IsSupervised || false,
          deviceRecord.id
        ]);
      } else {
        await db.query(`
          INSERT INTO mdm_device_sessions 
          (device_id, udid, serial_number, model, os_version, build_version, supervised)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          deviceRecord.id,
          data.UDID,
          data.SerialNumber,
          data.Model,
          data.OSVersion,
          data.BuildVersion,
          data.IsSupervised || false
        ]);
      }

      // Store in memory for quick access
      this.deviceSessions.set(deviceId, {
        deviceId: deviceRecord.id,
        udid: data.UDID,
        serialNumber: data.SerialNumber,
        model: data.Model,
        osVersion: data.OSVersion,
        buildVersion: data.BuildVersion,
        lastCheckIn: new Date(),
        supervised: data.IsSupervised || false
      });

      // Log successful authentication
      await this.logDeviceEvent(deviceRecord.id, 'authenticated', {
        supervised: data.IsSupervised,
        osVersion: data.OSVersion
      });

      res.status(200).send();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(500).send();
    }
  }

  async handleTokenUpdate(deviceId, data, res) {
    const session = this.deviceSessions.get(deviceId);
    
    if (!session) {
      return res.status(401).send();
    }

    try {
      // Update push token and magic
      session.pushToken = data.Token;
      session.pushMagic = data.PushMagic;
      session.unlockToken = data.UnlockToken;
      
      // Store in database
      await db.query(`
        UPDATE mdm_device_sessions
        SET push_token = $1, push_magic = $2, unlock_token = $3, last_check_in = NOW()
        WHERE device_id = $4
      `, [
        data.Token.toString('base64'),
        data.PushMagic,
        data.UnlockToken?.toString('base64'),
        session.deviceId
      ]);

      // Check for pending commands
      const commands = await this.getPendingCommands(deviceId);
      
      if (commands.length > 0) {
        // Send push notification to wake device
        await this.sendPushNotification(deviceId, session.pushToken, session.pushMagic);
      }

      res.status(200).send();
    } catch (error) {
      console.error('Token update error:', error);
      res.status(500).send();
    }
  }

  async handleCheckOut(deviceId, data, res) {
    const session = this.deviceSessions.get(deviceId);
    if (!session) {
      return res.status(200).send();
    }

    try {
      // Device is un-enrolling
      this.deviceSessions.delete(deviceId);
      
      // Update database
      await db.query(`
        UPDATE device_profiles 
        SET mdm_enrolled = false, supervision_level = 0
        WHERE id = $1
      `, [session.deviceId]);

      await db.query(
        'DELETE FROM mdm_device_sessions WHERE device_id = $1',
        [session.deviceId]
      );
      
      await this.logDeviceEvent(session.deviceId, 'unenrolled', {
        reason: data.Reason || 'User initiated'
      });

      res.status(200).send();
    } catch (error) {
      console.error('Check-out error:', error);
      res.status(500).send();
    }
  }

  // MDM Command Handler
  async handleCommand(req, res) {
    const { deviceId } = req.params;
    
    try {
      const commandResponse = plist.parse(req.body);
      console.log(`Command response from device: ${deviceId}`, commandResponse.Status);

      // Process command response
      await this.processCommandResponse(deviceId, commandResponse);

      // Get next command if any
      const nextCommand = await this.getNextCommand(deviceId);
      
      if (nextCommand) {
        const plistCommand = plist.build(nextCommand);
        res.set('Content-Type', 'application/x-apple-aspen-mdm');
        res.send(plistCommand);
      } else {
        res.status(200).send();
      }
    } catch (error) {
      console.error('Command handling error:', error);
      res.status(500).send();
    }
  }

  async processCommandResponse(deviceId, response) {
    const commandUUID = response.CommandUUID;
    const session = this.deviceSessions.get(deviceId);
    
    if (!session) {
      console.error('No session for device:', deviceId);
      return;
    }

    try {
      // Update command status in database
      await db.query(`
        UPDATE mdm_commands
        SET status = $1, acknowledged_at = NOW(), response_data = $2
        WHERE command_uuid = $3
      `, [
        response.Status === 'Acknowledged' ? 'completed' : 'failed',
        JSON.stringify(response),
        commandUUID
      ]);

      // Log command response
      await this.logDeviceEvent(session.deviceId, 'command_response', {
        commandUUID,
        status: response.Status,
        data: response
      });

      // Handle specific command types
      if (response.Status === 'Acknowledged') {
        switch (response.RequestType) {
          case 'ProfileList':
            await this.processProfileList(session.deviceId, response.ProfileList);
            break;
          
          case 'SecurityInfo':
            await this.processSecurityInfo(session.deviceId, response.SecurityInfo);
            break;
          
          case 'InstalledApplicationList':
            await this.processAppList(session.deviceId, response.InstalledApplicationList);
            break;
          
          case 'Restrictions':
            await this.processRestrictions(session.deviceId, response.Restrictions);
            break;
        }
      }

      // Remove processed command from pending list
      const deviceCommands = this.pendingCommands.get(deviceId) || [];
      const updatedCommands = deviceCommands.filter(cmd => cmd.CommandUUID !== commandUUID);
      this.pendingCommands.set(deviceId, updatedCommands);
      
    } catch (error) {
      console.error('Process command response error:', error);
    }
  }

  // Supervision Profile Generation
  async generateSupervisionProfile(req, res) {
    try {
      const { deviceId, userId, settings, securityLevel, isWebOnly } = req.body;
      
      // Generate unique identifiers
      const profileUUID = uuidv4();
      const enrollmentCode = this.generateEnrollmentCode();
      
      // Get device info
      const device = await db.query(
        'SELECT * FROM device_profiles WHERE profile_uuid = $1',
        [deviceId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      // Build supervision profile
      const profile = await this.buildSupervisionProfile({
        deviceId,
        profileUUID,
        settings,
        securityLevel,
        isWebOnly: isWebOnly || true, // Default to web-only
        deviceRecord: device.rows[0]
      });

      // Sign profile (if certificates available)
      const signedProfile = await this.signProfile(profile);
      
      // Store enrollment code mapping
      this.enrollmentCodes.set(enrollmentCode, {
        profileData: signedProfile,
        deviceId,
        userId,
        profileUUID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });

      // Store profile in database
      await db.query(`
        INSERT INTO supervision_profiles
        (device_id, profile_uuid, profile_identifier, display_name, security_level, profile_data)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (device_id, profile_identifier) 
        DO UPDATE SET profile_uuid = $2, security_level = $5, profile_data = $6
      `, [
        device.rows[0].id,
        profileUUID,
        `com.altriirecovery.supervision.${deviceId}`,
        'Altrii Recovery - Maximum Protection',
        securityLevel,
        signedProfile.toString('base64')
      ]);

      res.json({
        enrollmentCode,
        profileUUID,
        downloadUrl: `/mdm/enroll/${enrollmentCode}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

    } catch (error) {
      console.error('Profile generation error:', error);
      res.status(500).json({ error: 'Failed to generate supervision profile' });
    }
  }

  async buildSupervisionProfile(options) {
    const { deviceId, profileUUID, settings, securityLevel, isWebOnly, deviceRecord } = options;
    
    const profile = {
      PayloadType: 'Configuration',
      PayloadVersion: 1,
      PayloadIdentifier: `com.altriirecovery.supervision.${deviceId}`,
      PayloadUUID: profileUUID,
      PayloadDisplayName: 'Altrii Recovery - Maximum Protection',
      PayloadDescription: 'Device supervision for enhanced digital wellness protection',
      PayloadOrganization: 'Altrii Recovery',
      PayloadRemovalDisallowed: securityLevel >= 3,
      
      PayloadContent: []
    };

    // Add MDM payload
    profile.PayloadContent.push(this.buildMDMPayload(deviceId, deviceRecord));
    
    // Add content filter payload
    profile.PayloadContent.push(await this.buildContentFilterPayload(deviceId, settings, isWebOnly));
    
    // Add restrictions payload (for Level 2+)
    if (securityLevel >= 2) {
      profile.PayloadContent.push(this.buildRestrictionsPayload(deviceId, settings, securityLevel));
    }
    
    // Add security payload
    if (securityLevel >= 2) {
      profile.PayloadContent.push(this.buildSecurityPayload(deviceId, securityLevel));
    }

    return profile;
  }

  buildMDMPayload(deviceId, deviceRecord) {
    return {
      PayloadType: 'com.apple.mdm',
      PayloadIdentifier: `com.altriirecovery.mdm.${deviceId}`,
      PayloadUUID: uuidv4(),
      PayloadVersion: 1,
      PayloadDisplayName: 'Altrii Recovery MDM',
      
      ServerURL: `${this.config.serverUrl}/mdm/server/${deviceId}`,
      CheckInURL: `${this.config.serverUrl}/mdm/checkin/${deviceId}`,
      Topic: this.config.mdmTopic || 'com.altriirecovery.mdm',
      
      // Server capabilities
      ServerCapabilities: [
        'com.apple.mdm.per-app-vpn',
        'com.apple.mdm.device-lock',
        'com.apple.mdm.restriction-queries'
      ],
      
      // Access rights (8191 = all rights)
      AccessRights: 8191,
      
      // Check-in frequency (minutes)
      CheckInFrequency: 15,
      
      // Use development APNS if not production
      UseDevelopmentAPNS: !this.config.production
    };
  }

  async buildContentFilterPayload(deviceId, settings, isWebOnly) {
    const blockedDomains = await this.compileBlockedDomains(settings);
    
    return {
      PayloadType: 'com.apple.webcontent-filter',
      PayloadIdentifier: `com.altriirecovery.contentfilter.${deviceId}`,
      PayloadUUID: uuidv4(),
      PayloadVersion: 1,
      PayloadDisplayName: 'Altrii Recovery Content Filter',
      
      FilterType: 'BuiltIn',
      AutoFilterEnabled: true,
      FilterBrowsers: true,
      FilterSockets: true,
      
      // Blocked URLs
      BlacklistedURLs: blockedDomains,
      
      // Allowed URLs - CRITICAL: Always allow Altrii Recovery
      WhitelistedURLs: [
        'altriirecovery.com',
        'www.altriirecovery.com',
        'app.altriirecovery.com',
        'api.altriirecovery.com',
        ...(settings.customAllowedDomains || [])
      ],
      
      // For web-only, ensure Safari restrictions are strict
      ...(isWebOnly && {
        // These ensure the web filter can't be bypassed
        FilterDataProviderBundleIdentifier: 'com.apple.Safari',
        FilterPackets: true,
        FilterGrade: 'firewall'
      }),
      
      // Permitted URLs (supervision only - baseline allowed sites)
      PermittedURLs: await this.getBaselinePermittedURLs()
    };
  }

  buildRestrictionsPayload(deviceId, settings, securityLevel) {
    const baseRestrictions = {
      PayloadType: 'com.apple.applicationaccess',
      PayloadIdentifier: `com.altriirecovery.restrictions.${deviceId}`,
      PayloadUUID: uuidv4(),
      PayloadVersion: 1,
      PayloadDisplayName: 'Altrii Recovery Restrictions'
    };

    // Level 2 restrictions
    if (securityLevel === 2) {
      return {
        ...baseRestrictions,
        
        // Allow app installation but block specific apps
        allowAppInstallation: true,
        allowUIAppInstallation: true,
        allowAppRemoval: false,
        allowInAppPurchases: false,
        
        // Block VPN creation
        allowVPNCreation: false,
        
        // Block specific bypass apps
        blacklistedAppBundleIDs: [
          'com.opera.OperaMini',
          'com.opera.Opera-Touch',
          'org.torproject.ios',
          'com.tunnelbear.ios.TunnelBear',
          'com.nordvpn.ios',
          'com.expressvpn.ExpressVPN',
          'com.protonvpn.ios',
          'com.cloudflare.onedotonedotonedotone',
          ...(settings.additionalBlockedApps || [])
        ]
      };
    }

    // Level 3 restrictions (maximum)
    if (securityLevel >= 3) {
      return {
        ...baseRestrictions,
        
        // Complete app lockdown
        allowAppInstallation: false,
        allowUIAppInstallation: false,
        allowAppClips: false,
        allowAutomaticAppDownloads: false,
        allowInAppPurchases: false,
        allowAppRemoval: false,
        
        // System restrictions
        allowEraseContentAndSettings: false,
        allowUIConfigurationProfileInstallation: false,
        allowVPNCreation: false,
        allowPasscodeModification: false,
        
        // Safari restrictions
        safariAllowJavaScript: settings.allowJavaScript !== false,
        safariAllowPopups: false,
        safariAllowAutoFill: false,
        safariForceFraudWarning: true,
        
        // Block ALL third-party browsers and bypass apps
        blacklistedAppBundleIDs: [
          'com.opera.OperaMini',
          'com.opera.Opera-Touch',
          'org.torproject.ios',
          'com.tunnelbear.ios.TunnelBear',
          'com.nordvpn.ios',
          'com.expressvpn.ExpressVPN',
          'com.protonvpn.ios',
          'com.cloudflare.onedotonedotonedotone',
          'com.brave.ios.browser',
          'com.mozilla.ios.Firefox',
          'com.mozilla.ios.Focus',
          'com.google.chrome.ios',
          'com.microsoft.msedge',
          'com.duckduckgo.mobile.ios',
          'com.alohabrowser.alohabrowser',
          ...(settings.additionalBlockedApps || [])
        ]
      };
    }

    return baseRestrictions;
  }

  buildSecurityPayload(deviceId, securityLevel) {
    const payload = {
      PayloadType: 'com.apple.security',
      PayloadIdentifier: `com.altriirecovery.security.${deviceId}`,
      PayloadUUID: uuidv4(),
      PayloadVersion: 1,
      PayloadDisplayName: 'Altrii Recovery Security'
    };

    if (securityLevel >= 2) {
      Object.assign(payload, {
        // Passcode requirements
        requireAlphanumeric: true,
        minLength: 6,
        maxFailedAttempts: 10,
        maxInactivity: 300, // 5 minutes
        maxPINAgeInDays: 90,
        
        // Additional security
        allowSimple: false,
        forcePIN: true
      });
    }

    if (securityLevel >= 3) {
      Object.assign(payload, {
        // Enhanced security for Level 3
        requireComplexPasscode: true,
        minComplexChars: 2,
        maxFailedAttempts: 5,
        allowPasscodeModification: false,
        allowFingerprintForUnlock: true,
        allowAutoUnlock: false
      });
    }

    return payload;
  }

  // Send command to device
  async sendCommand(req, res) {
    const { deviceId } = req.params;
    const { commandType, parameters } = req.body;
    
    try {
      const command = this.buildCommand(commandType, parameters);
      
      // Store in database
      const device = await db.query(
        'SELECT id FROM device_profiles WHERE profile_uuid = $1',
        [deviceId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      await db.query(`
        INSERT INTO mdm_commands
        (device_id, command_uuid, command_type, command_data, status)
        VALUES ($1, $2, $3, $4, 'pending')
      `, [
        device.rows[0].id,
        command.CommandUUID,
        commandType,
        JSON.stringify(command)
      ]);
      
      // Add to pending commands
      const deviceCommands = this.pendingCommands.get(deviceId) || [];
      deviceCommands.push(command);
      this.pendingCommands.set(deviceId, deviceCommands);
      
      // Send push notification to wake device
      const session = this.deviceSessions.get(deviceId);
      if (session && session.pushToken) {
        await this.sendPushNotification(deviceId, session.pushToken, session.pushMagic);
      }
      
      res.json({
        commandUUID: command.CommandUUID,
        status: 'pending'
      });
      
    } catch (error) {
      console.error('Send command error:', error);
      res.status(500).json({ error: 'Failed to send command' });
    }
  }

  buildCommand(type, parameters = {}) {
    const command = {
      CommandUUID: uuidv4(),
      Command: {
        RequestType: type
      }
    };

    // Add type-specific parameters
    switch (type) {
      case 'ProfileList':
      case 'SecurityInfo':
      case 'DeviceInformation':
      case 'Restrictions':
        // No additional parameters needed
        break;
        
      case 'InstallProfile':
        command.Command.Payload = parameters.profileData;
        break;
        
      case 'RemoveProfile':
        command.Command.Identifier = parameters.profileIdentifier;
        break;
        
      case 'Settings':
        command.Command.Settings = parameters.settings;
        break;
        
      case 'DeviceLock':
        command.Command.PIN = parameters.pin;
        command.Command.Message = parameters.message;
        break;
        
      default:
        Object.assign(command.Command, parameters);
    }

    return command;
  }

  async sendPushNotification(deviceId, pushToken, pushMagic) {
    if (!this.apnProvider) {
      console.warn('APNS not configured, cannot send push');
      return;
    }

    const notification = new apn.Notification();
    notification.topic = this.config.mdmTopic || 'com.altriirecovery.mdm';
    notification.pushType = 'mdm';
    notification.priority = 5;
    notification.mdm = pushMagic;

    try {
      const result = await this.apnProvider.send(notification, pushToken);
      
      if (result.failed.length > 0) {
        console.error('Push notification failed:', result.failed[0]);
      } else {
        console.log(`Push sent to device ${deviceId}`);
      }
    } catch (error) {
      console.error('Push notification error:', error);
    }
  }

  // Helper methods
  generateEnrollmentCode() {
    return Math.random().toString(36).substring(2, 15).toUpperCase();
  }

  async logDeviceEvent(deviceId, eventType, data) {
    try {
      await db.query(`
        INSERT INTO mdm_device_events (device_id, event_type, event_data)
        VALUES ($1, $2, $3)
      `, [deviceId, eventType, JSON.stringify(data)]);
    } catch (error) {
      console.error('Failed to log device event:', error);
    }
  }

  async getPendingCommands(deviceId) {
    // First check memory
    const memoryCommands = this.pendingCommands.get(deviceId) || [];
    if (memoryCommands.length > 0) {
      return memoryCommands;
    }

    // Then check database
    const device = await db.query(
      'SELECT id FROM device_profiles WHERE profile_uuid = $1',
      [deviceId]
    );

    if (device.rows.length === 0) {
      return [];
    }

    const commands = await db.query(`
      SELECT command_data FROM mdm_commands
      WHERE device_id = $1 AND status = 'pending'
      ORDER BY created_at ASC
    `, [device.rows[0].id]);

    return commands.rows.map(row => row.command_data);
  }

  async getNextCommand(deviceId) {
    const commands = await this.getPendingCommands(deviceId);
    return commands.length > 0 ? commands[0] : null;
  }

  async compileBlockedDomains(settings) {
    const domains = [];
    
    // Get category-based domains from database
    const categories = [];
    if (settings.block_adult_content) categories.push('adult');
    if (settings.block_gambling) categories.push('gambling');
    if (settings.block_social_media) categories.push('social_media');
    if (settings.block_gaming) categories.push('gaming');
    if (settings.block_news) categories.push('news');
    if (settings.block_entertainment) categories.push('entertainment');
    if (settings.block_shopping) categories.push('shopping');
    if (settings.block_dating) categories.push('dating');

    if (categories.length > 0) {
      const categoryDomains = await db.query(
        'SELECT domain FROM blocked_domains WHERE category = ANY($1)',
        [categories]
      );
      domains.push(...categoryDomains.rows.map(r => r.domain));
    }
    
    // Add custom blocked domains
    if (settings.custom_blocked_domains && Array.isArray(settings.custom_blocked_domains)) {
      domains.push(...settings.custom_blocked_domains);
    }
    
    // Remove duplicates and filter out Altrii domains
    const uniqueDomains = [...new Set(domains)].filter(domain => 
      !domain.includes('altriirecovery.com')
    );
    
    return uniqueDomains;
  }

  async getBaselinePermittedURLs() {
    // Essential services that should always be accessible
    return [
      'apple.com',
      'icloud.com',
      'icloud-content.com',
      'cdn-apple.com',
      'mzstatic.com',
      'altriirecovery.com',
      'www.altriirecovery.com',
      'app.altriirecovery.com',
      'api.altriirecovery.com',
      'emergency.gov',
      '911.gov',
      'suicidepreventionlifeline.org',
      'crisistextline.org'
    ];
  }

  async signProfile(profile) {
    // Convert profile to plist
    const plistData = plist.build(profile);
    
    // If no signing certificates available, return unsigned
    if (!this.config.signingCertificate || !this.config.signingKey) {
      console.warn('No signing certificates available - returning unsigned profile');
      return plistData;
    }

    try {
      // Sign the profile using node-forge
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(plistData);
      
      p7.addCertificate(this.config.signingCertificate);
      p7.addSigner({
        key: this.config.signingKey,
        certificate: this.config.signingCertificate,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [{
          type: forge.pki.oids.contentType,
          value: forge.pki.oids.data
        }, {
          type: forge.pki.oids.messageDigest
        }, {
          type: forge.pki.oids.signingTime,
          value: new Date()
        }]
      });

      p7.sign();
      
      // Convert to DER format
      const asn1 = forge.asn1.toDer(p7.toAsn1());
      return Buffer.from(asn1.getBytes(), 'binary');
      
    } catch (error) {
      console.error('Profile signing failed:', error);
      return plistData; // Return unsigned on error
    }
  }

  async processProfileList(deviceId, profiles) {
    try {
      // Store profile information
      console.log(`Device ${deviceId} has ${profiles.length} profiles installed`);
      
      // Check if our supervision profile is installed
      const supervisionProfile = profiles.find(p => 
        p.PayloadIdentifier.startsWith('com.altriirecovery.supervision')
      );

      if (supervisionProfile) {
        await db.query(`
          UPDATE supervision_profiles
          SET installed = true, install_date = NOW()
          WHERE device_id = $1 AND profile_identifier = $2
        `, [deviceId, supervisionProfile.PayloadIdentifier]);

        await db.query(`
          UPDATE device_profiles
          SET mdm_enrolled = true
          WHERE id = $1
        `, [deviceId]);
      }
    } catch (error) {
      console.error('Process profile list error:', error);
    }
  }

  async processSecurityInfo(deviceId, securityInfo) {
    try {
      // Update device security status
      const supervised = securityInfo.IsSupervised || false;
      const passcodeSet = securityInfo.PasscodePresent || false;
      
      await db.query(`
        UPDATE mdm_device_sessions
        SET supervised = $1, updated_at = NOW()
        WHERE device_id = $2
      `, [supervised, deviceId]);

      // Log security info
      await this.logDeviceEvent(deviceId, 'security_info_updated', {
        supervised,
        passcodeSet,
        passcodeCompliant: securityInfo.PasscodeCompliant,
        passcodeCompliantWithProfiles: securityInfo.PasscodeCompliantWithProfiles
      });
    } catch (error) {
      console.error('Process security info error:', error);
    }
  }

  async processAppList(deviceId, apps) {
    try {
      // Clear existing inventory
      await db.query(
        'DELETE FROM device_app_inventory WHERE device_id = $1',
        [deviceId]
      );

      // Get list of blocked apps
      const blockedApps = await db.query(
        'SELECT bundle_identifier FROM blocked_apps'
      );
      const blockedBundleIds = new Set(blockedApps.rows.map(r => r.bundle_identifier));

      // Insert app inventory
      for (const app of apps) {
        const isBlocked = blockedBundleIds.has(app.BundleIdentifier);
        
        await db.query(`
          INSERT INTO device_app_inventory
          (device_id, bundle_identifier, app_name, version, is_system_app, is_blocked)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (device_id, bundle_identifier) 
          DO UPDATE SET 
            app_name = $3,
            version = $4,
            last_seen_at = NOW()
        `, [
          deviceId,
          app.BundleIdentifier,
          app.Name || app.BundleIdentifier,
          app.Version,
          app.IsSystemApp || false,
          isBlocked
        ]);
      }

      // Check for prohibited apps
      const prohibitedApps = apps.filter(app => 
        blockedBundleIds.has(app.BundleIdentifier) && !app.IsSystemApp
      );
      
      if (prohibitedApps.length > 0) {
        console.warn(`Device ${deviceId} has ${prohibitedApps.length} prohibited apps installed`);
        
        // Log warning
        await this.logDeviceEvent(deviceId, 'prohibited_apps_detected', {
          apps: prohibitedApps.map(a => ({
            bundleId: a.BundleIdentifier,
            name: a.Name
          }))
        });
      }
    } catch (error) {
      console.error('Process app list error:', error);
    }
  }

  async processRestrictions(deviceId, restrictions) {
    try {
      // Store current restrictions
      await db.query(`
        INSERT INTO device_restrictions
        (device_id, restriction_set, verified_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (device_id) WHERE active = true
        DO UPDATE SET 
          restriction_set = $2,
          verified_at = NOW()
      `, [deviceId, JSON.stringify(restrictions)]);

      // Verify critical restrictions are in place
      const device = await db.query(
        'SELECT supervision_level FROM device_profiles WHERE id = $1',
        [deviceId]
      );

      if (device.rows.length > 0) {
        const level = device.rows[0].supervision_level;
        const issues = [];

        // Check Level 2 restrictions
        if (level >= 2) {
          if (restrictions.allowVPNCreation !== false) {
            issues.push('VPN creation not blocked');
          }
        }

        // Check Level 3 restrictions
        if (level >= 3) {
          if (restrictions.allowAppInstallation !== false) {
            issues.push('App installation not blocked');
          }
          if (restrictions.allowEraseContentAndSettings !== false) {
            issues.push('Factory reset not blocked');
          }
        }

        if (issues.length > 0) {
          console.error(`Device ${deviceId} restriction issues:`, issues);
          await this.logDeviceEvent(deviceId, 'restriction_violations', { issues });
        }
      }
    } catch (error) {
      console.error('Process restrictions error:', error);
    }
  }

  // Verify device enrollment
  async verifyDevice(req, res) {
    const { deviceId } = req.params;
    
    try {
      // Send verification commands
      const commands = [
        this.buildCommand('ProfileList'),
        this.buildCommand('SecurityInfo'),
        this.buildCommand('Restrictions'),
        this.buildCommand('InstalledApplicationList')
      ];
      
      // Store commands in database
      const device = await db.query(
        'SELECT id FROM device_profiles WHERE profile_uuid = $1',
        [deviceId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      for (const command of commands) {
        await db.query(`
          INSERT INTO mdm_commands
          (device_id, command_uuid, command_type, command_data, status)
          VALUES ($1, $2, $3, $4, 'pending')
        `, [
          device.rows[0].id,
          command.CommandUUID,
          command.Command.RequestType,
          JSON.stringify(command)
        ]);
      }
      
      // Add all commands to queue
      const existingCommands = this.pendingCommands.get(deviceId) || [];
      this.pendingCommands.set(deviceId, [...existingCommands, ...commands]);
      
      // Wake device
      const session = this.deviceSessions.get(deviceId);
      if (session && session.pushToken) {
        await this.sendPushNotification(deviceId, session.pushToken, session.pushMagic);
      }
      
      res.json({
        verificationInitiated: true,
        commandsSent: commands.length,
        expectedResponseTime: '30 seconds'
      });
      
    } catch (error) {
      console.error('Device verification error:', error);
      res.status(500).json({ error: 'Failed to verify device' });
    }
  }

  // Get enrollment profile
  async getEnrollmentProfile(req, res) {
    const { code } = req.params;
    
    const enrollment = this.enrollmentCodes.get(code);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Invalid enrollment code' });
    }
    
    if (enrollment.expiresAt < new Date()) {
      this.enrollmentCodes.delete(code);
      return res.status(410).json({ error: 'Enrollment code expired' });
    }
    
    try {
      // Set appropriate headers for iOS
      res.set({
        'Content-Type': 'application/x-apple-aspen-config',
        'Content-Disposition': `attachment; filename="altrii-recovery-supervision.mobileconfig"`
      });
      
      res.send(enrollment.profileData);
      
      // Log download
      await this.logDeviceEvent(enrollment.deviceId, 'profile_downloaded', {
        enrollmentCode: code
      });
      
      // Mark enrollment as downloaded
      await db.query(`
        UPDATE supervision_enrollments
        SET status = 'downloaded'
        WHERE enrollment_code = $1
      `, [code]);
      
    } catch (error) {
      console.error('Get enrollment profile error:', error);
      res.status(500).json({ error: 'Failed to retrieve profile' });
    }
  }

  // Get device status
  async getDeviceStatus(req, res) {
    const { deviceId } = req.params;
    
    try {
      const session = this.deviceSessions.get(deviceId);
      const pendingCommands = this.pendingCommands.get(deviceId) || [];
      
      // Get database info
      const device = await db.query(`
        SELECT 
          dp.*,
          mds.supervised,
          mds.last_check_in,
          mds.os_version,
          mds.model,
          sp.installed as profile_installed,
          sp.security_level
        FROM device_profiles dp
        LEFT JOIN mdm_device_sessions mds ON dp.id = mds.device_id
        LEFT JOIN supervision_profiles sp ON dp.id = sp.device_id AND sp.installed = true
        WHERE dp.profile_uuid = $1
      `, [deviceId]);

      if (device.rows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const deviceData = device.rows[0];

      res.json({
        deviceId,
        online: !!session,
        lastCheckIn: session?.lastCheckIn || deviceData.last_check_in,
        supervised: session?.supervised || deviceData.supervised || false,
        pendingCommands: pendingCommands.length,
        profileInstalled: deviceData.profile_installed || false,
        securityLevel: deviceData.security_level || 0,
        deviceInfo: session ? {
          model: session.model,
          osVersion: session.osVersion,
          serialNumber: session.serialNumber
        } : {
          model: deviceData.model,
          osVersion: deviceData.os_version
        }
      });
      
    } catch (error) {
      console.error('Get device status error:', error);
      res.status(500).json({ error: 'Failed to get device status' });
    }
  }

  // Handle enrollment
  async handleEnrollment(req, res) {
    const { deviceId, userId } = req.body;
    
    try {
      // This endpoint is called when a device completes enrollment
      await db.query(`
        UPDATE supervision_enrollments
        SET status = 'enrolled', enrolled_at = NOW()
        WHERE device_id = $1 AND user_id = $2 AND status = 'downloaded'
      `, [deviceId, userId]);

      await db.query(`
        UPDATE device_profiles
        SET mdm_enrolled = true
        WHERE id = $1
      `, [deviceId]);

      res.json({ success: true });
      
    } catch (error) {
      console.error('Handle enrollment error:', error);
      res.status(500).json({ error: 'Failed to complete enrollment' });
    }
  }

  // Load signing certificates if available
  async loadSigningCertificates() {
    if (!this.config.signingCertPath || !this.config.signingKeyPath) {
      return;
    }

    try {
      const certPem = await fs.promises.readFile(this.config.signingCertPath, 'utf8');
      const keyPem = await fs.promises.readFile(this.config.signingKeyPath, 'utf8');
      
      this.config.signingCertificate = forge.pki.certificateFromPem(certPem);
      this.config.signingKey = forge.pki.privateKeyFromPem(keyPem);
      
      console.log('Signing certificates loaded successfully');
    } catch (error) {
      console.warn('Failed to load signing certificates:', error.message);
    }
  }

  // Start server
  async start() {
    // Load certificates if available
    await this.loadSigningCertificates();
    
    const port = this.config.port || 3001;
    
    if (this.config.ssl) {
      // HTTPS server for production
      const httpsOptions = {
        key: fs.readFileSync(this.config.ssl.key),
        cert: fs.readFileSync(this.config.ssl.cert)
      };
      
      https.createServer(httpsOptions, this.app).listen(port, () => {
        console.log(`MDM Server (HTTPS) running on port ${port}`);
      });
    } else {
      // HTTP for development
      this.app.listen(port, () => {
        console.log(`MDM Server (HTTP) running on port ${port}`);
      });
    }
  }

  // Graceful shutdown
  async shutdown() {
    console.log('Shutting down MDM server...');
    
    // Close APNS provider
    if (this.apnProvider) {
      this.apnProvider.shutdown();
    }
    
    // Clear in-memory data
    this.deviceSessions.clear();
    this.pendingCommands.clear();
    this.enrollmentCodes.clear();
    
    console.log('MDM server shutdown complete');
  }
}

// Export for use
module.exports = AltriiMDMServer;

// Start server if run directly
if (require.main === module) {
  const config = {
    port: process.env.MDM_PORT || 3001,
    serverUrl: process.env.MDM_SERVER_URL || 'http://localhost:3001',
    mdmTopic: process.env.MDM_TOPIC || 'com.altriirecovery.mdm',
    production: process.env.NODE_ENV === 'production',
    apiKey: process.env.MDM_API_KEY || 'development-key',
    
    // APNS configuration
    apns: process.env.APNS_KEY_PATH ? {
      key: fs.readFileSync(process.env.APNS_KEY_PATH),
      keyId: process.env.APNS_KEY_ID,
      teamId: process.env.APNS_TEAM_ID
    } : null,
    
    // SSL configuration for production
    ssl: process.env.SSL_KEY_PATH ? {
      key: process.env.SSL_KEY_PATH,
      cert: process.env.SSL_CERT_PATH
    } : null,
    
    // Signing certificates (optional)
    signingCertPath: process.env.MDM_SIGNING_CERT_PATH,
    signingKeyPath: process.env.MDM_SIGNING_KEY_PATH
  };
  
  const server = new AltriiMDMServer(config);
  server.start();
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
  });
}
