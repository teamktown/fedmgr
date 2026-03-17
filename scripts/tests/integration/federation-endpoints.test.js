/**
 * Federation Endpoints Integration Tests
 * 
 * Tests the federation_list and federation_fetch endpoints for OpenID Federation compliance.
 * Validates endpoint behavior, authentication, and response formats.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const TestLogger = require('../fixtures/test-logger');

const logger = new TestLogger('TEST-INT-003', 'FederationEndpoints');

// Mock federation setup
class MockFederationServer {
  constructor() {
    this.app = express();
    this.keyPairs = {};
    this.entityConfig = {};
    this.registryData = {};
    this.setupServer();
  }
  
  setupServer() {
    // Generate test key pairs
    this.generateKeyPairs();
    
    // Create mock entity configuration
    this.createEntityConfiguration();
    
    // Setup middleware
    this.setupMiddleware();
    
    // Register federation routes
    this.registerRoutes();
  }
  
  generateKeyPairs() {
    // Generate federation anchor key pair
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    this.keyPairs.anchor = keyPair;
    
    // Create JWK representation
    this.jwk = {
      kty: 'RSA',
      kid: 'test-anchor-key',
      use: 'sig',
      alg: 'RS256',
      n: Buffer.from('mock-n-value').toString('base64url'),
      e: 'AQAB'
    };
  }
  
  createEntityConfiguration() {
    const now = Math.floor(Date.now() / 1000);
    
    this.entityConfig = {
      sub: 'https://federation-anchor.example.org',
      iss: 'https://federation-anchor.example.org',
      iat: now,
      exp: now + 86400,
      metadata: {
        federation_entity: {
          organization_name: 'Test Federation Anchor',
          homepage_uri: 'https://federation-anchor.example.org',
          contacts: ['admin@federation-anchor.example.org'],
          federation_fetch_endpoint: 'https://federation-anchor.example.org/federation_fetch',
          federation_list_endpoint: 'https://federation-anchor.example.org/federation_list',
          federation_resolve_endpoint: 'https://federation-anchor.example.org/resolve',
          federation_trust_mark_status_endpoint: 'https://federation-anchor.example.org/trust-mark-status'
        }
      },
      jwks: {
        keys: [this.jwk]
      }
    };
    
    // Mock registry with subordinate entities
    this.registryData = {
      subordinates: {
        'https://subordinate1.example.org': {
          entity_id: 'https://subordinate1.example.org',
          entity_type: 'openid_provider',
          organization_name: 'Subordinate OP 1',
          trust_marks: ['https://refeds.org/category/research-and-scholarship'],
          metadata: {
            openid_provider: {
              issuer: 'https://subordinate1.example.org',
              authorization_endpoint: 'https://subordinate1.example.org/auth',
              token_endpoint: 'https://subordinate1.example.org/token',
              jwks_uri: 'https://subordinate1.example.org/jwks',
              response_types_supported: ['code'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['RS256']
            }
          }
        },
        'https://subordinate2.example.org': {
          entity_id: 'https://subordinate2.example.org',
          entity_type: 'openid_relying_party',
          organization_name: 'Subordinate RP 1',
          trust_marks: [],
          metadata: {
            openid_relying_party: {
              client_id: 'subordinate2-client',
              redirect_uris: ['https://subordinate2.example.org/callback'],
              response_types: ['code'],
              grant_types: ['authorization_code'],
              token_endpoint_auth_method: 'client_secret_basic'
            }
          }
        }
      }
    };
  }
  
  setupMiddleware() {
    this.app.use(express.json());
    
    // Mock admin middleware
    const adminMiddleware = (req, res, next) => {
      // Simple mock - check for admin header
      if (req.headers['x-admin-token'] !== 'mock-admin-token') {
        return res.status(403).json({ error: 'Forbidden', details: 'Admin access required' });
      }
      next();
    };
    
    // Mock auth middleware  
    const authMiddleware = (req, res, next) => {
      // Simple mock - check for auth header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized', details: 'Valid token required' });
      }
      next();
    };
    
    this.adminMiddleware = adminMiddleware;
    this.authMiddleware = authMiddleware;
  }
  
  registerRoutes() {
    // Entity configuration endpoint
    this.app.get('/.well-known/openid-federation', (req, res) => {
      try {
        const signedJwt = jwt.sign(this.entityConfig, this.keyPairs.anchor.privateKey, {
          algorithm: 'RS256',
          keyid: this.jwk.kid
        });
        
        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(signedJwt);
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Federation List endpoint
    this.app.get('/federation_list', this.adminMiddleware, (req, res) => {
      try {
        const { entity_type, trust_mark, page, page_size } = req.query;
        
        let subordinates = Object.values(this.registryData.subordinates);
        
        // Filter by entity type if specified
        if (entity_type) {
          subordinates = subordinates.filter(sub => sub.entity_type === entity_type);
        }
        
        // Filter by trust mark if specified
        if (trust_mark) {
          subordinates = subordinates.filter(sub => 
            sub.trust_marks && sub.trust_marks.includes(trust_mark)
          );
        }
        
        // Pagination
        const pageNum = parseInt(page) || 1;
        const pageSizeNum = parseInt(page_size) || 10;
        const startIndex = (pageNum - 1) * pageSizeNum;
        const endIndex = startIndex + pageSizeNum;
        const paginatedSubordinates = subordinates.slice(startIndex, endIndex);
        
        // Return list according to OpenID Federation specification
        const response = paginatedSubordinates.map(sub => sub.entity_id);
        
        res.setHeader('Content-Type', 'application/json');
        res.json(response);
        
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Federation Fetch endpoint
    this.app.get('/federation_fetch', this.adminMiddleware, (req, res) => {
      try {
        const { sub } = req.query;
        
        if (!sub) {
          return res.status(400).json({ 
            error: 'Bad Request', 
            details: 'Missing required sub parameter' 
          });
        }
        
        // Find subordinate entity
        const subordinate = this.registryData.subordinates[sub];
        if (!subordinate) {
          return res.status(404).json({
            error: 'Not Found',
            details: `Entity not found: ${sub}`
          });
        }
        
        // Create subordinate statement
        const now = Math.floor(Date.now() / 1000);
        const subordinateStatement = {
          iss: this.entityConfig.sub,
          sub: sub,
          iat: now,
          exp: now + 86400,
          metadata: subordinate.metadata,
          jwks: {
            keys: [
              {
                kty: 'RSA',
                kid: `${subordinate.entity_id.split('//')[1]}-key`,
                use: 'sig',
                alg: 'RS256',
                n: Buffer.from(`mock-n-value-${subordinate.entity_id}`).toString('base64url'),
                e: 'AQAB'
              }
            ]
          }
        };
        
        // Add trust marks if present
        if (subordinate.trust_marks && subordinate.trust_marks.length > 0) {
          subordinateStatement.trust_marks = subordinate.trust_marks.map(tm => ({
            id: tm,
            trust_mark: this.createMockTrustMark(tm, sub)
          }));
        }
        
        // Sign the subordinate statement
        const signedJwt = jwt.sign(subordinateStatement, this.keyPairs.anchor.privateKey, {
          algorithm: 'RS256',
          keyid: this.jwk.kid
        });
        
        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(signedJwt);
        
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Additional federation endpoints for completeness
    this.app.get('/resolve', this.adminMiddleware, (req, res) => {
      const { sub, trust_anchor } = req.query;
      if (!sub) {
        return res.status(400).json({ error: 'Missing sub parameter' });
      }
      
      res.json({
        sub,
        trust_anchor: trust_anchor || this.entityConfig.sub,
        metadata: this.registryData.subordinates[sub]?.metadata || {},
        trust_chain: [this.entityConfig.sub],
        expires_at: Math.floor(Date.now() / 1000) + 86400
      });
    });
    
    this.app.get('/trust-mark-status', this.adminMiddleware, (req, res) => {
      const { trust_mark_id, sub } = req.query;
      if (!trust_mark_id) {
        return res.status(400).json({ error: 'Missing trust_mark_id parameter' });
      }
      
      res.json({
        trust_mark_id,
        sub: sub || 'unknown',
        status: 'active',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
    });
  }
  
  createMockTrustMark(trustMarkId, entityId) {
    const now = Math.floor(Date.now() / 1000);
    const trustMark = {
      iss: this.entityConfig.sub,
      sub: entityId,
      id: trustMarkId,
      iat: now,
      exp: now + 86400
    };
    
    return jwt.sign(trustMark, this.keyPairs.anchor.privateKey, {
      algorithm: 'RS256',
      keyid: this.jwk.kid
    });
  }
  
  // Add subordinate entity for testing
  addSubordinate(entityId, entityData) {
    this.registryData.subordinates[entityId] = {
      entity_id: entityId,
      ...entityData
    };
  }
  
  // Remove subordinate entity
  removeSubordinate(entityId) {
    delete this.registryData.subordinates[entityId];
  }
}

describe('Federation Endpoints Integration Tests', () => {
  let mockServer;
  let server;
  
  beforeAll(async () => {
    logger.info('Setting up mock federation server');
    mockServer = new MockFederationServer();
    server = mockServer.app;
  });
  
  describe('Federation List Endpoint', () => {
    test('should require admin authentication', async () => {
      logger.info('Testing federation_list authentication requirement');
      
      const response = await request(server)
        .get('/federation_list')
        .expect(403);
      
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.details).toContain('Admin access required');
      
      logger.info('Federation_list authentication requirement test completed');
    });
    
    test('should return list of subordinate entities', async () => {
      logger.info('Testing federation_list basic functionality');
      
      const response = await request(server)
        .get('/federation_list')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('application/json');
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toContain('https://subordinate1.example.org');
      expect(response.body).toContain('https://subordinate2.example.org');
      
      logger.info('Federation_list basic functionality test completed');
    });
    
    test('should filter by entity type', async () => {
      logger.info('Testing federation_list entity type filtering');
      
      const response = await request(server)
        .get('/federation_list?entity_type=openid_provider')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body).toContain('https://subordinate1.example.org');
      expect(response.body).not.toContain('https://subordinate2.example.org');
      
      logger.info('Federation_list entity type filtering test completed');
    });
    
    test('should filter by trust mark', async () => {
      logger.info('Testing federation_list trust mark filtering');
      
      const response = await request(server)
        .get('/federation_list?trust_mark=https://refeds.org/category/research-and-scholarship')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body).toContain('https://subordinate1.example.org');
      expect(response.body).not.toContain('https://subordinate2.example.org');
      
      logger.info('Federation_list trust mark filtering test completed');
    });
    
    test('should support pagination', async () => {
      logger.info('Testing federation_list pagination');
      
      // Add more test entities for pagination
      mockServer.addSubordinate('https://subordinate3.example.org', {
        entity_type: 'openid_provider',
        organization_name: 'Subordinate OP 3',
        trust_marks: [],
        metadata: {}
      });
      
      const response = await request(server)
        .get('/federation_list?page=1&page_size=2')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body).toHaveLength(2);
      
      // Clean up
      mockServer.removeSubordinate('https://subordinate3.example.org');
      
      logger.info('Federation_list pagination test completed');
    });
    
    test('should return empty list when no entities match filter', async () => {
      logger.info('Testing federation_list empty result handling');
      
      const response = await request(server)
        .get('/federation_list?entity_type=non_existent_type')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body).toHaveLength(0);
      
      logger.info('Federation_list empty result handling test completed');
    });
  });
  
  describe('Federation Fetch Endpoint', () => {
    test('should require admin authentication', async () => {
      logger.info('Testing federation_fetch authentication requirement');
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .expect(403);
      
      expect(response.body.error).toBe('Forbidden');
      
      logger.info('Federation_fetch authentication requirement test completed');
    });
    
    test('should require sub parameter', async () => {
      logger.info('Testing federation_fetch sub parameter requirement');
      
      const response = await request(server)
        .get('/federation_fetch')
        .set('x-admin-token', 'mock-admin-token')
        .expect(400);
      
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.details).toContain('Missing required sub parameter');
      
      logger.info('Federation_fetch sub parameter requirement test completed');
    });
    
    test('should return entity statement for valid subordinate', async () => {
      logger.info('Testing federation_fetch valid subordinate');
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('application/entity-statement+jwt');
      
      // Decode and verify the JWT
      const decoded = jwt.decode(response.text, { complete: true });
      expect(decoded.payload.iss).toBe('https://federation-anchor.example.org');
      expect(decoded.payload.sub).toBe('https://subordinate1.example.org');
      expect(decoded.payload.metadata.openid_provider).toBeDefined();
      expect(decoded.payload.jwks.keys).toHaveLength(1);
      
      logger.info('Federation_fetch valid subordinate test completed');
    });
    
    test('should return 404 for unknown subordinate', async () => {
      logger.info('Testing federation_fetch unknown subordinate');
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://unknown.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(404);
      
      expect(response.body.error).toBe('Not Found');
      expect(response.body.details).toContain('Entity not found');
      
      logger.info('Federation_fetch unknown subordinate test completed');
    });
    
    test('should include trust marks in entity statement', async () => {
      logger.info('Testing federation_fetch trust marks inclusion');
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      const decoded = jwt.decode(response.text, { complete: true });
      expect(decoded.payload.trust_marks).toBeDefined();
      expect(decoded.payload.trust_marks).toHaveLength(1);
      expect(decoded.payload.trust_marks[0].id).toBe('https://refeds.org/category/research-and-scholarship');
      
      // Verify trust mark JWT
      const trustMarkJwt = decoded.payload.trust_marks[0].trust_mark;
      const trustMarkDecoded = jwt.decode(trustMarkJwt);
      expect(trustMarkDecoded.iss).toBe('https://federation-anchor.example.org');
      expect(trustMarkDecoded.sub).toBe('https://subordinate1.example.org');
      
      logger.info('Federation_fetch trust marks inclusion test completed');
    });
    
    test('should validate JWT signature of entity statement', async () => {
      logger.info('Testing federation_fetch JWT signature validation');
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      // Verify signature using the federation's public key
      try {
        const verified = jwt.verify(response.text, mockServer.keyPairs.anchor.publicKey, {
          algorithms: ['RS256']
        });
        
        expect(verified.iss).toBe('https://federation-anchor.example.org');
        expect(verified.sub).toBe('https://subordinate1.example.org');
      } catch (error) {
        throw new Error(`JWT signature verification failed: ${error.message}`);
      }
      
      logger.info('Federation_fetch JWT signature validation test completed');
    });
  });
  
  describe('Entity Configuration Endpoint', () => {
    test('should return signed entity configuration', async () => {
      logger.info('Testing entity configuration endpoint');
      
      const response = await request(server)
        .get('/.well-known/openid-federation')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('application/entity-statement+jwt');
      
      // Decode and verify the JWT
      const decoded = jwt.decode(response.text, { complete: true });
      expect(decoded.payload.iss).toBe('https://federation-anchor.example.org');
      expect(decoded.payload.sub).toBe('https://federation-anchor.example.org');
      expect(decoded.payload.metadata.federation_entity).toBeDefined();
      expect(decoded.payload.metadata.federation_entity.federation_fetch_endpoint).toBeDefined();
      expect(decoded.payload.metadata.federation_entity.federation_list_endpoint).toBeDefined();
      
      logger.info('Entity configuration endpoint test completed');
    });
  });
  
  describe('Federation Resolve Endpoint', () => {
    test('should resolve entity with trust chain', async () => {
      logger.info('Testing federation resolve endpoint');
      
      const response = await request(server)
        .get('/resolve?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body.sub).toBe('https://subordinate1.example.org');
      expect(response.body.trust_anchor).toBe('https://federation-anchor.example.org');
      expect(response.body.trust_chain).toContain('https://federation-anchor.example.org');
      expect(response.body.expires_at).toBeDefined();
      
      logger.info('Federation resolve endpoint test completed');
    });
  });
  
  describe('Trust Mark Status Endpoint', () => {
    test('should return trust mark status', async () => {
      logger.info('Testing trust mark status endpoint');
      
      const response = await request(server)
        .get('/trust-mark-status?trust_mark_id=https://refeds.org/category/research-and-scholarship&sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      expect(response.body.trust_mark_id).toBe('https://refeds.org/category/research-and-scholarship');
      expect(response.body.sub).toBe('https://subordinate1.example.org');
      expect(response.body.status).toBe('active');
      expect(response.body.issued_at).toBeDefined();
      expect(response.body.expires_at).toBeDefined();
      
      logger.info('Trust mark status endpoint test completed');
    });
  });
  
  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed requests gracefully', async () => {
      logger.info('Testing malformed request handling');
      
      // Test with invalid query parameters
      const response = await request(server)
        .get('/federation_list?invalid_param=true&malformed[]=test')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200); // Should still work, just ignore invalid params
      
      expect(Array.isArray(response.body)).toBe(true);
      
      logger.info('Malformed request handling test completed');
    });
    
    test('should handle server errors gracefully', async () => {
      logger.info('Testing server error handling');
      
      // Temporarily break the server by removing key pairs
      const originalKeyPairs = mockServer.keyPairs;
      mockServer.keyPairs = {};
      
      const response = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(500);
      
      expect(response.body.error).toBe('Internal server error');
      
      // Restore key pairs
      mockServer.keyPairs = originalKeyPairs;
      
      logger.info('Server error handling test completed');
    });
    
    test('should validate admin token format', async () => {
      logger.info('Testing admin token validation');
      
      const response = await request(server)
        .get('/federation_list')
        .set('x-admin-token', 'invalid-token')
        .expect(403);
      
      expect(response.body.error).toBe('Forbidden');
      
      logger.info('Admin token validation test completed');
    });
  });
  
  describe('OpenID Federation Compliance', () => {
    test('should follow OpenID Federation response format specifications', async () => {
      logger.info('Testing OpenID Federation compliance');
      
      // Test federation_list response format
      const listResponse = await request(server)
        .get('/federation_list')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      // Should return array of entity IDs (strings)
      expect(Array.isArray(listResponse.body)).toBe(true);
      listResponse.body.forEach(entityId => {
        expect(typeof entityId).toBe('string');
        expect(entityId).toMatch(/^https?:\/\//); // Should be valid URLs
      });
      
      // Test federation_fetch response format
      const fetchResponse = await request(server)
        .get('/federation_fetch?sub=https://subordinate1.example.org')
        .set('x-admin-token', 'mock-admin-token')
        .expect(200);
      
      // Should return entity statement JWT
      expect(fetchResponse.headers['content-type']).toContain('application/entity-statement+jwt');
      
      const decoded = jwt.decode(fetchResponse.text);
      expect(decoded.iss).toBeDefined();
      expect(decoded.sub).toBeDefined();
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.metadata).toBeDefined();
      expect(decoded.jwks).toBeDefined();
      
      logger.info('OpenID Federation compliance test completed');
    });
  });
});