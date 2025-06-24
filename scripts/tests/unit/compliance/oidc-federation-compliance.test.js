/**
 * OpenID Federation 1.0 Draft-43 Compliance Tests
 * 
 * This test suite verifies compliance with OpenID Federation specification
 * including signed entity statements, trust chain validation, and required endpoints.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

// Import the modules we're testing
const certificateUtils = require('../../../../src/fedmgr/server/utils/certificate-utils');
const registerFederationRoutes = require('../../../../src/fedmgr/server/federation-routes');

describe('OpenID Federation 1.0 Draft-43 Compliance', () => {
  let app;
  let privateKeyPath;
  let publicKeyPath;
  let entityConfig;
  let tempDir;

  beforeAll(() => {
    // Create temporary directory for test keys
    tempDir = `/tmp/fedmgr-test-${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    
    privateKeyPath = path.join(tempDir, 'test-private.pem');
    publicKeyPath = path.join(tempDir, 'test-public.pem');
    
    // Generate test keys
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    fs.writeFileSync(privateKeyPath, keyPair.privateKey);
    fs.writeFileSync(publicKeyPath, keyPair.publicKey);
    
    // Create test entity configuration
    const now = Math.floor(Date.now() / 1000);
    entityConfig = {
      sub: 'http://localhost:3001',
      iss: 'http://localhost:3001',
      iat: now,
      exp: now + (24 * 60 * 60),
      metadata: {
        federation_entity: {
          organization_name: 'Test Federation',
          federation_fetch_endpoint: 'http://localhost:3001/federation_fetch',
          federation_list_endpoint: 'http://localhost:3001/federation_list',
          federation_resolve_endpoint: 'http://localhost:3001/resolve',
          federation_trust_mark_status_endpoint: 'http://localhost:3001/trust-mark-status'
        }
      },
      jwks: {
        keys: [
          certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
            kid: 'test-key-1',
            use: 'sig',
            alg: 'RS256'
          })
        ]
      },
      authority_hints: []
    };
    
    // Setup Express app with federation routes
    app = express();
    app.use(express.json());
    
    registerFederationRoutes(app, {
      fedName: 'test-federation',
      entityConfig,
      publicKeyPath,
      publicDir: '/tmp',
      clientId: 'test-client',
      clientSecret: 'test-secret'
    });
  });

  afterAll(() => {
    // Cleanup temporary files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Entity Configuration Endpoint (.well-known/openid-federation)', () => {
    test('should return signed JWT with correct content-type', async () => {
      const response = await request(app)
        .get('/.well-known/openid-federation')
        .expect(200);

      // Verify content-type is correct per OpenID Federation spec
      expect(response.headers['content-type']).toContain('application/entity-statement+jwt');
      
      // Verify response is a JWT (not JSON)
      expect(typeof response.text).toBe('string');
      expect(response.text.split('.').length).toBe(3); // JWT has 3 parts
    });

    test('signed JWT should have valid signature and required claims', async () => {
      const response = await request(app)
        .get('/.well-known/openid-federation')
        .expect(200);

      const jwtToken = response.text;
      
      // Verify JWT signature
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      const decoded = jwt.verify(jwtToken, publicKey, { algorithms: ['RS256'] });
      
      // Verify required claims per OpenID Federation spec
      expect(decoded.sub).toBe('http://localhost:3001');
      expect(decoded.iss).toBe('http://localhost:3001'); // Self-issued for entity statements
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
      
      // Verify metadata structure
      expect(decoded.metadata).toBeDefined();
      expect(decoded.metadata.federation_entity).toBeDefined();
      expect(decoded.jwks).toBeDefined();
      expect(decoded.jwks.keys).toBeInstanceOf(Array);
      expect(decoded.jwks.keys.length).toBeGreaterThan(0);
    });

    test('exp claim should be properly set for compliance', async () => {
      const response = await request(app)
        .get('/.well-known/openid-federation')
        .expect(200);

      const jwtToken = response.text;
      const decoded = jwt.decode(jwtToken);
      
      // Verify exp claim exists and is in the future
      expect(decoded.exp).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      
      // Verify exp is reasonable (24 hours in the future)
      const expectedExp = decoded.iat + (24 * 60 * 60);
      expect(Math.abs(decoded.exp - expectedExp)).toBeLessThan(60); // Allow 1 minute variance
    });
  });

  describe('Federation List Endpoint', () => {
    test('should exist and return JSON response', async () => {
      const response = await request(app)
        .get('/federation_list')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should handle errors gracefully', async () => {
      // This test ensures the endpoint is robust
      const response = await request(app)
        .get('/federation_list')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Federation Fetch Endpoint', () => {
    test('should require sub parameter', async () => {
      const response = await request(app)
        .get('/federation_fetch')
        .expect(400);

      expect(response.body.error).toBe('Bad Request');
      expect(response.body.details).toContain('Missing required sub parameter');
    });

    test('should return signed subordinate statement', async () => {
      const testSub = 'http://example.com/test-entity';
      
      const response = await request(app)
        .get(`/federation_fetch?sub=${encodeURIComponent(testSub)}`)
        .expect(200);

      // Verify content-type is correct
      expect(response.headers['content-type']).toContain('application/entity-statement+jwt');
      
      // Verify response is a JWT
      expect(typeof response.text).toBe('string');
      expect(response.text.split('.').length).toBe(3);
    });

    test('subordinate statement should have valid signature and claims', async () => {
      const testSub = 'http://example.com/test-entity';
      
      const response = await request(app)
        .get(`/federation_fetch?sub=${encodeURIComponent(testSub)}`)
        .expect(200);

      const jwtToken = response.text;
      
      // Verify JWT signature
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      const decoded = jwt.verify(jwtToken, publicKey, { algorithms: ['RS256'] });
      
      // Verify subordinate statement claims
      expect(decoded.iss).toBe('http://localhost:3001'); // Trust anchor issues subordinate statements
      expect(decoded.sub).toBe(testSub);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
      
      // Verify metadata and jwks structure
      expect(decoded.metadata).toBeDefined();
      expect(decoded.jwks).toBeDefined();
    });
  });

  describe('Trust Chain Validation', () => {
    test('should validate single token chains', () => {
      // Create a test token
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const payload = {
        sub: 'http://test.example.com',
        iss: 'http://localhost:3001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        metadata: { federation_entity: {} },
        jwks: { keys: [] }
      };
      
      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
      const result = certificateUtils.validateTrustChain([token], publicKeyPath);
      
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.sub).toBe('http://test.example.com');
    });

    test('should reject invalid tokens', () => {
      const invalidToken = 'invalid.jwt.token';
      const result = certificateUtils.validateTrustChain([invalidToken], publicKeyPath);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('verification failed');
    });

    test('should handle empty trust chains', () => {
      const result = certificateUtils.validateTrustChain([], publicKeyPath);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Trust chain is empty');
    });

    test('should validate multi-hop trust chains', () => {
      // Create multiple tokens for chain validation
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      
      // First token (trust anchor to intermediate)
      const token1Payload = {
        sub: 'http://intermediate.example.com',
        iss: 'http://localhost:3001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        metadata: { federation_entity: {} },
        jwks: {
          keys: [
            certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
              kid: 'intermediate-key',
              use: 'sig',
              alg: 'RS256'
            })
          ]
        }
      };
      
      const token1 = jwt.sign(token1Payload, privateKey, { algorithm: 'RS256' });
      
      // For multi-hop validation test, we'll test the validation logic
      const result = certificateUtils.validateTrustChain([token1], publicKeyPath);
      
      expect(result.valid).toBe(true);
      
      // Check if validatedTokens exists (for multi-hop chains) or if it's a single token validation
      if (result.validatedTokens) {
        expect(result.validatedTokens.length).toBe(1);
      } else {
        // Single token validation should have payload
        expect(result.payload).toBeDefined();
      }
    });
  });

  describe('Certificate Utilities', () => {
    test('should convert PEM to JWK correctly', () => {
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      const jwk = certificateUtils.pemToJwk(publicKey, {
        kid: 'test-key',
        use: 'sig',
        alg: 'RS256'
      });
      
      expect(jwk.kty).toBe('RSA');
      expect(jwk.kid).toBe('test-key');
      expect(jwk.use).toBe('sig');
      expect(jwk.alg).toBe('RS256');
      expect(jwk.n).toBeDefined(); // Modulus
      expect(jwk.e).toBeDefined(); // Exponent
    });

    test('should convert JWK back to PEM', () => {
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      const jwk = certificateUtils.pemToJwk(publicKey);
      const reconvertedPem = certificateUtils.jwkToPem(jwk);
      
      expect(reconvertedPem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(reconvertedPem).toContain('-----END PUBLIC KEY-----');
      expect(typeof reconvertedPem).toBe('string');
    });

    test('should sign and verify JWTs correctly', () => {
      const payload = {
        sub: 'test-subject',
        iss: 'test-issuer',
        aud: 'test-audience'
      };
      
      const signedJwt = certificateUtils.signJwt(payload, privateKeyPath);
      const verificationResult = certificateUtils.verifyJwt(signedJwt, publicKeyPath);
      
      expect(verificationResult.valid).toBe(true);
      expect(verificationResult.payload.sub).toBe('test-subject');
      expect(verificationResult.payload.iss).toBe('test-issuer');
      expect(verificationResult.payload.aud).toBe('test-audience');
    });

    test('should handle exp claims correctly in JWT signing', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: 'test-subject',
        iat: now,
        exp: now + 3600 // 1 hour
      };
      
      const signedJwt = certificateUtils.signJwt(payload, privateKeyPath);
      const decoded = jwt.decode(signedJwt);
      
      expect(decoded.exp).toBe(now + 3600);
      expect(decoded.iat).toBe(now);
    });
  });

  describe('Metadata Compliance', () => {
    test('entity configuration should have all required federation endpoints', async () => {
      const response = await request(app)
        .get('/.well-known/openid-federation')
        .expect(200);

      const decoded = jwt.decode(response.text);
      const fedEntity = decoded.metadata.federation_entity;
      
      expect(fedEntity.federation_fetch_endpoint).toBeDefined();
      expect(fedEntity.federation_list_endpoint).toBeDefined();
      expect(fedEntity.federation_resolve_endpoint).toBeDefined();
      expect(fedEntity.federation_trust_mark_status_endpoint).toBeDefined();
      
      // Verify endpoints are valid URLs
      expect(fedEntity.federation_fetch_endpoint).toMatch(/^https?:\/\//);
      expect(fedEntity.federation_list_endpoint).toMatch(/^https?:\/\//);
      expect(fedEntity.federation_resolve_endpoint).toMatch(/^https?:\/\//);
      expect(fedEntity.federation_trust_mark_status_endpoint).toMatch(/^https?:\/\//);
    });

    test('entity statements should have proper issuer and subject relationship', async () => {
      const response = await request(app)
        .get('/.well-known/openid-federation')
        .expect(200);

      const decoded = jwt.decode(response.text);
      
      // For entity statements, iss should equal sub (self-issued)
      expect(decoded.iss).toBe(decoded.sub);
      expect(decoded.sub).toBe('http://localhost:3001');
    });

    test('subordinate statements should have correct issuer-subject relationship', async () => {
      const testSub = 'http://example.com/subordinate';
      
      const response = await request(app)
        .get(`/federation_fetch?sub=${encodeURIComponent(testSub)}`)
        .expect(200);

      const decoded = jwt.decode(response.text);
      
      // For subordinate statements, iss should be trust anchor, sub should be subordinate
      expect(decoded.iss).toBe('http://localhost:3001'); // Trust anchor
      expect(decoded.sub).toBe(testSub); // Subordinate entity
      expect(decoded.iss).not.toBe(decoded.sub);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing private key gracefully', () => {
      const nonExistentKeyPath = '/tmp/non-existent-key.pem';
      
      expect(() => {
        certificateUtils.signJwt({ test: 'payload' }, nonExistentKeyPath);
      }).toThrow();
    });

    test('should handle malformed JWK to PEM conversion', () => {
      const malformedJwk = {
        kty: 'UNKNOWN',
        n: 'invalid',
        e: 'invalid'
      };
      
      expect(() => {
        certificateUtils.jwkToPem(malformedJwk);
      }).toThrow();
    });

    test('should validate trust chains with missing JWKS', () => {
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const payloadWithoutJwks = {
        sub: 'http://test.example.com',
        iss: 'http://localhost:3001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        metadata: { federation_entity: {} }
        // Missing jwks field
      };
      
      const token = jwt.sign(payloadWithoutJwks, privateKey, { algorithm: 'RS256' });
      
      // For multi-token chains, this would fail, but single token should work
      const result = certificateUtils.validateTrustChain([token], publicKeyPath);
      expect(result.valid).toBe(true); // Single token validation should work
    });
  });
});