const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  stripe,
  createStripeCustomer,
  createSubscription,
  getUserSubscription,
  cancelSubscription,
  createBillingPortalSession,
  processWebhookEvent
} = require('../services/stripe');
const { pool } = require('../config/database');

const router = express.Router();

// Get subscription plans and pricing
router.get('/plans', (req, res) => {
  res.json({
    message: 'Available subscription plans',
    currency: 'gbp',
    plans: [
      {
        id: '1-month',
        name: '1 Month Plan',
        price: 10.00,
        currency: 'gbp',
        interval: 'month',
        intervalCount: 1,
        priceId: process.env.STRIPE_PRICE_ID_1_MONTH,
        savings: null,
        recommended: false,
        features: [
          'Unlimited device profiles',
          'Content blocking categories', 
          'Timer commitments up to 30 days',
          'Email support'
        ]
      },
      {
        id: '3-months',
        name: '3 Month Plan',
        price: 25.00,
        currency: 'gbp',
        interval: 'month',
        intervalCount: 3,
        priceId: process.env.STRIPE_PRICE_ID_3_MONTHS,
        monthlyEquivalent: 8.33,
        savings: '17% savings vs monthly',
        recommended: false,
        features: [
          'Unlimited device profiles',
          'Content blocking categories',
          'Timer commitments up to 90 days',
          'Email support',
          '17% savings vs monthly billing'
        ]
      },
      {
        id: '6-months',
        name: '6 Month Plan',
        price: 50.00,
        currency: 'gbp',
        interval: 'month',
        intervalCount: 6,
        priceId: process.env.STRIPE_PRICE_ID_6_MONTHS,
        monthlyEquivalent: 8.33,
        savings: '17% savings vs monthly',
        recommended: true,
        features: [
          'Unlimited device profiles',
          'Content blocking categories',
          'Timer commitments up to 180 days',
          'Priority email support',
          '17% savings vs monthly billing',
          'Most popular choice'
        ]
      },
      {
        id: '1-year',
        name: '1 Year Plan',
        price: 90.00,
        currency: 'gbp',
        interval: 'year',
        intervalCount: 1,
        priceId: process.env.STRIPE_PRICE_ID_1_YEAR,
        monthlyEquivalent: 7.50,
        savings: '25% savings vs monthly',
        recommended: false,
        features: [
          'Unlimited device profiles',
          'Content blocking categories',
          'Timer commitments up to 365 days',
          'Priority email support',
          '25% savings vs monthly billing',
          'Best value for long-term commitment'
        ]
      }
    ],
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

// FIXED: Create subscription for authenticated user
router.post('/create', authenticateToken, async (req, res) => {
  console.log('💳 Subscription creation request for user:', req.user.id);
  console.log('💳 Request body:', req.body);
  
  try {
    const { priceId } = req.body;
    const userId = req.user.id;
    
    // Validate priceId
    if (!priceId) {
      return res.status(400).json({
        error: 'Missing price ID',
        message: 'Price ID is required to create a subscription'
      });
    }
    
    console.log('💳 Using priceId:', priceId);
    
    // Check if user already has an active subscription
    const existingCheck = await pool.query(
      'SELECT subscription_status, stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }
    
    const existingUser = existingCheck.rows[0];
    console.log('👤 Existing user data:', existingUser);
    
    if (existingUser.subscription_status === 'active') {
      return res.status(400).json({
        error: 'Subscription exists',
        message: 'User already has an active subscription'
      });
    }
    
    // Get or create Stripe customer
    let customerId = existingUser.stripe_customer_id;
    
    if (!customerId) {
      console.log('🆕 Creating new Stripe customer');
      const customerResult = await createStripeCustomer(
        req.user.email,
        `${req.user.firstName || 'User'} ${req.user.lastName || ''}`.trim(),
        userId
      );
      
      if (!customerResult.success) {
        console.error('❌ Customer creation failed:', customerResult.error);
        return res.status(500).json({
          error: 'Customer creation failed',
          message: customerResult.error
        });
      }
      
      customerId = customerResult.customerId;
      console.log('✅ Created customer:', customerId);
      
      // Update user with customer ID
      await pool.query(`
        UPDATE users 
        SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [customerId, userId]);
    }
    console.log('👤 Using customer ID:', customerId);
    
    // Create subscription
    console.log('🔄 Creating subscription with:', { customerId, priceId });
    const subscriptionResult = await createSubscription(customerId, priceId);
    
    if (!subscriptionResult.success) {
      console.error('❌ Subscription creation failed:', subscriptionResult.error);
      return res.status(500).json({
        error: 'Subscription creation failed',
        message: subscriptionResult.error
      });
    }
    
    console.log('✅ Subscription created:', subscriptionResult);
    
    // Update user record with subscription info
    await pool.query(`
      UPDATE users 
      SET 
        stripe_subscription_id = $1,
        subscription_status = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [subscriptionResult.subscriptionId, subscriptionResult.status || 'incomplete', userId]);
    
    console.log('✅ Subscription created successfully for user:', userId);
    
    // Return success response
    const response = {
      message: 'Subscription created successfully',
      subscriptionId: subscriptionResult.subscriptionId,
      status: subscriptionResult.status || 'incomplete'
    };
    
    // Only include clientSecret if it exists
    if (subscriptionResult.clientSecret) {
      response.clientSecret = subscriptionResult.clientSecret;
    }
    
    console.log('📤 Sending response:', response);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Subscription creation error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      error: 'Subscription creation failed',
      message: 'An unexpected error occurred while creating the subscription',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user's current subscription status
router.get('/status', authenticateToken, async (req, res) => {
  console.log('📋 Subscription status request for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    
    // Get subscription info from database
    const result = await pool.query(`
      SELECT 
        subscription_status,
        subscription_plan,
        subscription_start_date,
        subscription_end_date,
        stripe_customer_id,
        stripe_subscription_id
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }
    
    const user = result.rows[0];
    
    // Get detailed subscription from Stripe if exists
    let stripeSubscription = null;
    if (user.stripe_subscription_id) {
      const subscriptionResult = await getUserSubscription(userId);
      if (subscriptionResult.success) {
        stripeSubscription = subscriptionResult.subscription;
      }
    }
    
    res.json({
      message: 'Subscription status retrieved',
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: user.subscription_plan || null,
        startDate: user.subscription_start_date,
        endDate: user.subscription_end_date,
        stripeCustomerId: user.stripe_customer_id,
        stripeSubscriptionId: user.stripe_subscription_id,
        stripeDetails: stripeSubscription ? {
          id: stripeSubscription.id,
          status: stripeSubscription.status,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          priceId: stripeSubscription.items.data[0]?.price?.id
        } : null
      }
    });
    
  } catch (error) {
    console.error('❌ Subscription status error:', error.message);
    res.status(500).json({
      error: 'Failed to get subscription status',
      message: 'An error occurred while retrieving subscription information'
    });
  }
});

// Cancel subscription
router.post('/cancel', authenticateToken, async (req, res) => {
  console.log('🚫 Subscription cancellation request for user:', req.user.id);
  
  try {
    const { immediate = false } = req.body;
    const userId = req.user.id;
    
    // Get user's subscription ID
    const result = await pool.query(
      'SELECT stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].stripe_subscription_id) {
      return res.status(400).json({
        error: 'No subscription found',
        message: 'User does not have an active subscription to cancel'
      });
    }
    
    const subscriptionId = result.rows[0].stripe_subscription_id;
    
    // Cancel subscription in Stripe
    const cancelResult = await cancelSubscription(subscriptionId, immediate);
    
    if (!cancelResult.success) {
      return res.status(500).json({
        error: 'Cancellation failed',
        message: cancelResult.error
      });
    }
    
    // Update user record
    const newStatus = immediate ? 'canceled' : 'active'; // Still active until period end
    await pool.query(`
      UPDATE users 
      SET 
        subscription_status = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newStatus, userId]);
    
    console.log('✅ Subscription canceled for user:', userId);
    
    res.json({
      message: immediate ? 'Subscription canceled immediately' : 'Subscription will cancel at period end',
      canceledAt: immediate ? new Date().toISOString() : null,
      willCancelAt: immediate ? null : cancelResult.subscription.current_period_end
    });
    
  } catch (error) {
    console.error('❌ Subscription cancellation error:', error.message);
    res.status(500).json({
      error: 'Cancellation failed',
      message: 'An error occurred while canceling the subscription'
    });
  }
});

// Create billing portal session
router.post('/billing-portal', authenticateToken, async (req, res) => {
  console.log('🏪 Billing portal request for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const { returnUrl } = req.body;
    
    // Get user's Stripe customer ID
    const result = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(400).json({
        error: 'No customer found',
        message: 'User is not a Stripe customer'
      });
    }
    
    const customerId = result.rows[0].stripe_customer_id;
    const actualReturnUrl = returnUrl || process.env.FRONTEND_URL;
    
    const portalResult = await createBillingPortalSession(customerId, actualReturnUrl);
    
    if (!portalResult.success) {
      return res.status(500).json({
        error: 'Portal creation failed',
        message: portalResult.error
      });
    }
    
    console.log('✅ Billing portal session created for user:', userId);
    
    res.json({
      message: 'Billing portal session created',
      url: portalResult.url
    });
    
  } catch (error) {
    console.error('❌ Billing portal error:', error.message);
    res.status(500).json({
      error: 'Portal creation failed',
      message: 'An error occurred while creating billing portal session'
    });
  }
});

// DEBUGGING: Add a test endpoint to verify your Stripe configuration
router.get('/debug/stripe-config', authenticateToken, async (req, res) => {
  try {
    const config = {
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
      hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      priceIds: {
        oneMonth: process.env.STRIPE_PRICE_ID_1_MONTH || 'NOT_SET',
        threeMonths: process.env.STRIPE_PRICE_ID_3_MONTHS || 'NOT_SET',
        sixMonths: process.env.STRIPE_PRICE_ID_6_MONTHS || 'NOT_SET',
        oneYear: process.env.STRIPE_PRICE_ID_1_YEAR || 'NOT_SET'
      }
    };
    
    // Test if we can access Stripe
    try {
      const account = await stripe.account.retrieve();
      config.stripeAccountId = account.id;
      config.stripeAccountCountry = account.country;
    } catch (stripeError) {
      config.stripeError = stripeError.message;
    }
    
    // Test price IDs
    const priceTests = {};
    for (const [key, priceId] of Object.entries(config.priceIds)) {
      if (priceId && priceId !== 'NOT_SET') {
        try {
          const price = await stripe.prices.retrieve(priceId);
          priceTests[key] = {
            valid: true,
            amount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval
          };
        } catch (priceError) {
          priceTests[key] = {
            valid: false,
            error: priceError.message
          };
        }
      } else {
        priceTests[key] = { valid: false, error: 'Not configured' };
      }
    }
    config.priceTests = priceTests;
    
    res.json({
      message: 'Stripe configuration debug info',
      config,
      environment: process.env.NODE_ENV,
      recommendations: [
        !config.hasStripeKey ? 'Set STRIPE_SECRET_KEY in your .env file' : null,
        !config.hasWebhookSecret ? 'Set STRIPE_WEBHOOK_SECRET for production' : null,
        Object.values(priceTests).some(test => !test.valid) ? 'Some price IDs are invalid or not set' : null
      ].filter(Boolean)
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      error: 'Debug failed',
      message: error.message
    });
  }
});

// Stripe webhook endpoint (no authentication required)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('🔔 Stripe webhook received');
  
  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.warn('⚠️  No webhook secret configured');
      return res.status(400).send('Webhook secret not configured');
    }
    
    // Verify webhook signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    console.log('✅ Webhook verified:', event.type);
    
    // Process the webhook event
    const result = await processWebhookEvent(event);
    
    if (result.success) {
      res.json({ received: true });
    } else {
      console.error('❌ Webhook processing failed:', result.error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Test endpoint for development
router.get('/test', authenticateToken, async (req, res) => {
  res.json({
    message: 'Subscription routes are working',
    user: {
      id: req.user.id,
      email: req.user.email,
      subscriptionStatus: req.user.subscriptionStatus
    },
    availablePlans: [
      { id: '1-month', price: '£10.00', duration: '1 month' },
      { id: '3-months', price: '£25.00', duration: '3 months', savings: '17%' },
      { id: '6-months', price: '£50.00', duration: '6 months', savings: '17%', recommended: true },
      { id: '1-year', price: '£90.00', duration: '1 year', savings: '25%' }
    ],
    endpoints: {
      plans: 'GET /api/subscriptions/plans',
      create: 'POST /api/subscriptions/create (with priceId in body)',
      status: 'GET /api/subscriptions/status',
      cancel: 'POST /api/subscriptions/cancel',
      billingPortal: 'POST /api/subscriptions/billing-portal',
      webhook: 'POST /api/subscriptions/webhook',
      debug: 'GET /api/subscriptions/debug/stripe-config'
    },
    testInstructions: {
      step1: 'GET /api/subscriptions/plans to see all pricing',
      step2: 'POST /api/subscriptions/create with {"priceId": "price_xxx"} to create subscription',
      step3: 'Use Stripe test cards for payment testing'
    }
  });
});


// Get subscription features based on user's current plan
router.get('/features', authenticateToken, async (req, res) => {
  console.log('🎯 Subscription features request for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    
    // Get user's subscription info from database
    const result = await pool.query(`
      SELECT 
        subscription_status,
        subscription_plan,
        subscription_start_date,
        subscription_end_date,
        stripe_customer_id,
        stripe_subscription_id
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
    
    console.log('📊 User subscription info:', {
      status: user.subscription_status,
      plan: user.subscription_plan,
      active: hasActiveSubscription
    });
    
    // Define features based on subscription plan
    const features = {
      // Basic features available to all users
      basic: {
        enabled: true,
        maxDevices: hasActiveSubscription ? 10 : 1,
        contentBlocking: true,
        basicTimers: true
      },
      
      // Supervision features (premium only)
      supervision: {
        enabled: false,
        maxLevel: 0,
        maxDevices: 0,
        notificationTypes: []
      },
      
      // Accountability features (premium only)  
      accountability: {
        enabled: false,
        maxPartners: 0,
        reportingEnabled: false
      },
      
      // Advanced features
      advanced: {
        enabled: hasActiveSubscription,
        extendedTimers: hasActiveSubscription,
        customDomains: hasActiveSubscription,
        prioritySupport: false
      }
    };
    
    // Configure features based on active subscription plan
    if (hasActiveSubscription) {
      switch (user.subscription_plan) {
        case '1-month':
          features.supervision = {
            enabled: true,
            maxLevel: 1,
            maxDevices: 3,
            notificationTypes: ['email']
          };
          features.accountability = {
            enabled: true,
            maxPartners: 1,
            reportingEnabled: true
          };
          break;
          
        case '3-months':
          features.supervision = {
            enabled: true,
            maxLevel: 2,
            maxDevices: 5,
            notificationTypes: ['email', 'sms']
          };
          features.accountability = {
            enabled: true,
            maxPartners: 3,
            reportingEnabled: true
          };
          features.advanced.prioritySupport = true;
          break;
          
        case '6-months':
        case '1-year':
          features.supervision = {
            enabled: true,
            maxLevel: 3,
            maxDevices: user.subscription_plan === '1-year' ? 15 : 10,
            notificationTypes: ['email', 'sms', 'push']
          };
          features.accountability = {
            enabled: true,
            maxPartners: user.subscription_plan === '1-year' ? 10 : 5,
            reportingEnabled: true
          };
          features.advanced.prioritySupport = true;
          break;
      }
    }
    
    const planLimits = {
      timerMaxDuration: hasActiveSubscription ? (
        user.subscription_plan === '1-month' ? 30 :
        user.subscription_plan === '3-months' ? 90 :
        user.subscription_plan === '6-months' ? 180 :
        user.subscription_plan === '1-year' ? 365 :
        7
      ) : 24,
      profileDownloads: hasActiveSubscription ? 100 : 5,
      emergencyUnlocks: hasActiveSubscription ? 10 : 2
    };
    
    res.json({
      message: 'Subscription features retrieved',
      subscription: {
        status: user.subscription_status || 'inactive',
        plan: user.subscription_plan || 'free',
        startDate: user.subscription_start_date,
        endDate: user.subscription_end_date,
        active: hasActiveSubscription
      },
      features,
      limits: planLimits,
      upgradeRecommendation: !hasActiveSubscription ? {
        message: 'Upgrade to unlock supervision and accountability features',
        recommendedPlan: '6-months',
        benefits: ['Device supervision', 'Accountability partners', 'Extended timer commitments', 'Priority support']
      } : null
    });
    
  } catch (error) {
    console.error('❌ Subscription features error:', error);
    res.status(500).json({
      error: 'Failed to get subscription features',
      message: 'An error occurred while retrieving subscription features'
    });
  }
});
module.exports = router;
