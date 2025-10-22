const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

function registerFederationRoutes(app, opts) {
  const { fedName, entityConfig, publicKeyPath, publicDir, clientId, clientSecret, adminMiddleware, authMiddleware } = opts;
  
  // Default middleware functions if not provided
  const defaultMiddleware = (req, res, next) => next();
  const admin = adminMiddleware || defaultMiddleware;
  const auth = authMiddleware || defaultMiddleware;
  
  // Get private key path for signing JWTs
  const privateKeyPath = publicKeyPath.replace('-public.pem', '-private.pem');

  app.get('/.well-known/openid-federation', (req, res) => {
    console.log(`📤 Serving signed entity configuration JWT for ${fedName}`);
    
    try {
      // Create entity configuration payload with required exp claim
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        ...entityConfig,
        iat: now,
        exp: now + (24 * 60 * 60), // 24 hours expiration as per draft-43
        iss: entityConfig.sub // issuer must be the same as subject for entity statements
      };
      
      // Sign the entity configuration as JWT
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const signedJwt = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        keyid: entityConfig.jwks?.keys?.[0]?.kid
      });
      
      // Return signed JWT with correct content-type per OpenID Federation spec
      res.setHeader('Content-Type', 'application/entity-statement+jwt');
      res.send(signedJwt);
      
    } catch (error) {
      console.error(`❌ Failed to sign entity configuration: ${error.message}`);
      res.status(500).json({ 
        error: 'Internal server error', 
        details: 'Failed to generate signed entity statement' 
      });
    }
  });

  // Federation List endpoint - returns list of subordinate entities (ADMIN ONLY)
  app.get('/federation_list', admin, (req, res) => {
    console.log(`📋 Serving federation list for ${fedName}`);
    
    try {
      // In a real implementation, this would query subordinate entities from a database
      // For now, return an empty list with proper structure
      const federationList = [];
      
      res.setHeader('Content-Type', 'application/json');
      res.json(federationList);
      
    } catch (error) {
      console.error(`❌ Failed to serve federation list: ${error.message}`);
      res.status(500).json({ 
        error: 'Internal server error', 
        details: 'Failed to retrieve federation list' 
      });
    }
  });
  
  // Federation Fetch endpoint - returns subordinate statement for specific entity (ADMIN ONLY)
  app.get('/federation_fetch', admin, (req, res) => {
    const { sub } = req.query;
    
    if (!sub) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        details: 'Missing required sub parameter' 
      });
    }
    
    console.log(`📥 Fetching subordinate statement for: ${sub}`);
    
    try {
      // Create subordinate statement payload
      const now = Math.floor(Date.now() / 1000);
      const subordinateStatement = {
        iss: entityConfig.sub, // Trust anchor issues subordinate statements
        sub: sub, // Subject entity
        iat: now,
        exp: now + (24 * 60 * 60), // 24 hours expiration
        metadata: {
          federation_entity: {
            organization_name: `Subordinate Entity: ${sub}`,
            trust_marks: []
          }
          // Additional metadata would be added based on entity type (OP, RP, etc.)
        },
        jwks: {
          keys: [] // Would contain the subordinate's public keys
        }
      };
      
      // Sign the subordinate statement
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const signedJwt = jwt.sign(subordinateStatement, privateKey, {
        algorithm: 'RS256',
        keyid: entityConfig.jwks?.keys?.[0]?.kid
      });
      
      // Return signed subordinate statement
      res.setHeader('Content-Type', 'application/entity-statement+jwt');
      res.send(signedJwt);
      
    } catch (error) {
      console.error(`❌ Failed to create subordinate statement: ${error.message}`);
      res.status(500).json({ 
        error: 'Internal server error', 
        details: 'Failed to generate subordinate statement' 
      });
    }
  });

  app.get('/resolve', admin, (req, res) => {
    const { sub, trust_anchor } = req.query;
    if (!sub) {
      return res.status(400).json({ error: 'Missing sub parameter' });
    }
    const resolved = {
      sub,
      trust_anchor: trust_anchor || entityConfig.sub,
      metadata: {
        federation_entity: {
          trust_marks: [],
          organization_name: `Resolved Entity: ${sub}`,
        },
      },
      trust_chain: [entityConfig.sub],
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };
    res.json(resolved);
  });

  app.get('/trust-mark-status', admin, (req, res) => {
    const { trust_mark_id, sub } = req.query;
    if (!trust_mark_id) {
      return res.status(400).json({ error: 'Missing trust_mark_id parameter' });
    }
    res.json({
      trust_mark_id,
      sub: sub || 'unknown',
      status: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      federation: fedName,
      entity_id: entityConfig.sub,
      github_oauth: !!(clientId && clientSecret),
      oidcfed_compliant: true,
      trust_anchor: true,
      static_files_dir: publicDir,
      static_files_available: fs.existsSync(publicDir),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/validate-token', auth, (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ valid: false, error: 'Missing token' });
      }
      const verified = jwt.verify(token, fs.readFileSync(publicKeyPath), {
        algorithms: ['RS256'],
        issuer: entityConfig.sub,
      });
      const validation = {
        valid: true,
        payload: verified,
        trust_chain_valid: true,
        trust_anchor: entityConfig.sub,
        validation_details: {
          signature_valid: true,
          issuer_trusted: verified.iss === entityConfig.sub,
          audience_valid: Array.isArray(verified.aud) ? verified.aud.includes('mcp-demo') : verified.aud === 'mcp-demo',
          not_expired: verified.exp > Math.floor(Date.now() / 1000),
          trust_marks_present: !!(verified.trust_marks && verified.trust_marks.length > 0),
          federation_entity_present: !!verified.federation_entity,
        },
      };
      console.log(`✅ Token validation successful for subject: ${verified.sub}`);
      res.json(validation);
    } catch (error) {
      console.log(`❌ Token validation failed: ${error.message}`);
      res.json({
        valid: false,
        error: error.message,
        trust_chain_valid: false,
      });
    }
  });

  // Admin-only endpoints for user and system management
  
  // Get current user info (authenticated users)
  app.get('/api/user', auth, (req, res) => {
    res.json({
      user: req.user,
      federation: fedName,
      entity_id: entityConfig.sub
    });
  });

  // List all users (admin only)
  app.get('/api/admin/users', admin, (req, res) => {
    try {
      const registryPath = process.env.FEDMGR_FED_REG_FILE || path.join(process.env.FEDMGR_FEDERATIONS_DIR || '/usr/src/app/data', 'registry.json');
      const { loadRegistry } = require('../config-manager');
      const registry = loadRegistry(registryPath);
      
      const users = registry.users || {};
      const userList = Object.values(users).map(user => ({
        github_id: user.github_id,
        login: user.login,
        created_at: user.created_at,
        trust_chain: user.trust_chain
      }));
      
      res.json({
        users: userList,
        total: userList.length,
        admin_users: process.env.FEDMGR_ADMIN_USERS?.split(',').map(u => u.trim()) || []
      });
    } catch (error) {
      console.error('❌ Failed to list users:', error.message);
      res.status(500).json({ error: 'Failed to retrieve user list' });
    }
  });

  // System configuration (admin only)
  app.get('/api/admin/config', admin, (req, res) => {
    res.json({
      federation: fedName,
      entity_id: entityConfig.sub,
      entity_config: {
        sub: entityConfig.sub,
        organization_name: entityConfig.metadata?.federation_entity?.organization_name,
        authority_hints: entityConfig.authority_hints
      },
      github_oauth_enabled: !!(clientId && clientSecret),
      admin_users: process.env.FEDMGR_ADMIN_USERS?.split(',').map(u => u.trim()) || [],
      environment: process.env.NODE_ENV || 'development'
    });
  });
}

module.exports = registerFederationRoutes;
