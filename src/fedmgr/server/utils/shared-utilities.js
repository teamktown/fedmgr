const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Shared Utilities Module
 * Common functions used across federation management components
 */

/**
 * JWT Token Utilities
 */
class JWTUtils {
  constructor(privateKeyPath, publicKeyPath) {
    this.privateKeyPath = privateKeyPath;
    this.publicKeyPath = publicKeyPath;
    this._privateKey = null;
    this._publicKey = null;
  }

  get privateKey() {
    if (!this._privateKey) {
      this._privateKey = fs.readFileSync(this.privateKeyPath, 'utf-8');
    }
    return this._privateKey;
  }

  get publicKey() {
    if (!this._publicKey) {
      this._publicKey = fs.readFileSync(this.publicKeyPath, 'utf-8');
    }
    return this._publicKey;
  }

  /**
   * Create a signed JWT token
   * Defensive implementation to handle payload with existing exp claim
   */
  signToken(payload, options = {}) {
    const defaultOptions = {
      algorithm: 'RS256',
      // Only set expiresIn if payload doesn't already have exp
      ...(payload.exp ? {} : { expiresIn: '1h' })
    };
    
    // Defensive check: if payload has exp and options has expiresIn, remove expiresIn
    const finalOptions = { ...defaultOptions, ...options };
    if (payload.exp && finalOptions.expiresIn) {
      console.warn('⚠️  JWT payload already contains exp claim, removing expiresIn option to prevent conflict');
      delete finalOptions.expiresIn;
    }
    
    return jwt.sign(payload, this.privateKey, finalOptions);
  }

  /**
   * Verify a JWT token
   */
  verifyToken(token, options = {}) {
    const defaultOptions = {
      algorithms: ['RS256']
    };
    return jwt.verify(token, this.publicKey, { ...defaultOptions, ...options });
  }

  /**
   * Decode JWT without verification (for inspecting claims)
   */
  decodeToken(token) {
    return jwt.decode(token, { complete: true });
  }
}

/**
 * Federation Configuration Utilities
 */
class FederationConfig {
  constructor(entityConfig, fedName) {
    this.entityConfig = entityConfig;
    this.fedName = fedName;
  }

  /**
   * Create OpenID Federation Entity Statement
   */
  createEntityStatement(jwtUtils, additionalClaims = {}) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        ...this.entityConfig,
        iat: now,
        exp: now + (24 * 60 * 60), // 24 hours
        iss: this.entityConfig.sub,
        ...additionalClaims
      };

      return jwtUtils.signToken(payload, {
        keyid: this.entityConfig.jwks?.keys?.[0]?.kid
        // Note: Not setting expiresIn since payload contains manual exp
      });
    } catch (error) {
      console.error('❌ Failed to create entity statement:', error.message);
      throw new Error(`Entity statement creation failed: ${error.message}`);
    }
  }

  /**
   * Create subordinate statement for an entity
   */
  createSubordinateStatement(jwtUtils, subjectEntityId, metadata = {}) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.entityConfig.sub,
        sub: subjectEntityId,
        iat: now,
        exp: now + (24 * 60 * 60),
        metadata: {
          federation_entity: {
            organization_name: `Subordinate Entity: ${subjectEntityId}`,
            trust_marks: [],
            ...metadata
          }
        },
        jwks: { keys: [] }
      };

      return jwtUtils.signToken(payload, {
        keyid: this.entityConfig.jwks?.keys?.[0]?.kid
        // Note: Not setting expiresIn since payload contains manual exp
      });
    } catch (error) {
      console.error('❌ Failed to create subordinate statement:', error.message);
      throw new Error(`Subordinate statement creation failed: ${error.message}`);
    }
  }

  /**
   * Create trust mark
   */
  createTrustMark(jwtUtils, subjectId, trustMarkId, additionalClaims = {}) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.entityConfig.sub,
        sub: subjectId,
        trust_mark_id: trustMarkId,
        iat: now,
        exp: now + 86400, // 24 hours
        ...additionalClaims
      };

      return jwtUtils.signToken(payload);
      // Note: Not setting expiresIn since payload contains manual exp
    } catch (error) {
      console.error('❌ Failed to create trust mark:', error.message);
      throw new Error(`Trust mark creation failed: ${error.message}`);
    }
  }
}

/**
 * Admin Utilities
 */
class AdminUtils {
  /**
   * Get admin users from environment
   */
  static getAdminUsers() {
    const adminUsers = process.env.FEDMGR_ADMIN_USERS || process.env.FEDMGR_ADMIN_USER || '';
    return adminUsers.split(',').map(user => user.trim()).filter(Boolean);
  }

  /**
   * Check if user is admin
   */
  static isAdminUser(githubLogin) {
    const adminUsers = this.getAdminUsers();
    return adminUsers.includes(githubLogin);
  }

  /**
   * Extract admin claims from JWT payload
   */
  static getAdminClaims(isAdmin) {
    return {
      role: isAdmin ? 'admin' : 'user',
      roles: isAdmin ? ['user', 'admin'] : ['user'],
      admin: isAdmin
    };
  }
}

/**
 * Path and Directory Utilities
 */
class PathUtils {
  /**
   * Ensure directory exists
   */
  static ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 Created directory: ${dirPath}`);
    }
  }

  /**
   * Get federation paths based on environment and federation name
   */
  static getFederationPaths(fedName) {
    const dataDir = process.env.FEDMGR_FEDERATIONS_DIR || '/usr/src/app/data';
    const keysDir = path.join(dataDir, 'keys');
    const configDir = path.join(dataDir, 'config');
    
    return {
      dataDir,
      keysDir,
      configDir,
      entityConfigPath: path.join(configDir, 'entity-configuration.json'),
      privateKeyPath: path.join(keysDir, 'anchor-private.pem'),
      publicKeyPath: path.join(keysDir, 'anchor-public.pem'),
      registryPath: process.env.FEDMGR_FED_REG || path.join(dataDir, 'registry.json')
    };
  }
}

/**
 * Security Utilities
 */
class SecurityUtils {
  /**
   * Generate cryptographically secure random string
   */
  static generateSecureRandom(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate nonce for JWT tokens
   */
  static generateNonce() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Validate JWT token structure without signature verification
   */
  static validateTokenStructure(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token structure' };
      }

      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      return {
        valid: true,
        header,
        payload
      };
    } catch (error) {
      return { valid: false, error: 'Invalid token format' };
    }
  }
}

/**
 * Response Utilities
 */
class ResponseUtils {
  /**
   * Send standardized error response
   */
  static sendError(res, status, error, message, details = null) {
    const response = { error, message };
    if (details) response.details = details;
    
    console.error(`❌ HTTP ${status}: ${message}`);
    res.status(status).json(response);
  }

  /**
   * Send standardized success response
   */
  static sendSuccess(res, data, message = null) {
    const response = { ...data };
    if (message) response.message = message;
    
    console.log(`✅ Success response sent`);
    res.json(response);
  }

  /**
   * Send JWT response with correct content type
   */
  static sendJWT(res, jwt, contentType = 'application/entity-statement+jwt') {
    res.setHeader('Content-Type', contentType);
    res.send(jwt);
  }
}

/**
 * Validation Utilities
 */
class ValidationUtils {
  /**
   * Validate required query parameters
   */
  static validateRequiredParams(req, res, params) {
    const missing = params.filter(param => !req.query[param]);
    if (missing.length > 0) {
      ResponseUtils.sendError(res, 400, 'Bad Request', `Missing required parameters: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  /**
   * Validate required body fields
   */
  static validateRequiredFields(req, res, fields) {
    const missing = fields.filter(field => !req.body[field]);
    if (missing.length > 0) {
      ResponseUtils.sendError(res, 400, 'Bad Request', `Missing required fields: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }
}

module.exports = {
  JWTUtils,
  FederationConfig,
  AdminUtils,
  PathUtils,
  SecurityUtils,
  ResponseUtils,
  ValidationUtils
};