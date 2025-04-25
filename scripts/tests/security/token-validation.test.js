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
  privateKey: null,
  publicKey: null
};

// Generate a key pair for testing
const generateKeyPair = () => {
  const keyPair = crypto.generateKeyPairSync('rsa', {
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
  
  mockKeyPair.privateKey = keyPair.privateKey;
  mockKeyPair.publicKey = keyPair.publicKey;
};

// Helper function to create a JWT
const createJWT = (payload, privateKey, options = {}) => {
  // Don't set expiresIn if the payload already has exp
  const hasExp = payload && typeof payload === 'object' && payload.exp !== undefined;
  
  const signOptions = {
    algorithm: 'RS256',
    ...options
  };
  
  // Only add expiresIn if exp is not in the payload and expiresIn is not in options
  if (!hasExp && options.expiresIn === undefined) {
    signOptions.expiresIn = '1h';
  }
  
  return jwt.sign(payload, privateKey, signOptions);
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
    
    // Generate a fresh key pair for each test
    generateKeyPair();
  });
  
  afterEach(() => {
    // Reset key pair
    mockKeyPair.privateKey = null;
    mockKeyPair.publicKey = null;
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
    
    // Sign the payload - don't pass any options to avoid conflicts with exp in payload
    const token = createJWT(payload, mockKeyPair.privateKey, {});
    
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
  test('should reject a request with missing JWT', () => {
    logger.info('Starting missing JWT test');

    // Simulate a request without a token
    const token = undefined; // Or null, or an empty string depending on how the server handles it

    // Attempt to verify the missing token (this is a simplified test, the actual server logic would handle this)
    // In a real scenario, this would involve making an HTTP request to a protected endpoint without the Authorization header.
    // For this unit test, we'll simulate the verification failure.
    const verified = verifyJWT(token, mockKeyPair.publicKey);

    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('jwt must be provided');

    logger.info('Missing JWT test completed');
  });
  
  test('should reject a malformed JWT', () => {
    logger.info('Starting malformed JWT test');
    
    // Create a malformed token (not a valid JWT format)
    const malformedToken = 'this-is-not-a-valid-jwt-token';
    
    // Attempt to verify the malformed token
    const verified = verifyJWT(malformedToken, mockKeyPair.publicKey);
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('jwt malformed');
    
    logger.info('Malformed JWT test completed');
  });
  
  test('should reject a JWT with invalid claims', () => {
    logger.info('Starting invalid claims test');
    
    // Create a payload with missing required claims
    const payload = {
      // Missing 'sub' claim
      iss: 'https://federation.example.org',
      aud: 'https://api.example.org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Sign the payload
    const token = createJWT(payload, mockKeyPair.privateKey);
    
    // Verify the token with required claims check
    const verified = verifyJWT(token, mockKeyPair.publicKey, {
      complete: true,
      subject: 'https://mcp.example.org' // Required subject that doesn't match
    });
    
    // Check that the verification failed
    expect(verified.error).toBeDefined();
    expect(verified.error).toContain('jwt subject invalid');
    
    logger.info('Invalid claims test completed');
  });
});