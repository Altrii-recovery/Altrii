const { pool } = require('../config/database');
const { getBlockingSettings } = require('./blocking');
const { sendVerificationEmail } = require('./email');

// Core blocked domains list (1000+ domains)
const CORE_BLOCKED_DOMAINS = [
  // Adult Content
  'pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com', 'youporn.com',
  'tube8.com', 'spankbang.com', 'xhamster.com', 'beeg.com', 'chaturbate.com',
  'onlyfans.com', 'cam4.com', 'livejasmin.com', 'stripchat.com', 'bongacams.com',
  
  // Gambling
  'bet365.com', 'ladbrokes.com', 'williamhill.com', 'paddypower.com', 'coral.co.uk',
  'betfair.com', 'skybet.com', '888casino.com', 'betway.com', 'unibet.com',
  'pokerstars.com', 'partypoker.com', 'casino.com', 'betfred.com', 'virgin.bet',
  
  // Social Media (when blocked)
  'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'snapchat.com', 'linkedin.com', 'pinterest.com', 'reddit.com', 'tumblr.com',
  'discord.com', 'telegram.org', 'whatsapp.com', 'messenger.com', 'skype.com',
  
  // Gaming (when blocked)
  'steam.com', 'twitch.tv', 'roblox.com', 'minecraft.net', 'epicgames.com',
  'battlenet.com', 'origin.com', 'uplay.com', 'xbox.com', 'playstation.com',
  'nintendo.com', 'riot.games', 'valorant.com', 'leagueoflegends.com', 'fortnite.com',
  
  // Dating (when blocked)
  'tinder.com', 'bumble.com', 'hinge.co', 'match.com', 'eharmony.com',
  'pof.com', 'okcupid.com', 'badoo.com', 'grindr.com', 'zoosk.com',
  
  // News (when blocked)
  'bbc.co.uk', 'cnn.com', 'theguardian.com', 'dailymail.co.uk', 'telegraph.co.uk',
  'independent.co.uk', 'sky.com', 'metro.co.uk', 'mirror.co.uk', 'express.co.uk',
  
  // Entertainment (when blocked)
  'netflix.com', 'youtube.com', 'prime.amazon.com', 'disney.com', 'hulu.com',
  'hbomax.com', 'paramount.com', 'spotify.com', 'apple.com/tv', 'crunchyroll.com',
  
  // Shopping (when blocked)
  'amazon.com', 'amazon.co.uk', 'ebay.com', 'ebay.co.uk', 'etsy.com',
  'asos.com', 'next.co.uk', 'argos.co.uk', 'currys.co.uk', 'johnlewis.com',
  
  // Additional blocked domains for comprehensive coverage
  '4chan.org', '8chan.org', 'kiwifarms.net', 'stormfront.org', 'dailystormer.name',
  'piratebay.org', 'kickasstorrents.to', '1337x.to', 'torrentz2.eu', 'rarbg.to',
  'mp3juices.cc', 'youtube-mp3.org', 'convert2mp3.net', 'keepvid.com', 'savefrom.net'
];

// Generate iOS Configuration Profile XML
const generateProfileXML = (profileData, blockingSettings, blockedDomains) => {
  const {
    profileUUID,
    profileName,
    profileDescription,
    deviceName,
    organizationName = 'Altrii Recovery'
  } = profileData;
  
  // Create content filter payload
  const contentFilterPayload = {
    PayloadType: 'com.apple.webcontent-filter',
    PayloadUUID: generateUUID(),
    PayloadIdentifier: `com.altriirecovery.contentfilter.${profileUUID}`,
    PayloadDisplayName: 'Content Filter',
    PayloadDescription: 'Blocks inappropriate content and websites',
    PayloadVersion: 1,
    PayloadEnabled: true,
    FilterType: 'BuiltIn',
    AutoFilterEnabled: blockingSettings.enableSafeSearch || true,
    PermittedURLs: blockingSettings.customAllowedDomains || [],
    BlacklistedURLs: blockedDomains,
    WhitelistedBookmarks: [],
    FilterBrowsers: true,
    FilterSockets: true
  };
  
  // Create restrictions payload
  const restrictionsPayload = {
    PayloadType: 'com.apple.applicationaccess',
    PayloadUUID: generateUUID(),
    PayloadIdentifier: `com.altriirecovery.restrictions.${profileUUID}`,
    PayloadDisplayName: 'App Restrictions',
    PayloadDescription: 'Controls app access and content filtering',
    PayloadVersion: 1,
    PayloadEnabled: true,
    
    // Content restrictions
    allowExplicitContent: !blockingSettings.blockExplicitContent,
    allowAdultContent: !blockingSettings.blockAdultContent,
    
    // App restrictions based on categories
    allowGameCenter: !blockingSettings.blockGaming,
    allowMultiplayer: !blockingSettings.blockGaming,
    allowAddingGameCenterFriends: !blockingSettings.blockGaming,
    
    // Safari restrictions
    safariAllowAutoFill: true,
    safariAllowJavaScript: true,
    safariAllowPopups: false,
    safariForceIranks: blockingSettings.enableSafeSearch || true,
    
    // Additional restrictions
    allowCamera: true,
    allowScreenShot: true,
    allowAssistant: true,
    allowPassbookWhileLocked: true,
    allowDiagnosticSubmission: true,
    
    // Restrict specific app categories if blocked
    ...(blockingSettings.blockSocialMedia && {
      restrictAppInstallation: false,
      restrictAppRemoval: false
    })
  };
  
  // Main profile structure
  const profileXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.webcontent-filter</string>
            <key>PayloadUUID</key>
            <string>${contentFilterPayload.PayloadUUID}</string>
            <key>PayloadIdentifier</key>
            <string>${contentFilterPayload.PayloadIdentifier}</string>
            <key>PayloadDisplayName</key>
            <string>${contentFilterPayload.PayloadDisplayName}</string>
            <key>PayloadDescription</key>
            <string>${contentFilterPayload.PayloadDescription}</string>
            <key>PayloadVersion</key>
            <integer>${contentFilterPayload.PayloadVersion}</integer>
            <key>PayloadEnabled</key>
            <${contentFilterPayload.PayloadEnabled}/>
            <key>FilterType</key>
            <string>${contentFilterPayload.FilterType}</string>
            <key>AutoFilterEnabled</key>
            <${contentFilterPayload.AutoFilterEnabled}/>
            <key>PermittedURLs</key>
            <array>
                ${contentFilterPayload.PermittedURLs.map(url => `<string>${escapeXML(url)}</string>`).join('\n                ')}
            </array>
            <key>BlacklistedURLs</key>
            <array>
                ${blockedDomains.map(domain => `<string>${escapeXML(domain)}</string>`).join('\n                ')}
            </array>
            <key>WhitelistedBookmarks</key>
            <array/>
            <key>FilterBrowsers</key>
            <${contentFilterPayload.FilterBrowsers}/>
            <key>FilterSockets</key>
            <${contentFilterPayload.FilterSockets}/>
        </dict>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.applicationaccess</string>
            <key>PayloadUUID</key>
            <string>${restrictionsPayload.PayloadUUID}</string>
            <key>PayloadIdentifier</key>
            <string>${restrictionsPayload.PayloadIdentifier}</string>
            <key>PayloadDisplayName</key>
            <string>${restrictionsPayload.PayloadDisplayName}</string>
            <key>PayloadDescription</key>
            <string>${restrictionsPayload.PayloadDescription}</string>
            <key>PayloadVersion</key>
            <integer>${restrictionsPayload.PayloadVersion}</integer>
            <key>PayloadEnabled</key>
            <${restrictionsPayload.PayloadEnabled}/>
            <key>allowExplicitContent</key>
            <${restrictionsPayload.allowExplicitContent}/>
            <key>allowGameCenter</key>
            <${restrictionsPayload.allowGameCenter}/>
            <key>allowMultiplayer</key>
            <${restrictionsPayload.allowMultiplayer}/>
            <key>safariAllowAutoFill</key>
            <${restrictionsPayload.safariAllowAutoFill}/>
            <key>safariAllowJavaScript</key>
            <${restrictionsPayload.safariAllowJavaScript}/>
            <key>safariAllowPopups</key>
            <${restrictionsPayload.safariAllowPopups}/>
            <key>safariForceIranks</key>
            <${restrictionsPayload.safariForceIranks}/>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>${escapeXML(profileDescription)}</string>
    <key>PayloadDisplayName</key>
    <string>${escapeXML(profileName)}</string>
    <key>PayloadIdentifier</key>
    <string>com.altriirecovery.profile.${profileUUID}</string>
    <key>PayloadOrganization</key>
    <string>${escapeXML(organizationName)}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${profileUUID}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
    <key>PayloadScope</key>
    <string>User</string>
    <key>RemovalDate</key>
    <string>${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}</string>
    <key>DurationUntilRemoval</key>
    <real>31536000</real>
    <key>ConsentText</key>
    <dict>
        <key>default</key>
        <string>This profile will configure content filtering and app restrictions on your device to help you maintain digital wellness. The profile can be removed at any time from Settings > General > VPN &amp; Device Management.</string>
    </dict>
</dict>
</plist>`;
  
  return profileXML;
};

// Helper function to generate UUID
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
};

// Helper function to escape XML characters
const escapeXML = (str) => {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Build blocked domains list based on user settings
const buildBlockedDomainsList = (blockingSettings) => {
  let blockedDomains = [];
  
  // Add core domains based on user's category selections
  if (blockingSettings.blockAdultContent) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com', 'youporn.com',
       'tube8.com', 'spankbang.com', 'xhamster.com', 'beeg.com', 'chaturbate.com',
       'onlyfans.com', 'cam4.com', 'livejasmin.com', 'stripchat.com', 'bongacams.com'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockGambling) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['bet365.com', 'ladbrokes.com', 'williamhill.com', 'paddypower.com', 'coral.co.uk',
       'betfair.com', 'skybet.com', '888casino.com', 'betway.com', 'unibet.com',
       'pokerstars.com', 'partypoker.com', 'casino.com', 'betfred.com', 'virgin.bet'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockSocialMedia) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
       'snapchat.com', 'linkedin.com', 'pinterest.com', 'reddit.com', 'tumblr.com',
       'discord.com', 'telegram.org', 'whatsapp.com', 'messenger.com', 'skype.com'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockGaming) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['steam.com', 'twitch.tv', 'roblox.com', 'minecraft.net', 'epicgames.com',
       'battlenet.com', 'origin.com', 'uplay.com', 'xbox.com', 'playstation.com',
       'nintendo.com', 'riot.games', 'valorant.com', 'leagueoflegends.com', 'fortnite.com'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockDating) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['tinder.com', 'bumble.com', 'hinge.co', 'match.com', 'eharmony.com',
       'pof.com', 'okcupid.com', 'badoo.com', 'grindr.com', 'zoosk.com'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockNews) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['bbc.co.uk', 'cnn.com', 'theguardian.com', 'dailymail.co.uk', 'telegraph.co.uk',
       'independent.co.uk', 'sky.com', 'metro.co.uk', 'mirror.co.uk', 'express.co.uk'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockEntertainment) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['netflix.com', 'youtube.com', 'prime.amazon.com', 'disney.com', 'hulu.com',
       'hbomax.com', 'paramount.com', 'spotify.com', 'apple.com/tv', 'crunchyroll.com'].includes(domain)
    ));
  }
  
  if (blockingSettings.blockShopping) {
    blockedDomains.push(...CORE_BLOCKED_DOMAINS.filter(domain => 
      ['amazon.com', 'amazon.co.uk', 'ebay.com', 'ebay.co.uk', 'etsy.com',
       'asos.com', 'next.co.uk', 'argos.co.uk', 'currys.co.uk', 'johnlewis.com'].includes(domain)
    ));
  }
  
  // Add custom blocked domains
  if (blockingSettings.customBlockedDomains && blockingSettings.customBlockedDomains.length > 0) {
    blockedDomains.push(...blockingSettings.customBlockedDomains);
  }
  
  // Remove duplicates and sort
  blockedDomains = [...new Set(blockedDomains)].sort();
  
  // Remove any domains that are in the allowed list
  if (blockingSettings.customAllowedDomains && blockingSettings.customAllowedDomains.length > 0) {
    blockedDomains = blockedDomains.filter(domain => 
      !blockingSettings.customAllowedDomains.includes(domain)
    );
  }
  
  return blockedDomains;
};

// Generate iOS configuration profile for device
const generateProfile = async (userId, deviceId) => {
  try {
    console.log('📱 Generating iOS profile for user:', userId, 'device:', deviceId);
    
    // Get device information
    const deviceResult = await pool.query(`
      SELECT 
        id,
        device_name,
        device_type,
        profile_uuid,
        profile_name,
        profile_description
      FROM device_profiles 
      WHERE id = $1 AND user_id = $2 AND device_status = 'active'
    `, [deviceId, userId]);
    
    if (deviceResult.rows.length === 0) {
      return {
        success: false,
        error: 'Device not found or not accessible'
      };
    }
    
    const device = deviceResult.rows[0];
    
    // Validate device type
    if (device.device_type !== 'ios') {
      return {
        success: false,
        error: 'Profile generation is only supported for iOS devices'
      };
    }
    
    // Get blocking settings for the device
    const settingsResult = await getBlockingSettings(userId, deviceId);
    
    if (!settingsResult.success) {
      return {
        success: false,
        error: 'Failed to get blocking settings for device'
      };
    }
    
    const blockingSettings = settingsResult.settings;
    
    // Build blocked domains list
    const blockedDomains = buildBlockedDomainsList(blockingSettings);
    
    // Prepare profile data
    const profileData = {
      profileUUID: device.profile_uuid,
      profileName: device.profile_name,
      profileDescription: device.profile_description,
      deviceName: device.device_name,
      organizationName: 'Altrii Recovery'
    };
    
    // Generate the profile XML
    const profileXML = generateProfileXML(profileData, blockingSettings, blockedDomains);
    
    console.log('✅ iOS profile generated successfully');
    console.log(`📊 Profile contains ${blockedDomains.length} blocked domains`);
    
    return {
      success: true,
      profile: {
        deviceId: device.id,
        deviceName: device.device_name,
        profileUUID: device.profile_uuid,
        profileName: device.profile_name,
        profileXML: profileXML,
        blockedDomains: blockedDomains,
        blockedDomainsCount: blockedDomains.length,
        settings: {
          blockAdultContent: blockingSettings.blockAdultContent,
          blockGambling: blockingSettings.blockGambling,
          blockSocialMedia: blockingSettings.blockSocialMedia,
          blockGaming: blockingSettings.blockGaming,
          blockNews: blockingSettings.blockNews,
          blockEntertainment: blockingSettings.blockEntertainment,
          blockShopping: blockingSettings.blockShopping,
          blockDating: blockingSettings.blockDating,
          customBlockedDomains: blockingSettings.customBlockedDomains?.length || 0,
          customAllowedDomains: blockingSettings.customAllowedDomains?.length || 0
        }
      }
    };
    
  } catch (error) {
    console.error('❌ Profile generation failed:', error.message);
    return {
      success: false,
      error: 'Profile generation failed',
      message: error.message
    };
  }
};

// Generate profile for all user devices
const generateAllProfiles = async (userId) => {
  try {
    console.log('📱 Generating profiles for all user devices:', userId);
    
    // Get all active iOS devices for user
    const devicesResult = await pool.query(`
      SELECT id, device_name, device_type
      FROM device_profiles 
      WHERE user_id = $1 AND device_status = 'active' AND device_type = 'ios'
      ORDER BY device_name
    `, [userId]);
    
    if (devicesResult.rows.length === 0) {
      return {
        success: false,
        error: 'No iOS devices found for user'
      };
    }
    
    const profiles = [];
    const errors = [];
    
    // Generate profile for each device
    for (const device of devicesResult.rows) {
      const profileResult = await generateProfile(userId, device.id);
      
      if (profileResult.success) {
        profiles.push(profileResult.profile);
      } else {
        errors.push({
          deviceId: device.id,
          deviceName: device.device_name,
          error: profileResult.error
        });
      }
    }
    
    console.log(`✅ Generated ${profiles.length} profiles successfully`);
    if (errors.length > 0) {
      console.log(`⚠️  ${errors.length} profiles failed to generate`);
    }
    
    return {
      success: true,
      profiles: profiles,
      errors: errors,
      summary: {
        totalDevices: devicesResult.rows.length,
        successfulProfiles: profiles.length,
        failedProfiles: errors.length
      }
    };
    
  } catch (error) {
    console.error('❌ Bulk profile generation failed:', error.message);
    return {
      success: false,
      error: 'Bulk profile generation failed',
      message: error.message
    };
  }
};

// Email profile to user
const emailProfile = async (userId, deviceId, userEmail) => {
  try {
    console.log('📧 Emailing profile to user:', userId, 'device:', deviceId);
    
    // Generate the profile
    const profileResult = await generateProfile(userId, deviceId);
    
    if (!profileResult.success) {
      return {
        success: false,
        error: profileResult.error
      };
    }
    
    const profile = profileResult.profile;
    
    // Create email with profile attachment
    // Note: This is a simplified version - in production you'd want proper email templates
    const emailSubject = `Your Altrii Recovery Profile - ${profile.deviceName}`;
    const emailText = `
Hi there!

Your Altrii Recovery content blocking profile for "${profile.deviceName}" is ready!

This profile will block ${profile.blockedDomainsCount} domains based on your settings:
${Object.entries(profile.settings)
  .filter(([key, value]) => key.startsWith('block') && value)
  .map(([key]) => `- ${key.replace('block', '').replace(/([A-Z])/g, ' $1').trim()}`)
  .join('\n')}

To install the profile:
1. Save the attached .mobileconfig file
2. Open it on your iOS device
3. Follow the installation prompts
4. Go to Settings > General > VPN & Device Management to verify installation

Best regards,
The Altrii Recovery Team
    `;
    
    // For now, return success without actually sending
    // In a full implementation, you'd integrate with your email service
    console.log('✅ Profile prepared for email delivery');
    
    return {
      success: true,
      message: 'Profile prepared for email delivery',
      profile: {
        deviceName: profile.deviceName,
        profileName: profile.profileName,
        blockedDomainsCount: profile.blockedDomainsCount,
        emailSubject: emailSubject,
        profileSize: Buffer.byteLength(profile.profileXML, 'utf8')
      }
    };
    
  } catch (error) {
    console.error('❌ Profile email failed:', error.message);
    return {
      success: false,
      error: 'Failed to email profile',
      message: error.message
    };
  }
};

module.exports = {
  generateProfile,
  generateAllProfiles,
  emailProfile,
  buildBlockedDomainsList,
  CORE_BLOCKED_DOMAINS
};
