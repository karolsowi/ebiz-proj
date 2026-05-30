import { Resend } from 'resend';

interface EmailVerificationData {
  email: string;
  firstName: string;
  lastName: string;
  verificationCode: string;
}

interface PasswordChangeData {
  email: string;
  firstName: string;
}

class EmailService {
  private resend: Resend;
  private fromEmail: string;
  private domain: string;

  constructor() {
    const apiKey = process.env.RE_SEND_EMAIL_API_KEY;
    if (!apiKey) {
      throw new Error('RE_SEND_EMAIL_API_KEY environment variable is required');
    }

    this.resend = new Resend(apiKey);
    this.domain = process.env.EMAIL_DOMAIN || 'inwest.com';
    this.fromEmail = `noreply@${this.domain}`;
  }

  async sendVerificationEmail(data: EmailVerificationData): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: [data.email],
        subject: 'Verify Your InWest Account',
        html: this.getVerificationEmailTemplate(data),
        text: this.getVerificationEmailText(data)
      });

      if (error) {
        console.error('Resend email error:', error);
        return { success: false, error: error.message };
      }

      console.log('Verification email sent successfully:', result?.id);
      return { success: true, messageId: result?.id };
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return { success: false, error: 'Failed to send verification email' };
    }
  }

  async sendPasswordChangeNotification(data: PasswordChangeData): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: [data.email],
        subject: 'InWest Account Password Changed',
        html: this.getPasswordChangeEmailTemplate(data),
        text: this.getPasswordChangeEmailText(data)
      });

      if (error) {
        console.error('Resend email error:', error);
        return { success: false, error: error.message };
      }

      console.log('Password change notification sent successfully:', result?.id);
      return { success: true, messageId: result?.id };
    } catch (error) {
      console.error('Failed to send password change notification:', error);
      return { success: false, error: 'Failed to send password change notification' };
    }
  }

  async sendWelcomeEmail(data: { email: string; firstName: string; lastName: string }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: [data.email],
        subject: 'Welcome to InWest!',
        html: this.getWelcomeEmailTemplate(data),
        text: this.getWelcomeEmailText(data)
      });

      if (error) {
        console.error('Resend email error:', error);
        return { success: false, error: error.message };
      }

      console.log('Welcome email sent successfully:', result?.id);
      return { success: true, messageId: result?.id };
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      return { success: false, error: 'Failed to send welcome email' };
    }
  }

  async sendEmailChangeVerification(data: {
    oldEmail: string;
    newEmail: string;
    firstName: string;
    lastName: string;
    verificationCode: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: [data.newEmail],
        subject: 'Verify Your New Email Address - InWest',
        html: this.getEmailChangeVerificationTemplate(data),
        text: this.getEmailChangeVerificationText(data)
      });

      if (error) {
        console.error('Resend email error:', error);
        return { success: false, error: error.message };
      }

      console.log('Email change verification sent successfully:', result?.id);
      return { success: true, messageId: result?.id };
    } catch (error) {
      console.error('Failed to send email change verification:', error);
      return { success: false, error: 'Failed to send email change verification' };
    }
  }

  private getVerificationEmailTemplate(data: EmailVerificationData): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your InWest Account</title>
        <style>
          .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; }
          .code { font-size: 32px; font-weight: bold; color: #059669; letter-spacing: 8px; text-align: center; background-color: #f3f4f6; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; }
          .button { display: inline-block; background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>InWest</h1>
            <p>Investment Tracking Platform</p>
          </div>
          <div class="content">
            <h2>Verify Your Email Address</h2>
            <p>Hello ${data.firstName},</p>
            <p>Thank you for signing up for InWest! To complete your account setup, please verify your email address by entering the verification code below:</p>
            
            <div class="code">${data.verificationCode}</div>
            
            <p>This code will expire in 15 minutes for security purposes.</p>
            <p>If you didn't create an InWest account, please ignore this email.</p>
            
            <p>Best regards,<br>The InWest Team</p>
          </div>
          <div class="footer">
            <p>© 2025 InWest. All rights reserved.</p>
            <p>This email was sent from a notification-only address that cannot accept incoming email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getVerificationEmailText(data: EmailVerificationData): string {
    return `
      Verify Your InWest Account
      
      Hello ${data.firstName},
      
      Thank you for signing up for InWest! To complete your account setup, please verify your email address by entering this verification code:
      
      ${data.verificationCode}
      
      This code will expire in 15 minutes for security purposes.
      
      If you didn't create an InWest account, please ignore this email.
      
      Best regards,
      The InWest Team
      
      © 2025 InWest. All rights reserved.
    `;
  }

  private getPasswordChangeEmailTemplate(data: PasswordChangeData): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed - InWest</title>
        <style>
          .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; }
          .alert { background-color: #fef3c7; border: 1px solid #d97706; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>InWest</h1>
            <p>Security Notification</p>
          </div>
          <div class="content">
            <h2>Password Changed Successfully</h2>
            <p>Hello ${data.firstName},</p>
            <p>This email confirms that your InWest account password was changed successfully on ${new Date().toLocaleString()}.</p>
            
            <div class="alert">
              <strong>Important:</strong> If you didn't make this change, please contact our support team immediately at support@inwest.com
            </div>
            
            <p>For your security, we recommend:</p>
            <ul>
              <li>Using a unique, strong password</li>
              <li>Enabling two-factor authentication</li>
              <li>Keeping your account information up to date</li>
            </ul>
            
            <p>Best regards,<br>The InWest Security Team</p>
          </div>
          <div class="footer">
            <p>© 2025 InWest. All rights reserved.</p>
            <p>This email was sent from a notification-only address that cannot accept incoming email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getPasswordChangeEmailText(data: PasswordChangeData): string {
    return `
      Password Changed - InWest Security Notification
      
      Hello ${data.firstName},
      
      This email confirms that your InWest account password was changed successfully on ${new Date().toLocaleString()}.
      
      IMPORTANT: If you didn't make this change, please contact our support team immediately at support@inwest.com
      
      For your security, we recommend:
      - Using a unique, strong password
      - Enabling two-factor authentication
      - Keeping your account information up to date
      
      Best regards,
      The InWest Security Team
      
      © 2025 InWest. All rights reserved.
    `;
  }

  private getWelcomeEmailTemplate(data: { email: string; firstName: string; lastName: string }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to InWest!</title>
        <style>
          .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; }
          .button { display: inline-block; background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
          .features { background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to InWest!</h1>
            <p>Your Investment Tracking Journey Begins</p>
          </div>
          <div class="content">
            <h2>Hello ${data.firstName}!</h2>
            <p>Welcome to InWest! We're excited to have you join our community of smart investors.</p>
            
            <div class="features">
              <h3>🚀 Get Started:</h3>
              <ul>
                <li><strong>Set up your portfolio:</strong> Connect your trading accounts and start tracking</li>
                <li><strong>Monitor market sentiment:</strong> Get insights from Reddit and news analysis</li>
                <li><strong>Track performance:</strong> Analyze your trading performance with detailed analytics</li>
                <li><strong>Stay informed:</strong> Get real-time market data and alerts</li>
              </ul>
            </div>
            
            <p>Ready to start your investment tracking journey?</p>
            <a href="https://inwest.com/account/profile" class="button">Complete Your Profile</a>
            
            <p>If you have any questions, our support team is here to help at support@inwest.com</p>
            
            <p>Happy investing!<br>The InWest Team</p>
          </div>
          <div class="footer">
            <p>© 2025 InWest. All rights reserved.</p>
            <p>This email was sent from a notification-only address that cannot accept incoming email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getWelcomeEmailText(data: { email: string; firstName: string; lastName: string }): string {
    return `
      Welcome to InWest!
      
      Hello ${data.firstName}!
      
      Welcome to InWest! We're excited to have you join our community of smart investors.
      
      Get Started:
      - Set up your portfolio: Connect your trading accounts and start tracking
      - Monitor market sentiment: Get insights from Reddit and news analysis
      - Track performance: Analyze your trading performance with detailed analytics
      - Stay informed: Get real-time market data and alerts
      
      Visit https://inwest.com/account/profile to complete your profile.
      
      If you have any questions, our support team is here to help at support@inwest.com
      
      Happy investing!
      The InWest Team
      
      © 2025 InWest. All rights reserved.
    `;
  }

  private getEmailChangeVerificationTemplate(data: {
    oldEmail: string;
    newEmail: string;
    firstName: string;
    lastName: string;
    verificationCode: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your New Email Address - InWest</title>
        <style>
          .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; }
          .code { font-size: 32px; font-weight: bold; color: #059669; letter-spacing: 8px; text-align: center; background-color: #f3f4f6; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .alert { background-color: #fef3c7; border: 1px solid #d97706; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>InWest</h1>
            <p>Email Change Verification</p>
          </div>
          <div class="content">
            <h2>Verify Your New Email Address</h2>
            <p>Hello ${data.firstName},</p>
            <p>You've requested to change your email address from <strong>${data.oldEmail}</strong> to <strong>${data.newEmail}</strong>.</p>
            
            <p>To complete this change, please verify your new email address by entering the verification code below:</p>
            
            <div class="code">${data.verificationCode}</div>
            
            <div class="alert">
              <strong>Important:</strong> This code will expire in 15 minutes. If you didn't request this change, please ignore this email and contact our support team.
            </div>
            
            <p>Once verified, all future communications will be sent to your new email address.</p>
            
            <p>Best regards,<br>The InWest Team</p>
          </div>
          <div class="footer">
            <p>© 2025 InWest. All rights reserved.</p>
            <p>This email was sent from a notification-only address that cannot accept incoming email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getEmailChangeVerificationText(data: {
    oldEmail: string;
    newEmail: string;
    firstName: string;
    lastName: string;
    verificationCode: string;
  }): string {
    return `
      Verify Your New Email Address - InWest
      
      Hello ${data.firstName},
      
      You've requested to change your email address from ${data.oldEmail} to ${data.newEmail}.
      
      To complete this change, please verify your new email address by entering this verification code:
      
      ${data.verificationCode}
      
      IMPORTANT: This code will expire in 15 minutes. If you didn't request this change, please ignore this email and contact our support team.
      
      Once verified, all future communications will be sent to your new email address.
      
      Best regards,
      The InWest Team
      
      © 2025 InWest. All rights reserved.
    `;
  }

  generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const emailService = new EmailService();