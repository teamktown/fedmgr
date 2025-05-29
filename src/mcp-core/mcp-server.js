const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getConfig } = require('./config');
const { handleWhoami, handleShowtrust, handleStats, handleStatus } = require('./api-handlers');

const app = express();
const config = getConfig();

app.use(express.json());

// Enhanced JWT validation middleware with OIDCFed support
const validateFederationJwt = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Missing authorization token',
      oidcfed_validation: {
        step: 'token_extraction',
        success: false,
        reason: 'No Bearer token provided'
      }
    });
  }

  try {
    // Step 1: Decode token to inspect claims
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      return res.status(401).json({ 
        error: 'Invalid token format',
        oidcfed_validation: {
          step: 'token_decode',
          success: false,
          reason: 'Token is not a valid JWT'
        }
      });
    }

    const issuer = decoded.payload.iss;
    const federationAdminUrl = process.env.FEDERATION_ADMIN_URL || 'http://localhost:3001';

    console.log(`🔍 Validating token from issuer: ${issuer}`);
    console.log(`🔍 Token subject: ${decoded.payload.sub}`);
    console.log(`🔍 Token audience: ${JSON.stringify(decoded.payload.aud)}`);

    // Step 2: Validate with federation admin
    const validationResponse = await fetch(`${federationAdminUrl}/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const validationResult = await validationResponse.json();

    if (!validationResult.valid) {
      return res.status(403).json({ 
        error: 'Token validation failed', 
        reason: validationResult.error,
        oidcfed_validation: {
          step: 'federation_validation',
          success: false,
          reason: validationResult.error,
          trust_chain_valid: validationResult.trust_chain_valid || false
        }
      });
    }

    // Step 3: OIDCFed specific validation
    const oidcfedValidation = {
      step: 'oidcfed_validation',
      success: true,
      details: {
        trust_anchor: validationResult.trust_anchor,
        trust_chain_valid: validationResult.trust_chain_valid,
        signature_verified: true,
        issuer_trusted: true,
        audience_match: validationResult.validation_details?.audience_valid || false,
        not_expired: validationResult.validation_details?.not_expired || false,
        trust_marks_present: validationResult.validation_details?.trust_marks_present || false,
        federation_entity_claims: validationResult.validation_details?.federation_entity_present || false
      }
    };

    // Attach comprehensive user and federation info to request
    req.user = validationResult.payload;
    req.federationInfo = {
      trust_chain_valid: validationResult.trust_chain_valid,
      trust_anchor: validationResult.trust_anchor,
      issuer: issuer,
      validation_details: validationResult.validation_details,
      oidcfed_validation: oidcfedValidation
    };

    console.log(`✅ OIDCFed token validation successful for: ${req.user.preferred_username || req.user.sub}`);
    next();
  } catch (error) {
    console.error('❌ Token validation error:', error);
    res.status(500).json({ 
      error: 'Token validation failed', 
      reason: error.message,
      oidcfed_validation: {
        step: 'validation_error',
        success: false,
        reason: error.message
      }
    });
  }
};

// Middleware for logging
app.use((req, res, next) => {
  const userInfo = req.user?.preferred_username || req.user?.sub || 'anonymous';
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} - User: ${userInfo}`);
  next();
});

// Apply federation JWT validation to protected routes
app.use('/api', validateFederationJwt);
app.use('/whoami', validateFederationJwt);
app.use('/showtrust', validateFederationJwt);
app.use('/stats', validateFederationJwt);
app.use('/status', validateFederationJwt);

// Public health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mcp_id: config.mcpId,
    federation_integration: 'enabled',
    oidcfed_support: 'active',
    timestamp: new Date().toISOString()
  });
});

// Enhanced API endpoint with OIDCFed details
app.get('/api', (req, res) => {
  res.json({
    message: 'Hello from OIDCFed MCP Server!',
    user: {
      subject: req.user.sub,
      username: req.user.preferred_username,
      name: req.user.name,
      email: req.user.email,
      github_login: req.user.github?.login
    },
    federation: {
      issuer: req.federationInfo.issuer,
      trust_anchor: req.federationInfo.trust_anchor,
      trust_chain_valid: req.federationInfo.trust_chain_valid,
      validation_details: req.federationInfo.validation_details
    },
    oidcfed: {
      compliant: true,
      trust_marks: req.user.trust_marks?.length || 0,
      authority_hints: req.user.federation_entity?.authority_hints || []
    },
    timestamp: new Date().toISOString(),
    server_info: {
      mcp_id: config.mcpId,
      federation_aware: true
    }
  });
});

// Enhanced whoami with federation details
const enhancedHandleWhoami = (req, res) => {
  try {
    const whoamiData = {
      id: config.mcpId,
      publicKey: config.mcpPublicKey,
      endpoints: {
        showtrust: `${config.mcpBaseUrl}/showtrust`,
        stats: `${config.mcpBaseUrl}/stats`,
        status: `${config.mcpBaseUrl}/status`,
      },
      federation: {
        trust_anchor: req.federationInfo.trust_anchor,
        trust_chain_valid: req.federationInfo.trust_chain_valid,
        oidcfed_compliant: true
      },
      authenticated_user: {
        subject: req.user.sub,
        username: req.user.preferred_username,
        federation_issuer: req.federationInfo.issuer
      }
    };
    res.json(whoamiData);
  } catch (error) {
    console.error('Error handling /whoami:', error);
    res.status(500).json({ 
      errorCode: 'INTERNAL_ERROR', 
      errorMessage: 'Failed to retrieve identity information.' 
    });
  }
};

app.get('/whoami', enhancedHandleWhoami);
app.get('/showtrust', handleShowtrust);
app.get('/stats', handleStats);
app.get('/status', handleStatus);

const startServer = () => {
  const server = app.listen(config.mcpPort, config.mcpHost, () => {
    console.log(`🤖 MCP server listening on http://${config.mcpHost}:${config.mcpPort}`);
    console.log(`🔒 Federation JWT validation enabled`);
    console.log(`🛰️ OIDCFed trust validation active`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
