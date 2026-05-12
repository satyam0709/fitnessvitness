const { sendEmailWithRetry } = require('./emailService');

/**
 * Send workspace created email via Resend
 */
async function sendWorkspaceCreatedEmail({ adminEmail, companyName, subdomain, tenantId }) {
  console.log('📧 resendEmailService: Sending workspace created email to', adminEmail);

  const workspaceUrl = `https://${subdomain}.${process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN || '365rndcrm.vercel.app'}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px; background: #f9fafb; }
          .card { background: white; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 32px; }
          .title { font-size: 24px; font-weight: bold; color: #1f2937; margin: 0; }
          .subtitle { color: #6b7280; font-size: 16px; margin: 8px 0 0; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; }
          .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
          .detail-label { color: #6b7280; font-weight: 500; }
          .detail-value { color: #1f2937; }
          .footer { margin-top: 32px; text-align: center; color: #9ca3af; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1 class="title">Welcome to ${companyName}!</h1>
              <p class="subtitle">Your CRM workspace has been created</p>
            </div>
            
            <p style="color: #374151; margin-bottom: 24px;">
              Hi there,<br><br>
              Your workspace is ready! Click the button below to choose your package and activate your CRM.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="https://${subdomain}/add-package?tenant_id=${tenantId}" class="button">
                Complete Setup & Choose Package
              </a>
            </div>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 6px; margin: 24px 0;">
              <h3 style="margin: 0 0 16px; color: #1f2937;">Workspace Details:</h3>
              <div class="detail-row">
                <span class="detail-label">🏢 Workspace URL:</span>
                <span class="detail-value">${subdomain}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">📧 Admin Email:</span>
                <span class="detail-value">${adminEmail}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">✅ Status:</span>
                <span class="detail-value" style="color: #f59e0b;">Pending Payment</span>
              </div>
            </div>
            
            <p style="color: #374151; margin-bottom: 16px;">
              <strong>Next Steps:</strong><br>
              1. Click the button above<br>
              2. Select your package<br>
              3. Complete payment to activate
            </p>
            
            <div class="footer">
              <p>Need help? Contact us at support@yourcrm.com</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  
  try {
    const result = await sendEmailWithRetry({
      to: adminEmail,
      subject: `Welcome to ${companyName} CRM! Complete Your Setup →`,
      html,
      text: `Welcome to ${companyName}! Your workspace is ready at ${workspaceUrl}. Complete setup: https://${subdomain}/add-package?tenant_id=${tenantId}`,
    });
    
    if (!result.ok) {
      console.error('Email API error:', result);
      return { ok: false, error: result.reason || 'Failed to send' };
    }
    
    console.log('✅ Workspace created email sent successfully');
    return { ok: true, data: result };
  } catch (error) {
    console.error('❌ Failed to send workspace email:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Send payment success email via Resend
 */
async function sendPaymentSuccessEmail({ adminEmail, companyName, subdomain, plan, workspaceUrl, trialEndsAt }) {
  console.log('📧 resendEmailService: Sending payment success email to', adminEmail);
  
  const planName = plan === 'free_trial' ? 'Free Trial (14 days)' : 
                   plan === 'starter' ? 'Starter Plan' : 'Professional Plan';
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px; background: #f3f4f6; }
          .card { background: white; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .success-icon { width: 80px; height: 80px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
          .checkmark { color: white; font-size: 48px; font-weight: bold; }
          .title { font-size: 28px; font-weight: bold; color: #1f2937; margin: 0 0 8px; text-align: center; }
          .subtitle { color: #6b7280; font-size: 16px; margin: 0 0 32px; text-align: center; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; }
          .detail-row { display: flex; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #e5e7eb; }
          .detail-label { color: #6b7280; font-weight: 500; }
          .detail-value { color: #1f2937; font-weight: 500; }
          .status-badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 6px 12px; border-radius: 6px; font-weight: 600; }
          .footer { margin-top: 32px; text-align: center; color: #9ca3af; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="success-icon">
              <span class="checkmark">✓</span>
            </div>
            
            <h1 class="title">Payment Successful!</h1>
            <p class="subtitle">Your CRM is now active and ready to use ✅</p>
            
            <div style="text-align: center; margin: 32px 0;">
              <span class="status-badge">✅ Active</span>
            </div>
            
            <div style="background: #f9fafb; padding: 24px; border-radius: 8px; margin: 24px 0;">
              <h3 style="margin: 0 0 20px; color: #1f2937;">Your Workspace Details:</h3>
              <div class="detail-row">
                <span class="detail-label">📧 Admin Email:</span>
                <span class="detail-value">${adminEmail}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">🏢 Workspace URL:</span>
                <span class="detail-value">${subdomain}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">📦 Plan:</span>
                <span class="detail-value">${planName}</span>
              </div>
              ${trialEndsAt ? `
              <div class="detail-row">
                <span class="detail-label">📅 Trial Ends:</span>
                <span class="detail-value" style="color: #f59e0b;">${new Date(trialEndsAt).toLocaleDateString()}</span>
              </div>
              ` : ''}
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${workspaceUrl}/login" class="button">
                Login to Dashboard
              </a>
            </div>
            
            <div class="footer">
              <p>Need help? Contact us at support@yourcrm.com</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  
  try {
    const result = await sendEmailWithRetry({
      to: adminEmail,
      subject: `Payment Successful - ${companyName} CRM is Active! `,
      html,
      text: `Payment successful! Your workspace is active at ${workspaceUrl}. Log in now: ${workspaceUrl}/login`,
    });
    
    if (!result.ok) {
      console.error('Email API error:', result);
      return { ok: false, error: result.reason || 'Failed to send' };
    }
    
    console.log('✅ Payment success email sent successfully');
    return { ok: true, data: result };
  } catch (error) {
    console.error('❌ Failed to send payment success email:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  sendWorkspaceCreatedEmail,
  sendPaymentSuccessEmail
};
