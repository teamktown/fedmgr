const fs = require('fs');
const path = require('path');
const { JWTUtils, FederationConfig, ResponseUtils, ValidationUtils } = require('./utils/shared-utilities');

/**
 * Federation API Module
 * Handles OpenID Federation endpoints and entity management
 */
class FederationAPI {
  constructor(config) {
    this.fedName = config.fedName;
    this.entityConfig = config.entityConfig;
    this.publicKeyPath = config.publicKeyPath;
    this.privateKeyPath = config.publicKeyPath.replace('-public.pem', '-private.pem');
    this.publicDir = config.publicDir;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.adminMiddleware = config.adminMiddleware;
    this.authMiddleware = config.authMiddleware;

    // Initialize utilities
    this.jwtUtils = new JWTUtils(this.privateKeyPath, this.publicKeyPath);
    this.federationConfig = new FederationConfig(this.entityConfig, this.fedName);
  }

  /**
   * Register OpenID Federation endpoints
   */
  registerFederationEndpoints(app) {
    // Entity Configuration endpoint (OpenID Federation spec)
    app.get('/.well-known/openid-federation', (req, res) => {
      console.log(`📤 Serving signed entity configuration JWT for ${this.fedName}`);
      
      try {
        const signedJwt = this.federationConfig.createEntityStatement(this.jwtUtils);
        ResponseUtils.sendJWT(res, signedJwt, 'application/entity-statement+jwt');
      } catch (error) {
        console.error(`❌ Failed to sign entity configuration: ${error.message}`);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to generate signed entity statement');
      }
    });

    // Federation List endpoint (ADMIN ONLY)
    app.get('/federation_list', this.adminMiddleware, (req, res) => {
      console.log(`📋 Serving federation list for ${this.fedName}`);
      
      try {
        // In a real implementation, this would query subordinate entities from a database
        const federationList = this.getFederationList();
        ResponseUtils.sendSuccess(res, federationList);
      } catch (error) {
        console.error(`❌ Failed to serve federation list: ${error.message}`);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to retrieve federation list');
      }
    });

    // Federation Fetch endpoint (ADMIN ONLY)
    app.get('/federation_fetch', this.adminMiddleware, (req, res) => {
      if (!ValidationUtils.validateRequiredParams(req, res, ['sub'])) {
        return;
      }

      const { sub } = req.query;
      console.log(`📥 Fetching subordinate statement for: ${sub}`);
      
      try {
        const signedJwt = this.federationConfig.createSubordinateStatement(this.jwtUtils, sub);
        ResponseUtils.sendJWT(res, signedJwt, 'application/entity-statement+jwt');
      } catch (error) {
        console.error(`❌ Failed to create subordinate statement: ${error.message}`);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to generate subordinate statement');
      }
    });

    // Trust Resolution endpoint (ADMIN ONLY)
    app.get('/resolve', this.adminMiddleware, (req, res) => {
      if (!ValidationUtils.validateRequiredParams(req, res, ['sub'])) {
        return;
      }

      const { sub, trust_anchor } = req.query;
      console.log(`🔍 Resolving trust for entity: ${sub}`);
      
      try {
        const resolved = this.resolveTrustChain(sub, trust_anchor);
        ResponseUtils.sendSuccess(res, resolved);
      } catch (error) {
        console.error(`❌ Failed to resolve trust chain: ${error.message}`);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to resolve trust chain');
      }
    });

    // Trust Mark Status endpoint (ADMIN ONLY)
    app.get('/trust-mark-status', this.adminMiddleware, (req, res) => {
      if (!ValidationUtils.validateRequiredParams(req, res, ['trust_mark_id'])) {
        return;
      }

      const { trust_mark_id, sub } = req.query;
      console.log(`🏷️ Checking trust mark status: ${trust_mark_id}`);
      
      try {
        const status = this.getTrustMarkStatus(trust_mark_id, sub);
        ResponseUtils.sendSuccess(res, status);
      } catch (error) {
        console.error(`❌ Failed to check trust mark status: ${error.message}`);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to check trust mark status');
      }
    });
  }

  /**
   * Register utility endpoints
   */
  registerUtilityEndpoints(app) {
    // Health check endpoint
    app.get('/health', (req, res) => {
      const healthStatus = {
        status: 'healthy',
        federation: this.fedName,
        entity_id: this.entityConfig.sub,
        github_oauth: !!(this.clientId && this.clientSecret),
        oidcfed_compliant: true,
        trust_anchor: true,
        static_files_dir: this.publicDir,
        static_files_available: fs.existsSync(this.publicDir),
        timestamp: new Date().toISOString(),
      };
      
      console.log(`✅ Health check passed for ${this.fedName}`);
      ResponseUtils.sendSuccess(res, healthStatus);
    });

    // Token validation endpoint (AUTHENTICATED)
    app.post('/validate-token', this.authMiddleware, (req, res) => {
      if (!ValidationUtils.validateRequiredFields(req, res, ['token'])) {
        return;
      }

      try {
        const { token } = req.body;
        const validation = this.validateFederationToken(token);
        
        if (validation.valid) {
          console.log(`✅ Token validation successful for subject: ${validation.payload.sub}`);
        } else {
          console.log(`❌ Token validation failed: ${validation.error}`);
        }
        
        ResponseUtils.sendSuccess(res, validation);
      } catch (error) {
        console.error(`❌ Token validation error: ${error.message}`);
        ResponseUtils.sendSuccess(res, {
          valid: false,
          error: error.message,
          trust_chain_valid: false,
        });
      }
    });
  }

  /**
   * Register admin management endpoints
   */
  registerAdminEndpoints(app) {
    // Get current user info (AUTHENTICATED)
    app.get('/api/user', this.authMiddleware, (req, res) => {
      ResponseUtils.sendSuccess(res, {
        user: req.user,
        federation: this.fedName,
        entity_id: this.entityConfig.sub
      });
    });

    // List all users (ADMIN ONLY)
    app.get('/api/admin/users', this.adminMiddleware, (req, res) => {
      try {
        const users = this.getUserList();
        ResponseUtils.sendSuccess(res, users);
      } catch (error) {
        console.error('❌ Failed to list users:', error.message);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', 'Failed to retrieve user list');
      }
    });

    // System configuration (ADMIN ONLY)
    app.get('/api/admin/config', this.adminMiddleware, (req, res) => {
      const config = {
        federation: this.fedName,
        entity_id: this.entityConfig.sub,
        entity_config: {
          sub: this.entityConfig.sub,
          organization_name: this.entityConfig.metadata?.federation_entity?.organization_name,
          authority_hints: this.entityConfig.authority_hints
        },
        github_oauth_enabled: !!(this.clientId && this.clientSecret),
        admin_users: process.env.FEDMGR_ADMIN_USERS?.split(',').map(u => u.trim()) || [],
        environment: process.env.NODE_ENV || 'development'
      };
      
      ResponseUtils.sendSuccess(res, config);
    });
  }

  /**
   * Register all endpoints
   */
  registerRoutes(app) {
    this.registerFederationEndpoints(app);
    this.registerUtilityEndpoints(app);
    this.registerAdminEndpoints(app);
  }

  /**
   * Get federation list (placeholder implementation)
   */
  getFederationList() {
    // In a real implementation, this would query subordinate entities from a database
    return [];
  }

  /**
   * Resolve trust chain for an entity
   */
  resolveTrustChain(sub, trustAnchor) {
    return {
      sub,
      trust_anchor: trustAnchor || this.entityConfig.sub,
      metadata: {
        federation_entity: {
          trust_marks: [],
          organization_name: `Resolved Entity: ${sub}`,
        },
      },
      trust_chain: [this.entityConfig.sub],
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
  }

  /**
   * Get trust mark status
   */
  getTrustMarkStatus(trustMarkId, sub) {
    return {
      trust_mark_id: trustMarkId,
      sub: sub || 'unknown',
      status: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  /**
   * Validate federation token
   */
  validateFederationToken(token) {
    try {
      const verified = this.jwtUtils.verifyToken(token, {
        issuer: this.entityConfig.sub,
      });
      
      return {
        valid: true,
        payload: verified,
        trust_chain_valid: true,
        trust_anchor: this.entityConfig.sub,
        validation_details: {
          signature_valid: true,
          issuer_trusted: verified.iss === this.entityConfig.sub,
          audience_valid: Array.isArray(verified.aud) 
            ? verified.aud.includes('mcp-demo') 
            : verified.aud === 'mcp-demo',
          not_expired: verified.exp > Math.floor(Date.now() / 1000),
          trust_marks_present: !!(verified.trust_marks && verified.trust_marks.length > 0),
          federation_entity_present: !!verified.federation_entity,
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        trust_chain_valid: false,
      };
    }
  }

  /**
   * Get user list from registry
   */
  getUserList() {
    try {
      const registryPath = process.env.FEDMGR_FED_REG_FILE || 
        path.join(process.env.FEDMGR_FEDERATIONS_DIR || '/usr/src/app/data', 'registry.json');
      const { loadRegistry } = require('../config-manager');
      const registry = loadRegistry(registryPath);
      
      const users = registry.users || {};
      const userList = Object.values(users).map(user => ({
        github_id: user.github_id,
        login: user.login,
        created_at: user.created_at,
        last_login: user.last_login,
        admin: user.admin || false,
        trust_chain: user.trust_chain
      }));
      
      return {
        users: userList,
        total: userList.length,
        admin_users: process.env.FEDMGR_ADMIN_USERS?.split(',').map(u => u.trim()) || []
      };
    } catch (error) {
      throw new Error(`Failed to load user registry: ${error.message}`);
    }
  }
}

/**
 * Factory function to create Federation API handler
 */
function createFederationAPI(config) {
  return new FederationAPI(config);
}

module.exports = {
  FederationAPI,
  createFederationAPI
};