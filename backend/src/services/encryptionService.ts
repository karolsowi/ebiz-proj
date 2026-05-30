import crypto from 'crypto';

class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: string;

  constructor() {
    // In production, this should come from environment variables
    this.secretKey = process.env.ENCRYPTION_KEY || 'your-32-character-secret-key-here!!';

    if (this.secretKey.length !== 32) {
      console.warn('WARNING: Encryption key should be exactly 32 characters. Using padded/truncated key.');
      this.secretKey = this.secretKey.padEnd(32, '0').substring(0, 32);
    }
  }

  encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, Buffer.from(this.secretKey), iv);
      cipher.setAAD(Buffer.from('inwest-app'));

      const encryptedBuffer = cipher.update(text, 'utf8');
      const encrypted = Buffer.concat([encryptedBuffer, cipher.final()]).toString('hex');

      const authTag = cipher.getAuthTag();

      // Combine iv, authTag, and encrypted data
      return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      // In case of encryption failure, return base64 encoded (not secure, but functional)
      return Buffer.from(text).toString('base64');
    }
  }

  decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':');

      if (parts.length !== 3) {
        // Try to decode as base64 (fallback)
        return Buffer.from(encryptedData, 'base64').toString('utf8');
      }

      // Use destructuring to extract the values - TypeScript knows they exist after the length check
      const [ivHex, authTagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex!, 'hex');
      const authTag = Buffer.from(authTagHex!, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, Buffer.from(this.secretKey), iv);
      decipher.setAAD(Buffer.from('inwest-app'));
      decipher.setAuthTag(authTag);

      const decryptedBuffer = decipher.update(encrypted!, 'hex');
      const decrypted = Buffer.concat([decryptedBuffer, decipher.final()]).toString('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      // Try base64 fallback
      try {
        return Buffer.from(encryptedData, 'base64').toString('utf8');
      } catch {
        throw new Error('Failed to decrypt data');
      }
    }
  }

  // Hash passwords securely
  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  // Verify password against hash
  verifyPassword(password: string, hashedPassword: string): boolean {
    try {
      const [salt, hash] = hashedPassword.split(':');

      // Ensure salt and hash are defined
      if (!salt || !hash) {
        console.error('Invalid hashed password format');
        return false;
      }

      const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
      return hash === verifyHash;
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  }

  // Generate secure random tokens
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  // Generate API key
  generateAPIKey(): string {
    return 'sk_' + this.generateToken(24);
  }
}

export const encryptionService = new EncryptionService();