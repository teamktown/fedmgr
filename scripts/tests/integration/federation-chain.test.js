/**
 * Integration tests for Federation Chain Validation
 * 
 * Tests the validation of federation chains, ensuring that entity statements
 * are properly verified through the chain of trust.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const TestLogger = require('../fixtures/test-logger');

const logger = new TestLogger('TEST-INT-002', 'FederationChain');

// Mock data for tests
const mockKeyPairs = {
  federation: {
    privateKey: null,
    publicKey: null
  },
  member: {
    privateKey: null,
    publicKey: null
  }
};

// Generate test key pairs
const generateKeyPairs = () => {
  // Generate federation key pair
  const federationKeyPair = crypto.generateKeyPairSync('rsa', {
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
  
  mockKeyPairs.federation.privateKey = federationKeyPair.privateKey;
  mockKeyPairs.federation.publicKey = federationKeyPair.publicKey;
  
  // Generate member key pair
  const memberKeyPair = crypto.generateKeyPairSync('rsa', {
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
  
  mockKeyPairs.member.privateKey = memberKeyPair.privateKey;
  mockKeyPairs.member.publicKey = memberKeyPair.publicKey;
};

// Helper function to create a signed entity statement
const createEntityStatement = (issuer, subject, payload, privateKey, options = {}) => {
  const statement = {
    iss: issuer,
    sub: subject,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    jwks: {
      keys: [
        {
          kid: 'test-key-1',
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          n: 'test-n',
          e: 'AQAB'
        }
      ]
    },
    metadata: {
      federation_entity: {
        name: 'Test Entity',
        contacts: ['admin@example.org']
      }
    },
    ...payload
  };

  // Don't set expiresIn since we already have exp in the payload
  const signOptions = {
    algorithm: 'RS256',
    ...options
  };
  
  // Remove expiresIn if it exists in options to avoid conflicts with exp in payload
  if (signOptions.expiresIn !== undefined) {
    delete signOptions.expiresIn;
  }

  return jwt.sign(statement, privateKey, signOptions);
};

// Helper function to verify an entity statement
const verifyEntityStatement = (token, publicKey, options = {}) => {
  try {
    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      ...options
    });
  } catch (error) {
    return { error: error.message };
  }
};

describe('Federation Chain Validation', () => {
  beforeEach(() => {
    // Set up test environment
    jest.clearAllMocks();
    
    // Generate fresh key pairs for each test
    generateKeyPairs();
  });
  
  afterEach(() => {
    // Reset key pairs
    mockKeyPairs.federation.privateKey = null;
    mockKeyPairs.federation.publicKey = null;
    mockKeyPairs.member.privateKey = null;
    mockKeyPairs.member.publicKey = null;
  });
  
  test('should validate a properly signed federation chain', () => {
    logger.info('Starting valid federation chain test');
    
    // Create a federation entity statement
    const federationIssuer = 'https://federation.example.org';
    const memberSubject = 'https://member.example.org';
    
    const federationStatement = createEntityStatement(
      federationIssuer,
      memberSubject,
      {
        metadata_policy: {
          federation_entity: {
            contacts: {
              add: 'support@example.org'
            }
          }
        }
      },
      mockKeyPairs.federation.privateKey
    );
    
    // Verify the federation statement
    const verifiedStatement = verifyEntityStatement(
      federationStatement,
      mockKeyPairs.federation.publicKey
    );
    
    // Check that the verification succeeded
    expect(verifiedStatement).toBeTruthy();
    expect(verifiedStatement.iss).toBe(federationIssuer);
    expect(verifiedStatement.sub).toBe(memberSubject);
    expect(verifiedStatement.metadata_policy).toBeDefined();
    
    logger.info('Valid federation chain test completed');
  });
  
  test('should reject a federation chain with invalid signature', () => {
    logger.info('Starting invalid signature test');
    
    // Create a federation entity statement
    const federationIssuer = 'https://federation.example.org';
    const memberSubject = 'https://member.example.org';
    
    const federationStatement = createEntityStatement(
      federationIssuer,
      memberSubject,
      {},
      mockKeyPairs.federation.privateKey
    );
    
    // Verify with the wrong public key
    const verifiedStatement = verifyEntityStatement(
      federationStatement,
      mockKeyPairs.member.publicKey // Using the wrong key
    );
    
    // Check that the verification failed
    expect(verifiedStatement.error).toBeDefined();
    expect(verifiedStatement.error).toContain('invalid signature');
    
    logger.info('Invalid signature test completed');
  });
  
  test('should reject an expired federation statement', () => {
    logger.info('Starting expired statement test');
    
    // Create an expired federation entity statement
    const federationIssuer = 'https://federation.example.org';
    const memberSubject = 'https://member.example.org';
    
    const expiredStatement = createEntityStatement(
      federationIssuer,
      memberSubject,
      {
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600  // 1 hour ago
      },
      mockKeyPairs.federation.privateKey,
      {} // Don't pass any options to avoid conflicts with exp in payload
    );
    
    // Verify the expired statement
    const verifiedStatement = verifyEntityStatement(
      expiredStatement,
      mockKeyPairs.federation.publicKey
    );
    
    // Check that the verification failed
    expect(verifiedStatement.error).toBeDefined();
    expect(verifiedStatement.error).toContain('jwt expired');
    
    logger.info('Expired statement test completed');
  });
  
  test('should reject a federation statement with incorrect issuer', () => {
    logger.info('Starting incorrect issuer test');
    
    // Create a federation entity statement with incorrect issuer
    const federationIssuer = 'https://attacker.example.org'; // Not the expected issuer
    const memberSubject = 'https://member.example.org';
    
    const federationStatement = createEntityStatement(
      federationIssuer,
      memberSubject,
      {},
      mockKeyPairs.federation.privateKey
    );
    
    // Verify the statement with issuer check
    const verifiedStatement = verifyEntityStatement(
      federationStatement,
      mockKeyPairs.federation.publicKey,
      {
        issuer: 'https://federation.example.org' // Expected issuer
      }
    );
    
    // Check that the verification failed
    expect(verifiedStatement.error).toBeDefined();
    expect(verifiedStatement.error).toContain('jwt issuer invalid');
    
    logger.info('Incorrect issuer test completed');
  });
});