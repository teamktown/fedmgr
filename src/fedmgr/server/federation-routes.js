const fs = require('fs');
const jwt = require('jsonwebtoken');

function registerFederationRoutes(app, opts) {
  const { fedName, entityConfig, publicKeyPath, publicDir, clientId, clientSecret } = opts;

  app.get('/.well-known/openid-federation', (req, res) => {
    console.log(`📤 Serving entity configuration for ${fedName}`);
    res.json(entityConfig);
  });

  app.get('/resolve', (req, res) => {
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

  app.get('/trust-mark-status', (req, res) => {
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

  app.post('/validate-token', (req, res) => {
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
}

module.exports = registerFederationRoutes;
