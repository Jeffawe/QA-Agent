import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SECRET_KEY = process.env.ENCRYPTION_SECRET || 'your-secret-key-min-32-chars-long';

// Interface for encrypted data
export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

const encrypt = (text: string): EncryptedData => {
  try {
    // Derive a 32-byte key from the secret
    const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
    
    // Generate a random 16-byte IV (Initialization Vector)
    const iv = crypto.randomBytes(16);
    
    // Create cipher with algorithm, key, and IV
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag for GCM mode
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('❌ Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

const decrypt = (encryptedData: EncryptedData): string => {
  try {
    // Derive the same key
    const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
    
    // Convert hex strings back to buffers
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    
    // Create decipher with algorithm, key, and IV
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    // Set the authentication tag for verification
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error);
    throw new Error('Failed to decrypt data - invalid key or corrupted data');
  }
};

// Utility function to validate encryption secret
const validateEncryptionSecret = (): void => {
  if (!SECRET_KEY || SECRET_KEY.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be at least 32 characters long');
  }
};

// Test function to verify encryption/decryption works
const testEncryption = (): boolean => {
  try {
    const testText = 'test-api-key-12345';
    const encrypted = encrypt(testText);
    const decrypted = decrypt(encrypted);
    
    console.log('🔐 Encryption test:', {
      original: testText,
      encrypted: encrypted.encrypted.substring(0, 20) + '...',
      decrypted: decrypted,
      success: testText === decrypted
    });
    
    return testText === decrypted;
  } catch (error) {
    console.error('❌ Encryption test failed:', error);
    return false;
  }
};

// Initialize and validate on module load
validateEncryptionSecret();

export { encrypt, decrypt, testEncryption };