const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');

// Enhanced createSubscription function
async function createSubscription(customerId, priceId) {
  try {
    console.log('🔄 Stripe createSubscription called with:', { customerId, priceId });
    
    if (!customerId || !priceId) {
      throw new Error('Customer ID and Price ID are required');
    }
    
    // Verify the price exists
    let price;
    try {
      price = await stripe.prices.retrieve(priceId);
      console.log('✅ Price verified:', price.id);
    } catch (priceError) {
      console.error('❌ Invalid price ID:', priceId, priceError.message);
      throw new Error(`Invalid price ID: ${priceId}`);
    }
    
    // Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price: priceId,
      }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });
    
    console.log('✅ Stripe subscription created:', {
      id: subscription.id,
      status: subscription.status,
      hasPaymentIntent: !!subscription.latest_invoice?.payment_intent
    });
    
    const result = {
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status
    };
    
    // Add client secret if payment intent exists
    if (subscription.latest_invoice?.payment_intent?.client_secret) {
      result.clientSecret = subscription.latest_invoice.payment_intent.client_secret;
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Stripe createSubscription error:', error.message);
    console.error('❌ Error details:', error);
    
    return {
      success: false,
      error: error.message || 'Failed to create subscription'
    };
  }
}

// Create Stripe customer
async function createStripeCustomer(email, name, userId) {
  try {
    console.log('🆕 Creating Stripe customer:', { email, name, userId });
    
    const customer = await stripe.customers.create({
      email: email,
      name: name || undefined,
      metadata: {
        userId: userId.toString()
      }
    });
    
    console.log('✅ Stripe customer created:', customer.id);
    
    return {
      success: true,
      customerId: customer.id
    };
    
  } catch (error) {
    console.error('❌ Stripe customer creation error:', error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to create customer'
    };
  }
}

// Get user subscription
async function getUserSubscription(userId) {
  try {
    console.log('📋 Getting subscription for user:', userId);
    
    // Get subscription ID from database
    const result = await pool.query(
      'SELECT stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].stripe_subscription_id) {
      return {
        success: false,
        error: 'No subscription found for user'
      };
    }
    
    const subscriptionId = result.rows[0].stripe_subscription_id;
    
    // Get subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent']
    });
    
    console.log('✅ Subscription retrieved:', subscription.id);
    
    return {
      success: true,
      subscription: subscription
    };
    
  } catch (error) {
    console.error('❌ Get subscription error:', error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to get subscription'
    };
  }
}

// Cancel subscription
async function cancelSubscription(subscriptionId, immediate = false) {
  try {
    console.log('🚫 Canceling subscription:', { subscriptionId, immediate });
    
    let subscription;
    
    if (immediate) {
      // Cancel immediately
      subscription = await stripe.subscriptions.cancel(subscriptionId);
    } else {
      // Cancel at period end
      subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
      });
    }
    
    console.log('✅ Subscription canceled:', subscription.id);
    
    return {
      success: true,
      subscription: subscription
    };
    
  } catch (error) {
    console.error('❌ Cancel subscription error:', error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to cancel subscription'
    };
  }
}

// Create billing portal session
async function createBillingPortalSession(customerId, returnUrl) {
  try {
    console.log('🏪 Creating billing portal session:', { customerId, returnUrl });
    
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    
    console.log('✅ Billing portal session created:', session.id);
    
    return {
      success: true,
      url: session.url
    };
    
  } catch (error) {
    console.error('❌ Billing portal error:', error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to create billing portal session'
    };
  }
}

// Process webhook events
async function processWebhookEvent(event) {
  try {
    console.log('🔔 Processing webhook event:', event.type);
    
    switch (event.type) {
      case 'customer.subscription.created':
        return await handleSubscriptionCreated(event.data.object);
        
      case 'customer.subscription.updated':
        return await handleSubscriptionUpdated(event.data.object);
        
      case 'customer.subscription.deleted':
        return await handleSubscriptionDeleted(event.data.object);
        
      case 'invoice.payment_succeeded':
        return await handlePaymentSucceeded(event.data.object);
        
      case 'invoice.payment_failed':
        return await handlePaymentFailed(event.data.object);
        
      default:
        console.log('👋 Unhandled webhook event type:', event.type);
        return { success: true, message: 'Event type not handled' };
    }
    
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to process webhook event'
    };
  }
}

// Webhook event handlers
async function handleSubscriptionCreated(subscription) {
  try {
    console.log('✅ Handling subscription created:', subscription.id);
    
    const customerId = subscription.customer;
    
    // Find user by customer ID
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );
    
    if (result.rows.length === 0) {
      console.warn('⚠️  No user found for customer:', customerId);
      return { success: true, message: 'No user found for customer' };
    }
    
    const userId = result.rows[0].id;
    
    // Update user subscription status
    await pool.query(`
      UPDATE users 
      SET 
        stripe_subscription_id = $1,
        subscription_status = $2,
        subscription_start_date = $3,
        subscription_end_date = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `, [
      subscription.id,
      subscription.status,
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      userId
    ]);
    
    console.log('✅ User subscription updated for created event');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Handle subscription created error:', error.message);
    return { success: false, error: error.message };
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    console.log('🔄 Handling subscription updated:', subscription.id);
    
    const customerId = subscription.customer;
    
    // Find user by customer ID
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );
    
    if (result.rows.length === 0) {
      console.warn('⚠️  No user found for customer:', customerId);
      return { success: true, message: 'No user found for customer' };
    }
    
    const userId = result.rows[0].id;
    
    // Update user subscription status
    await pool.query(`
      UPDATE users 
      SET 
        subscription_status = $1,
        subscription_start_date = $2,
        subscription_end_date = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [
      subscription.status,
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      userId
    ]);
    
    console.log('✅ User subscription updated for updated event');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Handle subscription updated error:', error.message);
    return { success: false, error: error.message };
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    console.log('🗑️  Handling subscription deleted:', subscription.id);
    
    const customerId = subscription.customer;
    
    // Find user by customer ID
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );
    
    if (result.rows.length === 0) {
      console.warn('⚠️  No user found for customer:', customerId);
      return { success: true, message: 'No user found for customer' };
    }
    
    const userId = result.rows[0].id;
    
    // Update user subscription status
    await pool.query(`
      UPDATE users 
      SET 
        subscription_status = 'canceled',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [userId]);
    
    console.log('✅ User subscription marked as canceled');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Handle subscription deleted error:', error.message);
    return { success: false, error: error.message };
  }
}

async function handlePaymentSucceeded(invoice) {
  try {
    console.log('💰 Handling payment succeeded:', invoice.id);
    
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;
    
    // Find user by customer ID
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );
    
    if (result.rows.length === 0) {
      console.warn('⚠️  No user found for customer:', customerId);
      return { success: true, message: 'No user found for customer' };
    }
    
    const userId = result.rows[0].id;
    
    // Update subscription status to active if payment succeeded
    await pool.query(`
      UPDATE users 
      SET 
        subscription_status = 'active',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND stripe_subscription_id = $2
    `, [userId, subscriptionId]);
    
    console.log('✅ User subscription activated after successful payment');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Handle payment succeeded error:', error.message);
    return { success: false, error: error.message };
  }
}

async function handlePaymentFailed(invoice) {
  try {
    console.log('❌ Handling payment failed:', invoice.id);
    
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;
    
    // Find user by customer ID
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );
    
    if (result.rows.length === 0) {
      console.warn('⚠️  No user found for customer:', customerId);
      return { success: true, message: 'No user found for customer' };
    }
    
    const userId = result.rows[0].id;
    
    // Update subscription status to past_due if payment failed
    await pool.query(`
      UPDATE users 
      SET 
        subscription_status = 'past_due',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND stripe_subscription_id = $2
    `, [userId, subscriptionId]);
    
    console.log('⚠️  User subscription marked as past due after failed payment');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Handle payment failed error:', error.message);
    return { success: false, error: error.message };
  }
}

// Test Stripe configuration function
async function testStripeConfig() {
  try {
    console.log('🔍 Testing Stripe configuration...');
    
    // Check if Stripe secret key is set
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    
    // Test Stripe connection by retrieving account info
    const account = await stripe.account.retrieve();
    
    console.log('✅ Stripe configuration is valid');
    console.log(`📊 Stripe Account ID: ${account.id}`);
    console.log(`🌍 Account Country: ${account.country}`);
    console.log(`💼 Account Type: ${account.type}`);
    
    // Test price IDs if they exist
    const priceIds = {
      oneMonth: process.env.STRIPE_PRICE_ID_1_MONTH,
      threeMonths: process.env.STRIPE_PRICE_ID_3_MONTHS,
      sixMonths: process.env.STRIPE_PRICE_ID_6_MONTHS,
      oneYear: process.env.STRIPE_PRICE_ID_1_YEAR
    };
    
    let validPrices = 0;
    let invalidPrices = 0;
    
    for (const [period, priceId] of Object.entries(priceIds)) {
      if (priceId) {
        try {
          const price = await stripe.prices.retrieve(priceId);
          console.log(`✅ ${period} price (${priceId}): ${price.unit_amount/100} ${price.currency.toUpperCase()}`);
          validPrices++;
        } catch (priceError) {
          console.warn(`⚠️  ${period} price (${priceId}): Invalid - ${priceError.message}`);
          invalidPrices++;
        }
      } else {
        console.warn(`⚠️  ${period} price: Not configured`);
      }
    }
    
    if (invalidPrices > 0) {
      console.warn(`⚠️  ${invalidPrices} price ID(s) are invalid or not configured`);
    }
    
    return {
      success: true,
      account: {
        id: account.id,
        country: account.country,
        type: account.type
      },
      prices: {
        valid: validPrices,
        invalid: invalidPrices
      }
    };
    
  } catch (error) {
    console.error('❌ Stripe configuration test failed:', error.message);
    
    // Don't crash the server, just log the error
    return {
      success: false,
      error: error.message
    };
  }
}

// Export all functions
module.exports = {
  stripe,
  createStripeCustomer,
  createSubscription,
  getUserSubscription,
  cancelSubscription,
  createBillingPortalSession,
  processWebhookEvent,
  testStripeConfig
};
