import { Router, Request, Response } from 'express';
import { userService } from '../services/userService';
import { requireAuth } from '../middleware/authMiddleware.js';
import { getIntegrationStatus } from '../services/credentialResolver.js';

const router = Router();

router.use(requireAuth);

function getCurrentUserId(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return userId;
}

// Get user profile
router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const profile = await userService.getUserProfile(userId);
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const profileData = req.body;

    const updatedProfile = await userService.updateUserProfile(userId, profileData);
    res.json(updatedProfile);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user settings
router.get('/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const settings = await userService.getUserSettings(userId);
    res.json(settings);
  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update user settings
router.put('/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const settingsData = req.body;

    const updatedSettings = await userService.updateUserSettings(userId, settingsData);
    res.json(updatedSettings);
  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Which integrations the current user has configured in DB (not .env)
router.get('/integrations', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const integrations = await getIntegrationStatus(userId);
    const canFetchNews =
      integrations.news || integrations.finnhub;
    res.json({
      integrations,
      canFetchNews,
      canManageReddit: integrations.reddit,
      canUseAlpaca: integrations.alpaca,
    });
  } catch (error) {
    console.error('Error fetching integration status:', error);
    res.status(500).json({ error: 'Failed to fetch integration status' });
  }
});

// Get API keys (decrypted for display)
router.get('/api-keys', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const apiKeys = await userService.getUserAPIKeys(userId);
    res.json(apiKeys);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Add new API key
router.post('/api-keys', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { name, service, apiKey, secretKey, paperTrading } = req.body;

    if (!name || !service || !apiKey) {
      res.status(400).json({ error: 'Missing required fields: name, service, apiKey' });
      return;
    }

    const newApiKey = await userService.addAPIKey(userId, {
      name,
      service,
      apiKey,
      secretKey,
      paperTrading
    });

    res.status(201).json(newApiKey);
  } catch (error) {
    console.error('Error adding API key:', error);
    res.status(500).json({ error: 'Failed to add API key' });
  }
});

// Update API key
router.put('/api-keys/:keyId', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { keyId } = req.params;
    const updateData = req.body;

    if (!keyId) {
      res.status(400).json({ error: 'API key ID is required' });
      return;
    }

    const updatedKey = await userService.updateAPIKey(userId, keyId, updateData);
    if (!updatedKey) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    res.json(updatedKey);
  } catch (error) {
    console.error('Error updating API key:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Delete API key
router.delete('/api-keys/:keyId', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { keyId } = req.params;

    if (!keyId) {
      res.status(400).json({ error: 'API key ID is required' });
      return;
    }

    const deleted = await userService.deleteAPIKey(userId, keyId);
    if (!deleted) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    res.json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Get security settings
router.get('/security', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const security = await userService.getSecuritySettings(userId);
    res.json(security);
  } catch (error) {
    console.error('Error fetching security settings:', error);
    res.status(500).json({ error: 'Failed to fetch security settings' });
  }
});

// Enable 2FA
router.post('/security/2fa/enable', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const result = await userService.enable2FA(userId);
    res.json(result);
  } catch (error) {
    console.error('Error enabling 2FA:', error);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// Disable 2FA
router.post('/security/2fa/disable', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { password } = req.body;

    if (!password) {
      res.status(400).json({ error: 'Password required to disable 2FA' });
      return;
    }

    const result = await userService.disable2FA(userId, password);
    res.json(result);
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// Change password
router.put('/change-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Both current and new passwords are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long' });
      return;
    }

    const result = await userService.changePassword(userId, currentPassword, newPassword);
    res.json(result);
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Send verification email
router.post('/send-verification', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, firstName, lastName } = req.body;

    if (!email || !firstName || !lastName) {
      res.status(400).json({ error: 'Email, first name, and last name are required' });
      return;
    }

    const result = await userService.sendVerificationEmail(email, firstName, lastName);
    res.json(result);
  } catch (error) {
    console.error('Error sending verification email:', error);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Verify email
router.post('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, verificationCode } = req.body;

    if (!email || !verificationCode) {
      res.status(400).json({ error: 'Email and verification code are required' });
      return;
    }

    const result = await userService.verifyEmail(email, verificationCode);
    res.json(result);
  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Create account
router.post('/create-account', async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, emailVerified } = req.body;

    if (!firstName || !lastName || !email || !password) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long' });
      return;
    }

    const result = await userService.createAccount({
      firstName,
      lastName,
      email,
      password,
      emailVerified: emailVerified || false
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Send email change verification
router.post('/send-email-change-verification', async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldEmail, newEmail, firstName, lastName } = req.body;

    if (!oldEmail || !newEmail || !firstName || !lastName) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (oldEmail === newEmail) {
      res.status(400).json({ error: 'New email must be different from current email' });
      return;
    }

    const result = await userService.sendEmailChangeVerification(oldEmail, newEmail, firstName, lastName);
    res.json(result);
  } catch (error) {
    console.error('Error sending email change verification:', error);
    res.status(500).json({ error: 'Failed to send email change verification' });
  }
});

// Verify email change
router.post('/verify-email-change', async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldEmail, newEmail, verificationCode } = req.body;

    if (!oldEmail || !newEmail || !verificationCode) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    const result = await userService.verifyEmailChange(oldEmail, newEmail, verificationCode);
    res.json(result);
  } catch (error) {
    console.error('Error verifying email change:', error);
    res.status(500).json({ error: 'Failed to verify email change' });
  }
});

export default router;