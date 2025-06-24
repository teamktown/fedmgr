/**
 * Metadata Validation Tests
 * 
 * Tests entity configurations to ensure compliance with OpenID Federation specification.
 * Validates required fields, data types, and federation-specific metadata.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const TestLogger = require('../fixtures/test-logger');

const logger = new TestLogger('TEST-UNIT-003', 'MetadataValidation');

// OpenID Federation specification compliance checks
class FederationMetadataValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  
  reset() {
    this.errors = [];
    this.warnings = [];
  }
  
  // Validate entity statement structure (RFC 8515)
  validateEntityStatement(statement) {
    this.reset();
    
    // Required claims for entity statements
    this.validateRequiredClaims(statement, [
      'iss', 'sub', 'iat', 'exp'
    ]);
    
    // Validate claim types
    this.validateClaimTypes(statement, {
      'iss': 'string',
      'sub': 'string', 
      'iat': 'number',
      'exp': 'number',
      'aud': 'string|array', // Optional but if present
      'nbf': 'number' // Optional but if present
    });
    
    // Validate expiration
    this.validateExpiration(statement);
    
    // Validate metadata if present
    if (statement.metadata) {
      this.validateMetadata(statement.metadata);
    }
    
    // Validate JWKS if present
    if (statement.jwks) {
      this.validateJWKS(statement.jwks);
    }
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  
  // Validate federation entity metadata
  validateFederationEntity(metadata) {
    this.reset();
    
    if (!metadata.federation_entity) {
      this.errors.push('Missing federation_entity metadata');
      return { valid: false, errors: this.errors, warnings: this.warnings };
    }
    
    const fedEntity = metadata.federation_entity;
    
    // Required fields for federation entities
    this.validateRequiredFields(fedEntity, [
      'federation_fetch_endpoint'
    ], 'federation_entity');
    
    // Optional but recommended fields
    this.validateOptionalFields(fedEntity, {
      'organization_name': 'string',
      'homepage_uri': 'string',
      'contacts': 'array',
      'federation_resolve_endpoint': 'string',
      'federation_trust_mark_status_endpoint': 'string',
      'federation_list_endpoint': 'string'
    }, 'federation_entity');
    
    // Validate endpoint URLs
    this.validateEndpointUrls(fedEntity);
    
    // Validate contacts format
    if (fedEntity.contacts) {
      this.validateContacts(fedEntity.contacts);
    }
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  
  // Validate OpenID Connect Provider metadata
  validateOpenIDProvider(metadata) {
    this.reset();
    
    if (!metadata.openid_provider) {
      this.errors.push('Missing openid_provider metadata');
      return { valid: false, errors: this.errors, warnings: this.warnings };
    }
    
    const oidcProvider = metadata.openid_provider;
    
    // Required fields for OIDC providers
    this.validateRequiredFields(oidcProvider, [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'response_types_supported',
      'subject_types_supported',
      'id_token_signing_alg_values_supported'
    ], 'openid_provider');
    
    // Validate required arrays
    if (oidcProvider.response_types_supported) {
      this.validateArrayContainsRequired(oidcProvider.response_types_supported, ['code'], 'response_types_supported');
    }
    
    if (oidcProvider.subject_types_supported) {
      this.validateArrayContainsRequired(oidcProvider.subject_types_supported, ['public'], 'subject_types_supported');
    }
    
    if (oidcProvider.id_token_signing_alg_values_supported) {
      this.validateArrayContainsRequired(oidcProvider.id_token_signing_alg_values_supported, ['RS256'], 'id_token_signing_alg_values_supported');
    }
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  
  // Validate OpenID Connect Client metadata
  validateOpenIDClient(metadata) {
    this.reset();
    
    if (!metadata.openid_relying_party) {
      this.errors.push('Missing openid_relying_party metadata');
      return { valid: false, errors: this.errors, warnings: this.warnings };
    }
    
    const oidcClient = metadata.openid_relying_party;
    
    // Required fields for OIDC clients
    this.validateRequiredFields(oidcClient, [
      'client_id',
      'redirect_uris',
      'response_types'
    ], 'openid_relying_party');
    
    // Validate redirect URIs
    if (oidcClient.redirect_uris) {
      this.validateRedirectUris(oidcClient.redirect_uris);
    }
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  
  // Helper validation methods
  validateRequiredClaims(obj, requiredClaims) {
    requiredClaims.forEach(claim => {
      if (!(claim in obj)) {
        this.errors.push(`Missing required claim: ${claim}`);
      }
    });
  }
  
  validateRequiredFields(obj, requiredFields, context) {
    requiredFields.forEach(field => {
      if (!(field in obj)) {
        this.errors.push(`Missing required field in ${context}: ${field}`);
      }
    });
  }
  
  validateOptionalFields(obj, fieldTypes, context) {
    Object.entries(fieldTypes).forEach(([field, expectedType]) => {
      if (field in obj) {
        const actualType = Array.isArray(obj[field]) ? 'array' : typeof obj[field];
        const expectedTypes = expectedType.split('|');
        if (!expectedTypes.includes(actualType)) {
          this.errors.push(`Invalid type for ${context}.${field}: expected ${expectedType}, got ${actualType}`);
        }
      }
    });
  }
  
  validateClaimTypes(obj, claimTypes) {
    Object.entries(claimTypes).forEach(([claim, expectedType]) => {
      if (claim in obj) {
        const actualType = Array.isArray(obj[claim]) ? 'array' : typeof obj[claim];
        const expectedTypes = expectedType.split('|');
        if (!expectedTypes.includes(actualType)) {
          this.errors.push(`Invalid type for claim ${claim}: expected ${expectedType}, got ${actualType}`);
        }
      }
    });
  }
  
  validateExpiration(statement) {
    const now = Math.floor(Date.now() / 1000);
    
    if (statement.exp && statement.exp <= now) {
      this.errors.push('Entity statement has expired');
    }
    
    if (statement.iat && statement.iat > now + 300) { // Allow 5 minute clock skew
      this.errors.push('Entity statement issued in the future');
    }
    
    if (statement.nbf && statement.nbf > now + 300) {
      this.errors.push('Entity statement not yet active');
    }
  }
  
  validateMetadata(metadata) {
    if (typeof metadata !== 'object') {
      this.errors.push('Metadata must be an object');
      return;
    }
    
    // At least one metadata type should be present
    const knownMetadataTypes = [
      'federation_entity',
      'openid_provider', 
      'openid_relying_party',
      'oauth_authorization_server',
      'oauth_client',
      'oauth_resource'
    ];
    
    const presentTypes = knownMetadataTypes.filter(type => type in metadata);
    if (presentTypes.length === 0) {
      this.warnings.push('No recognized metadata types found');
    }
  }
  
  validateJWKS(jwks) {
    if (!jwks.keys || !Array.isArray(jwks.keys)) {
      this.errors.push('JWKS must have a keys array');
      return;
    }
    
    jwks.keys.forEach((key, index) => {
      this.validateJWK(key, index);
    });
  }
  
  validateJWK(key, index) {
    // Required JWK parameters
    const requiredParams = ['kty'];
    requiredParams.forEach(param => {
      if (!(param in key)) {
        this.errors.push(`JWK at index ${index} missing required parameter: ${param}`);
      }
    });
    
    // Key type specific validation
    if (key.kty === 'RSA') {
      const rsaRequired = ['n', 'e'];
      rsaRequired.forEach(param => {
        if (!(param in key)) {
          this.errors.push(`RSA JWK at index ${index} missing required parameter: ${param}`);
        }
      });
    }
    
    // Recommended parameters
    if (!key.kid) {
      this.warnings.push(`JWK at index ${index} missing recommended kid parameter`);
    }
    
    if (!key.use && !key.key_ops) {
      this.warnings.push(`JWK at index ${index} missing use or key_ops parameter`);
    }
  }
  
  validateEndpointUrls(fedEntity) {
    const endpoints = [
      'federation_fetch_endpoint',
      'federation_resolve_endpoint', 
      'federation_trust_mark_status_endpoint',
      'federation_list_endpoint'
    ];
    
    endpoints.forEach(endpoint => {
      if (fedEntity[endpoint] && !this.isValidUrl(fedEntity[endpoint])) {
        this.errors.push(`Invalid URL for ${endpoint}: ${fedEntity[endpoint]}`);
      }
    });
  }
  
  validateContacts(contacts) {
    if (!Array.isArray(contacts)) {
      this.errors.push('Contacts must be an array');
      return;
    }
    
    contacts.forEach((contact, index) => {
      if (typeof contact !== 'string') {
        this.errors.push(`Contact at index ${index} must be a string`);
      } else if (!this.isValidEmail(contact) && !this.isValidUrl(contact)) {
        this.warnings.push(`Contact at index ${index} should be an email or URL: ${contact}`);
      }
    });
  }
  
  validateRedirectUris(redirectUris) {
    if (!Array.isArray(redirectUris)) {
      this.errors.push('redirect_uris must be an array');
      return;
    }
    
    redirectUris.forEach((uri, index) => {
      if (!this.isValidUrl(uri)) {
        this.errors.push(`Invalid redirect URI at index ${index}: ${uri}`);
      }
      
      // Security recommendation: HTTPS required for production
      if (!uri.startsWith('https://') && !uri.startsWith('http://localhost')) {
        this.warnings.push(`Redirect URI at index ${index} should use HTTPS: ${uri}`);
      }
    });
  }
  
  validateArrayContainsRequired(array, required, fieldName) {
    required.forEach(item => {
      if (!array.includes(item)) {
        this.errors.push(`${fieldName} must include: ${item}`);
      }
    });
  }
  
  // Utility methods
  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  isValidEmail(string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(string);
  }
}

describe('Metadata Validation Tests', () => {
  let validator;
  
  beforeEach(() => {
    validator = new FederationMetadataValidator();
  });
  
  describe('Entity Statement Validation', () => {
    test('should validate valid entity statement', () => {
      logger.info('Testing valid entity statement validation');
      
      const validStatement = {
        iss: 'https://federation.example.org',
        sub: 'https://member.example.org',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        metadata: {
          federation_entity: {
            organization_name: 'Test Federation',
            federation_fetch_endpoint: 'https://federation.example.org/.well-known/openid-federation',
            contacts: ['admin@example.org']
          }
        },
        jwks: {
          keys: [{
            kty: 'RSA',
            kid: 'test-key-1',
            use: 'sig',
            n: 'test-n-value',
            e: 'AQAB'
          }]
        }
      };
      
      const result = validator.validateEntityStatement(validStatement);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      
      logger.info('Valid entity statement validation completed');
    });
    
    test('should detect missing required claims', () => {
      logger.info('Testing missing required claims detection');
      
      const invalidStatement = {
        iss: 'https://federation.example.org',
        // Missing sub, iat, exp
        metadata: {}
      };
      
      const result = validator.validateEntityStatement(invalidStatement);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required claim: sub');
      expect(result.errors).toContain('Missing required claim: iat');
      expect(result.errors).toContain('Missing required claim: exp');
      
      logger.info('Missing required claims detection completed');
    });
    
    test('should detect expired entity statement', () => {
      logger.info('Testing expired entity statement detection');
      
      const expiredStatement = {
        iss: 'https://federation.example.org',
        sub: 'https://member.example.org',
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
        metadata: {}
      };
      
      const result = validator.validateEntityStatement(expiredStatement);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Entity statement has expired');
      
      logger.info('Expired entity statement detection completed');
    });
    
    test('should validate claim types', () => {
      logger.info('Testing claim type validation');
      
      const invalidTypesStatement = {
        iss: 123, // Should be string
        sub: 'https://member.example.org',
        iat: 'not-a-number', // Should be number
        exp: Math.floor(Date.now() / 1000) + 3600,
        metadata: {}
      };
      
      const result = validator.validateEntityStatement(invalidTypesStatement);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid type for claim iss: expected string, got number');
      expect(result.errors).toContain('Invalid type for claim iat: expected number, got string');
      
      logger.info('Claim type validation completed');
    });
  });
  
  describe('Federation Entity Metadata Validation', () => {
    test('should validate valid federation entity metadata', () => {
      logger.info('Testing valid federation entity metadata');
      
      const validMetadata = {
        federation_entity: {
          organization_name: 'Test Federation',
          homepage_uri: 'https://federation.example.org',
          contacts: ['admin@example.org', 'support@example.org'],
          federation_fetch_endpoint: 'https://federation.example.org/.well-known/openid-federation',
          federation_resolve_endpoint: 'https://federation.example.org/resolve',
          federation_trust_mark_status_endpoint: 'https://federation.example.org/trust-mark-status',
          federation_list_endpoint: 'https://federation.example.org/list'
        }
      };
      
      const result = validator.validateFederationEntity(validMetadata);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      
      logger.info('Valid federation entity metadata validation completed');
    });
    
    test('should detect missing federation entity metadata', () => {
      logger.info('Testing missing federation entity metadata detection');
      
      const invalidMetadata = {
        // Missing federation_entity
        openid_provider: {}
      };
      
      const result = validator.validateFederationEntity(invalidMetadata);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing federation_entity metadata');
      
      logger.info('Missing federation entity metadata detection completed');
    });
    
    test('should detect missing required federation endpoints', () => {
      logger.info('Testing missing required federation endpoints detection');
      
      const invalidMetadata = {
        federation_entity: {
          organization_name: 'Test Federation'
          // Missing federation_fetch_endpoint
        }
      };
      
      const result = validator.validateFederationEntity(invalidMetadata);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field in federation_entity: federation_fetch_endpoint');
      
      logger.info('Missing required federation endpoints detection completed');
    });
    
    test('should validate endpoint URLs', () => {
      logger.info('Testing endpoint URL validation');
      
      const invalidMetadata = {
        federation_entity: {
          federation_fetch_endpoint: 'not-a-valid-url',
          federation_resolve_endpoint: 'also-invalid'
        }
      };
      
      const result = validator.validateFederationEntity(invalidMetadata);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL for federation_fetch_endpoint: not-a-valid-url');
      expect(result.errors).toContain('Invalid URL for federation_resolve_endpoint: also-invalid');
      
      logger.info('Endpoint URL validation completed');
    });
    
    test('should validate contacts format', () => {
      logger.info('Testing contacts format validation');
      
      const invalidMetadata = {
        federation_entity: {
          federation_fetch_endpoint: 'https://federation.example.org/.well-known/openid-federation',
          contacts: 'not-an-array' // Should be array
        }
      };
      
      const result = validator.validateFederationEntity(invalidMetadata);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Contacts must be an array');
      
      logger.info('Contacts format validation completed');
    });
  });
  
  describe('JWKS Validation', () => {
    test('should validate valid JWKS', () => {
      logger.info('Testing valid JWKS validation');
      
      const validStatement = {
        iss: 'https://federation.example.org',
        sub: 'https://member.example.org',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jwks: {
          keys: [
            {
              kty: 'RSA',
              kid: 'test-key-1',
              use: 'sig',
              alg: 'RS256',
              n: 'test-n-value',
              e: 'AQAB'
            },
            {
              kty: 'RSA',
              kid: 'test-key-2',
              use: 'enc',
              alg: 'RS256',
              n: 'test-n-value-2',
              e: 'AQAB'
            }
          ]
        }
      };
      
      const result = validator.validateEntityStatement(validStatement);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      
      logger.info('Valid JWKS validation completed');
    });
    
    test('should detect invalid JWKS structure', () => {
      logger.info('Testing invalid JWKS structure detection');
      
      const invalidStatement = {
        iss: 'https://federation.example.org',
        sub: 'https://member.example.org',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jwks: {
          // Missing keys array
        }
      };
      
      const result = validator.validateEntityStatement(invalidStatement);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('JWKS must have a keys array');
      
      logger.info('Invalid JWKS structure detection completed');
    });
    
    test('should detect missing JWK required parameters', () => {
      logger.info('Testing missing JWK required parameters detection');
      
      const invalidStatement = {
        iss: 'https://federation.example.org',
        sub: 'https://member.example.org',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jwks: {
          keys: [
            {
              // Missing kty
              kid: 'test-key-1',
              use: 'sig'
            },
            {
              kty: 'RSA',
              kid: 'test-key-2',
              // Missing n and e for RSA key
            }
          ]
        }
      };
      
      const result = validator.validateEntityStatement(invalidStatement);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('JWK at index 0 missing required parameter: kty');
      expect(result.errors).toContain('RSA JWK at index 1 missing required parameter: n');
      expect(result.errors).toContain('RSA JWK at index 1 missing required parameter: e');
      
      logger.info('Missing JWK required parameters detection completed');
    });
  });
  
  describe('Integration with File System', () => {
    test('should validate entity configurations from test files', () => {
      logger.info('Testing entity configuration file validation');
      
      // Look for existing test entity configurations
      const testFederationsDir = path.join(__dirname, '../../../test-federations');
      if (!fs.existsSync(testFederationsDir)) {
        logger.info('No test federations directory found, skipping file system integration test');
        return;
      }
      
      // Find federation directories
      const federations = fs.readdirSync(testFederationsDir)
        .filter(item => fs.statSync(path.join(testFederationsDir, item)).isDirectory());
      
      federations.forEach(federation => {
        const configPath = path.join(testFederationsDir, federation, 'config', 'entity-configuration.json');
        
        if (fs.existsSync(configPath)) {
          logger.info(`Validating entity configuration for federation: ${federation}`);
          
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          const result = validator.validateEntityStatement(configData);
          
          // Log results for debugging
          if (!result.valid) {
            logger.error(`Validation errors for ${federation}: ${JSON.stringify(result.errors)}`);
          }
          if (result.warnings.length > 0) {
            logger.info(`Validation warnings for ${federation}: ${JSON.stringify(result.warnings)}`);
          }
          
          // Expect valid configuration (may need adjustment based on actual test data)
          expect(result.valid).toBe(true);
        }
      });
      
      logger.info('Entity configuration file validation completed');
    });
  });
});