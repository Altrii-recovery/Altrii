const nodemailer = require('nodemailer');

// Create Gmail SMTP transporter
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true', // false for port 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  return transporter;
};

// Test email configuration
const testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('✅ Email configuration is valid');
    return true;
  } catch (error) {
    console.error('❌ Email configuration failed:', error.message);
    return false;
  }
};

// Send email verification email
const sendVerificationEmail = async (email, firstName, verificationToken) => {
  try {
    console.log('📧 Sending verification email to:', email);
    
    const transporter = createTransporter();
    
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    const mailOptions = {
      from: {
        name: 'Altrii Recovery',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Verify Your Email - Altrii Recovery',
      html: generateVerificationEmailHTML(firstName, verificationUrl, verificationToken),
      text: generateVerificationEmailText(firstName, verificationUrl)
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Verification email sent successfully:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      verificationUrl // Include for testing
    };
    
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// Send password reset email
const sendPasswordResetEmail = async (email, firstName, resetToken) => {
  try {
    console.log('📧 Sending password reset email to:', email);
    
    const transporter = createTransporter();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: {
        name: 'Altrii Recovery',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Reset Your Password - Altrii Recovery',
      html: generatePasswordResetEmailHTML(firstName, resetUrl),
      text: generatePasswordResetEmailText(firstName, resetUrl)
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      resetUrl // Include for testing
    };
    
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// Generate HTML email template for verification
const generateVerificationEmailHTML = (firstName, verificationUrl, token) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - Altrii Recovery</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b; }
            .token-info { background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 20px 0; font-family: monospace; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🛡️ Altrii Recovery</h1>
            <p>Digital Wellness Platform</p>
        </div>
        
        <div class="content">
            <h2>Hi ${firstName || 'there'}! 👋</h2>
            
            <p>Welcome to Altrii Recovery! We're excited to help you on your digital wellness journey.</p>
            
            <p>To complete your account setup and start using our content blocking features, please verify your email address by clicking the button below:</p>
            
            <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">✅ Verify My Email</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #f1f5f9; padding: 10px; border-radius: 4px;">
                ${verificationUrl}
            </p>
            
            <div class="token-info">
                <strong>For testing purposes:</strong><br>
                Verification token: <code>${token}</code>
            </div>
            
            <p><strong>This link will expire in 24 hours</strong> for security reasons.</p>
            
            <p>If you didn't create an account with Altrii Recovery, you can safely ignore this email.</p>
            
            <div class="footer">
                <p>Best regards,<br>The Altrii Recovery Team</p>
                <p><em>Helping you build healthier digital habits</em></p>
            </div>
        </div>
    </body>
    </html>
  `;
};

// Generate plain text email for verification
const generateVerificationEmailText = (firstName, verificationUrl) => {
  return `
Hi ${firstName || 'there'}!

Welcome to Altrii Recovery! We're excited to help you on your digital wellness journey.

To complete your account setup, please verify your email address by visiting this link:

${verificationUrl}

This link will expire in 24 hours for security reasons.

If you didn't create an account with Altrii Recovery, you can safely ignore this email.

Best regards,
The Altrii Recovery Team
Helping you build healthier digital habits
  `.trim();
};

// Generate HTML email template for password reset
const generatePasswordResetEmailHTML = (firstName, resetUrl) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Reset Your Password - Altrii Recovery</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🔐 Password Reset</h1>
            <p>Altrii Recovery</p>
        </div>
        
        <div class="content">
            <h2>Hi ${firstName || 'there'}!</h2>
            
            <p>We received a request to reset your password for your Altrii Recovery account.</p>
            
            <div style="text-align: center;">
                <a href="${resetUrl}" class="button">🔑 Reset My Password</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #f1f5f9; padding: 10px; border-radius: 4px;">
                ${resetUrl}
            </p>
            
            <p><strong>This link will expire in 1 hour</strong> for security reasons.</p>
            
            <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            
            <div class="footer">
                <p>Best regards,<br>The Altrii Recovery Team</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

// Generate plain text email for password reset
const generatePasswordResetEmailText = (firstName, resetUrl) => {
  return `
Hi ${firstName || 'there'}!

We received a request to reset your password for your Altrii Recovery account.

To reset your password, visit this link:

${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, you can safely ignore this email.

Best regards,
The Altrii Recovery Team
  `.trim();
};

module.exports = {
  testEmailConfig,
  sendVerificationEmail,
  sendPasswordResetEmail
};
