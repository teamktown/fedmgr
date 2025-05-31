const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { getConfig } = require('./config');
const { handleWhoami, handleShowtrust, handleStats, handleStatus } = require('./api-handlers');

// Initialize Express app
const app = express();
const config = getConfig();

app.use(express.json());

// Enable CORS for federation testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Configure static files directory
const publicDir = process.env.MCP_PUBLIC_DIR || path.join(__dirname, '../../public');
console.log(`📁 Serving static files from: ${publicDir}`);

// Serve static files
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  console.log(`✅ Static files directory found and configured`);
} else {
  console.log(`⚠️ Static files directory not found: ${publicDir}`);
}

// Enhanced JWT validation middleware with comprehensive OIDCFed support
const validateFederationJwt = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log(`🔍 Received request to ${req.path}`);
  console.log(`🔍 Authorization header present: ${!!authHeader}`);

  if (!token) {
    console.log(`❌ No token provided for ${req.path}`);
    return res.status(401).json({ 
      error: 'Missing authorization token',
      oidcfed_validation: {
        step: 'token_extraction',
        success: false,
        reason: 'No Bearer token provided'
      },
      help: 'Please login at http://localhost:3001 and use the JWT token'
    });
  }

  try {
    // Step 1: Decode token to inspect claims
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      console.log(`❌ Invalid token format for ${req.path}`);
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
    const subject = decoded.payload.sub;
    const audience = decoded.payload.aud;
    const federationAdminUrl = process.env.FEDERATION_ADMIN_URL || 'http://federation-admin:3001';

    console.log(`🔍 Token details:`);
    console.log(`  - Issuer: ${issuer}`);
    console.log(`  - Subject: ${subject}`);
    console.log(`  - Audience: ${JSON.stringify(audience)}`);
    console.log(`  - GitHub User: ${decoded.payload.preferred_username}`);

    // Step 2: Validate with federation admin
    console.log(`🔗 Validating token with federation admin: ${federationAdminUrl}`);
    
    let validationResponse;
    try {
      validationResponse = await fetch(`${federationAdminUrl}/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        timeout: 5000
      });
    } catch (fetchError) {
      console.error(`❌ Failed to connect to federation admin: ${fetchError.message}`);
      return res.status(503).json({
        error: 'Federation validation service unavailable',
        oidcfed_validation: {
          step: 'federation_connection',
          success: false,
          reason: `Cannot connect to federation admin at ${federationAdminUrl}`,
          details: fetchError.message
        }
      });
    }

    if (!validationResponse.ok) {
      console.log(`❌ Federation admin returned ${validationResponse.status}`);
      const errorText = await validationResponse.text();
      return res.status(503).json({
        error: 'Federation validation failed',
        oidcfed_validation: {
          step: 'federation_response',
          success: false,
          reason: `Federation admin returned ${validationResponse.status}`,
          details: errorText
        }
      });
    }

    const validationResult = await validationResponse.json();
    console.log(`🔍 Validation result received from federation`);

    if (!validationResult.valid) {
      console.log(`❌ Token validation failed: ${validationResult.error}`);
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

// Root route with MCP-focused interface
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  
  console.log(`🔍 Looking for index.html at: ${indexPath}`);
  
  if (fs.existsSync(indexPath)) {
    console.log(`✅ Found index.html, serving file`);
    res.sendFile(indexPath);
  } else {
    console.log(`❌ index.html not found, serving MCP fallback HTML`);
    // MCP-focused fallback HTML
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MCP Server - ${config.mcpId}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
          .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; text-align: center; }
          .container { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .auth-notice { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
          button { background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
          button:hover { background: #218838; }
          .endpoint { background: #f8f9fa; padding: 8px; border-radius: 4px; margin: 5px 0; font-family: monospace; }
          .status-box { background: #e8f4f8; padding: 15px; border-radius: 4px; margin: 15px 0; }
          .test-results { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 10px 0; white-space: pre-wrap; font-family: monospace; font-size: 12px; max-height: 400px; overflow-y: auto; }
          .federation-link { background: #007cba; color: white; padding: 15px; border-radius: 4px; margin: 15px 0; text-align: center; }
          .federation-link a { color: white; text-decoration: none; font-weight: bold; }
          .success { color: #28a745; }
          .error { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🤖 MCP Server - ${config.mcpId}</h1>
          <p>Model Context Protocol with OpenID Federation Trust</p>
        </div>
        
        <div class="federation-link">
          <h3>🔐 Need Authentication?</h3>
          <p>Get your JWT token from the Federation Admin:</p>
          <a href="http://localhost:3001" target="_blank">Go to Federation Admin (localhost:3001)</a>
        </div>
        
        <div class="container">
          <h2>📊 Server Information</h2>
          <div class="status-box">
            <p><strong>MCP ID:</strong> ${config.mcpId}</p>
            <p><strong>Port:</strong> ${config.mcpPort}</p>
            <p><strong>Authentication Required:</strong> Yes (JWT from Federation)</p>
          </div>
        </div>
        
        <div class="container">
          <h2>🔑 Token Testing</h2>
          <div class="auth-notice">
            <strong>📋 How to Test:</strong>
            <ol>
              <li>Go to <a href="http://localhost:3001" target="_blank">Federation Admin</a></li>
              <li>Login with GitHub OAuth</li>
              <li>Copy your JWT token</li>
              <li>Paste it below and test the endpoints</li>
            </ol>
          </div>
          
          <h3>JWT Token Input</h3>
          <input type="text" id="token-input" placeholder="Paste your JWT token here" style="width: 100%; padding: 8px; margin: 5px 0;">
          <button onclick="testApi()">Test Main API</button>
          <button onclick="testWhoami()">Test Whoami</button>
          <div id="test-results" class="test-results"></div>
        </div>

        <div class="container">
          <h2>🔌 MCP API Endpoints</h2>
          <div class="endpoint">🏥 GET /health - Health check (public)</div>
          <div class="endpoint">🤖 GET /api - Main MCP API with user details</div>
          <div class="endpoint">👤 GET /whoami - MCP identity and federation info</div>
          
          <button onclick="testHealth()">Test Health (Public)</button>
          <div id="health-results" class="test-results"></div>
        </div>

        <script>
          async function testHealth() {
            try {
              const response = await fetch('/health');
              const data = await response.json();
              document.getElementById('health-results').textContent = 
                '✅ Health Check Result:\\n' + JSON.stringify(data, null, 2);
            } catch (error) {
              document.getElementById('health-results').textContent = 
                '❌ Health Check Failed:\\n' + error.message;
            }
          }
          
          async function makeAuthenticatedRequest(endpoint, displayName) {
            const token = document.getElementById('token-input').value.trim();
            
            if (!token) {
              alert('Please enter your JWT token first');
              return;
            }
            
            try {
              const response = await fetch(endpoint, {
                headers: { 
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                }
              });
              const data = await response.json();
              
              const resultText = response.ok 
                ? '✅ ' + displayName + ' Result:\\n' + JSON.stringify(data, null, 2)
                : '❌ ' + displayName + ' Failed (Status: ' + response.status + '):\\n' + JSON.stringify(data, null, 2);
              
              document.getElementById('test-results').textContent = resultText;
            } catch (error) {
              document.getElementById('test-results').textContent = 
                '❌ ' + displayName + ' Failed:\\n' + error.message;
            }
          }
          
          async function testApi() {
            await makeAuthenticatedRequest('/api', 'Main API');
          }
          
          async function testWhoami() {
            await makeAuthenticatedRequest('/whoami', 'Whoami');
          }
        </script>
      </body>
      </html>
    `);
  }
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
    static_files_dir: publicDir,
    static_files_available: fs.existsSync(publicDir),
    trust_anchor: 'http://localhost:3001',
    timestamp: new Date().toISOString()
  });
});

// Enhanced API endpoint with comprehensive OIDCFed details
app.get('/api', (req, res) => {
  console.log(`✅ Serving /api for authenticated user: ${req.user.preferred_username}`);
  
  res.json({
    message: 'Hello from OIDCFed MCP Server!',
    mcp_server: {
      id: config.mcpId,
      federation_aware: true,
      trust_validation: 'active'
    },
    authenticated_user: {
      subject: req.user.sub,
      username: req.user.preferred_username,
      name: req.user.name,
      email: req.user.email,
      github_id: req.user.github?.id,
      github_login: req.user.github?.login
    },
    federation_trust: {
      issuer: req.federationInfo.issuer,
      trust_anchor: req.federationInfo.trust_anchor,
      trust_chain_valid: req.federationInfo.trust_chain_valid
    },
    timestamp: new Date().toISOString()
  });
});

// Enhanced whoami with federation details
const enhancedHandleWhoami = (req, res) => {
  try {
    console.log(`✅ Serving /whoami for authenticated user: ${req.user.preferred_username}`);
    
    const whoamiData = {
      mcp_identity: {
        id: config.mcpId,
        publicKey: config.mcpPublicKey,
        base_url: config.mcpBaseUrl
      },
      federation_info: {
        trust_anchor: req.federationInfo.trust_anchor,
        trust_chain_valid: req.federationInfo.trust_chain_valid,
        oidcfed_compliant: true,
        issuer: req.federationInfo.issuer
      },
      authenticated_user: {
        subject: req.user.sub,
        username: req.user.preferred_username,
        name: req.user.name,
        federation_issuer: req.federationInfo.issuer
      }
    };
    
    res.json(whoamiData);
  } catch (error) {
    console.error('Error handling /whoami:', error);
    res.status(500).json({ 
      errorCode: 'INTERNAL_ERROR', 
      errorMessage: 'Failed to retrieve identity information.',
      error: error.message
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
    console.log(`📁 Static files served from: ${publicDir}`);
    console.log(`🔗 Trust anchor: http://localhost:3001`);
    console.log(`📋 Test the server at: http://localhost:${config.mcpPort}`);
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
