/**
 * Security tests for Token Validation
 * 
 * Tests the security aspects of token validation and certificate verification.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const TestLogger = require('../fixtures/test-logger');

const logger = new TestLogger('TEST-SEC-001', 'TokenValidation');

// Mock data for tests
const mockKeyPair = {
  privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu
NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ
agU5TGvQ2wPpscSB8PiVRyHmGAQLAgMBAAECggEADEEwgkjZfFDR84LWbNHFhbMW
xKVz0sOKwA+BKUQ6uYRSMazSuWQcKDLzS47LgOQ9nQ+5AE3R7nfZH9V9cA+jYRG8
8tOxl3/iZdKjIJgLAcNcWQfFjhS2CKtZIoMEV6fz1Y8jP6UUKxXhemI4WBxY1qKh
+NKgJtBfnbFOMQKBgQDd9GSpJXytcKg4p5tvbcWLIK5BIdzjkBIG6pjMAcTPQaW9
ZUj/KLwDiCmtUYatLCT0LtYSYMk3ETXY/Nf0PKs4Z/YvQsQ/ecZnQQouH5hSFnb7
ib2+3ZiwaiO0D8nUWxHNs6EbHsXXPmAJEDmQRsZR9V1/UQKBgQDX7z2b+7XtJPYT
4VH3QQIZlgnYQG9GCjQ/gqVQDz1qEwP2O5+Qh4VX7Ips1INpNjIQj7c5S1iV0kVX
2nxPVwjB1YL0wSnNcHjn0YSiMJtFEDMzpBuAZ4YFIJe2F5x3+UKOBJYdUIrCgqH7
YBTTegFDQKBgQCbduKXLXOWUdVHmCZtI5FGzGbQjVnBnTjEpkpfLDPRh89ZWjRvM
jGQEU3jJTVOYQYl7EesqpxJxE+cNXV/vFXZ2DL4h3G5UcyXlHNJcehXboFjv0/Cn
LfEj4kQIcO3ZR/Jyh0nfFYdGCjGEBhBIXmMJ5GcpyXSGU4eJGEBvUQKBgGTnClK8
vLgSFELU1Pzl7dEgksQUw/wOLXVfRqz8ZMlSgo1Wd5Su++EYELzCCvx+54wTu0WD
sgkOqXTRsYeOQo+x+TnDqZ8h7VRfUMwPh0f8lTjRDyyQeJXBYUzDsnDYlSlgLvB7
QQKBgAGMs8i6Exk0p1H0S7HQkIjVeZnwJ0jehHOZroUH6TPmWUhTo9VnGkZOFFeK
s5zKQzvZFYxKQKyVklQCl5vvL7oZ5752ofhODLcHpSMjYA4hMQQkRwrwuv6+Lk5+
DRqGgEhpTu5zMKZU8oKHcZ7GbKMcnfMJM8gJLI8K0ZtYyZcg
-----END PRIVATE KEY-----`,
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo
4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u
+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWWoFOUxr
0NsD6bHEgfD4lUch5hgECwIDAQAB
-----END PUBLIC KEY-----`
};

// Helper function to create a JWT
const createJWT = (payload, privateKey, options = {}) => {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h',
    ...options
  });
};

// Helper function to verify a JWT
const verifyJWT = (token, publicKey, options = {}) => {
  try {
    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      ...options
    });
  } catch (error) {
    return { error: error.message };
  }
};

describe('Token Validation Security', () => {
  beforeEach(() => {
    // Set up test environment
    jest.clearAllMocks();
    
    // Create a temporary directory for test keys if it doesn't exist
    const testKeysDir = path.join(__dirname, '../../..', 'test-keys');
    if (!fs.existsSync(testKeysDir)) {
      fs.mkdirSync(testKeysDir, { recursive: true });
    }
    
    // Write test keys to files
    fs.writeFileSync(path.join(testKeysDir, 'private.pem'), mockKeyPair.privateKey);
    fs.writeFileSync(path.join(testKeysDir, 'public.pem'), mockKeyPair.publicKey);
  });
  
  afterEach(() => {
    // Clean up test environment
    const testKeysDir = path.join(__dirname, '../../..', 'test-keys');
    if (fs.existsSync(testKeysDir)) {
      fs.unlinkSync(path.join(testKeysDir, 'private.pem'));
      fs.unlinkSync(path.join(testKeysDir, 'public.pem'));
      fs.rmdirSync(testKeysDir);
    }
  });
  
  test('should validate a properly signed JWT', () => {
    logger.info('Starting valid JWT test');
    
    // Create a payload
    const payload = {
      sub: 'https://mcp.example.org',
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Sign the payload
    const token = createJWT(payload, mockKeyPair.privateKey);
    
    // Verify the token
    const verified = verifyJWT(token, mockKeyPair.publicKey);
    
    // Check that the verification succeeded
    expect(verified).toBeTruthy();
    expect(verified.sub).toBe(payload.sub);
    expect(verified.iss).toBe(payload.iss);
    expect(verified.aud).toBe(payload.aud);
    expect(verified.jti).toBe(payload.jti);
    
    logger.info('Valid JWT test completed');
  });
  
  test('should reject a JWT with invalid signature', () => {
    logger.info('Starting invalid signature test');
    
    // Create a payload
    const payload = {
      sub: 'https://mcp.example.org',
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Generate a different key pair
    const differentKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    
    // Sign with the original private key
    const token = createJWT(payload, mockKeyPair.privateKey);
    
    // Verify with a different public key
    const verified = verifyJWT(token, differentKeyPair.publicKey);
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('invalid signature');
    
    logger.info('Invalid signature test completed');
  });
  
  test('should reject an expired JWT', () => {
    logger.info('Starting expired JWT test');
    
    // Create a payload with an expiration in the past
    const payload = {
      sub: 'https://mcp.example.org',
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Sign the payload
    const token = createJWT(payload, mockKeyPair.privateKey, { expiresIn: undefined });
    
    // Verify the token
    const verified = verifyJWT(token, mockKeyPair.publicKey);
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('jwt expired');
    
    logger.info('Expired JWT test completed');
  });
  
  test('should reject a JWT with incorrect audience', () => {
    logger.info('Starting incorrect audience test');
    
    // Create a payload
    const payload = {
      sub: 'https://mcp.example.org',
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Sign the payload
    const token = createJWT(payload, mockKeyPair.privateKey);
    
    // Verify the token with a different audience
    const verified = verifyJWT(token, mockKeyPair.publicKey, {
      audience: 'https://different-api.example.org'
    });
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('audience');
    
    logger.info('Incorrect audience test completed');
  });
  
  test('should reject a tampered JWT', () => {
    logger.info('Starting tampered JWT test');
    
    // Create a payload
    const payload = {
      sub: 'https://mcp.example.org',
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Sign the payload
    const token = createJWT(payload, mockKeyPair.privateKey);
    
    // Tamper with the token by changing the payload
    const parts = token.split('.');
    const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    decodedPayload.sub = 'https://attacker.example.org';
    parts[1] = Buffer.from(JSON.stringify(decodedPayload)).toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tamperedToken = parts.join('.');
    
    // Verify the tampered token
    const verified = verifyJWT(tamperedToken, mockKeyPair.publicKey);
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('invalid signature');
    
    logger.info('Tampered JWT test completed');
  });
});