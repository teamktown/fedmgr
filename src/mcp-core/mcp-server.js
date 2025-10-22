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
      validationResponse = await fetch(`${federationAdminUrl}/api/v1/federation/validate-token`, {
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

// MCP Protocol Implementation
class MCPProtocolHandler {
  constructor() {
    this.tools = new Map();
    this.resources = new Map();
    this.registerDefaultTools();
    this.registerDefaultResources();
  }

  registerDefaultTools() {
    console.log('🔧 Registering MCP tools...');
    
    // Whoami tool - matches your existing /whoami endpoint
    this.tools.set('whoami', {
      name: 'whoami',
      description: 'Get MCP server identity and federation information',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      execute: async (args, context) => {
        console.log('🔧 Executing whoami tool');
        try {
          const whoamiData = {
            mcp_identity: {
              id: config.mcpId,
              publicKey: config.mcpPublicKey,
              base_url: config.mcpBaseUrl,
              protocol_support: ['HTTP REST', 'MCP JSON-RPC']
            },
            federation_info: {
              trust_anchor: context.federationInfo.trust_anchor,
              trust_chain_valid: context.federationInfo.trust_chain_valid,
              oidcfed_compliant: true,
              issuer: context.federationInfo.issuer
            },
            authenticated_user: {
              subject: context.user.sub,
              username: context.user.preferred_username,
              name: context.user.name,
              federation_issuer: context.federationInfo.issuer
            }
          };
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(whoamiData, null, 2)
            }]
          };
        } catch (error) {
          console.error('Error in whoami tool:', error);
          throw new Error(`Failed to get identity information: ${error.message}`);
        }
      }
    });

    // Showtrust tool - matches your existing /showtrust endpoint  
    this.tools.set('showtrust', {
      name: 'showtrust',
      description: 'Show trusted entities and federation trust information',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      execute: async (args, context) => {
        console.log('🔧 Executing showtrust tool');
        try {
          // Get trusted entities (similar to your existing logic)
          const trustStorePath = config.trustStorePath || path.join(__dirname, '../../data/trust-store.json');
          let trustedEntities = [];
          
          try {
            if (fs.existsSync(trustStorePath)) {
              const trustData = fs.readFileSync(trustStorePath, 'utf8');
              trustedEntities = JSON.parse(trustData);
            }
          } catch (error) {
            console.warn('Could not read trust store:', error.message);
          }

          const trustInfo = {
            federation_trust: {
              trust_anchor: context.federationInfo.trust_anchor,
              trust_chain_valid: context.federationInfo.trust_chain_valid,
              issuer: context.federationInfo.issuer,
              validation_details: context.federationInfo.validation_details
            },
            trusted_entities: trustedEntities,
            current_user_trust: {
              subject: context.user.sub,
              username: context.user.preferred_username,
              github_verified: !!context.user.github,
              trust_marks: context.user.trust_marks || []
            }
          };
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(trustInfo, null, 2)
            }]
          };
        } catch (error) {
          console.error('Error in showtrust tool:', error);
          throw new Error(`Failed to get trust information: ${error.message}`);
        }
      }
    });

    // System status tool
    this.tools.set('get_system_status', {
      name: 'get_system_status',
      description: 'Get system status and health information',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      execute: async (args, context) => {
        console.log('🔧 Executing get_system_status tool');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'healthy',
              mcp_id: config.mcpId,
              uptime: process.uptime(),
              memory: process.memoryUsage(),
              federation_connected: true,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    });

    // Add a tool with parameters to test schema validation
    this.tools.set('get_federation_info', {
      name: 'get_federation_info',
      description: 'Get detailed federation information with optional filters',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          include_trust_chain: {
            type: 'boolean',
            description: 'Include detailed trust chain information',
            default: false
          },
          include_user_details: {
            type: 'boolean',
            description: 'Include authenticated user details',
            default: true
          }
        },
        additionalProperties: false
      },
      execute: async (args, context) => {
        console.log('🔧 Executing get_federation_info tool with args:', args);
        
        const result = {
          federation_basic: {
            mcp_id: config.mcpId,
            trust_anchor: context.federationInfo.trust_anchor,
            issuer: context.federationInfo.issuer
          }
        };

        if (args.include_trust_chain !== false) {
          result.trust_chain_details = {
            trust_chain_valid: context.federationInfo.trust_chain_valid,
            validation_details: context.federationInfo.validation_details,
            oidcfed_validation: context.federationInfo.oidcfed_validation
          };
        }

        if (args.include_user_details !== false) {
          result.user_details = {
            subject: context.user.sub,
            username: context.user.preferred_username,
            name: context.user.name,
            github: context.user.github
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    });

    console.log(`✅ Registered ${this.tools.size} MCP tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }

  registerDefaultResources() {
    console.log('📚 Registering MCP resources...');
    
    this.resources.set('federation://config', {
      uri: 'federation://config',
      name: 'Federation Configuration',
      description: 'Current federation configuration and trust settings',
      mimeType: 'application/json',
      getData: (context) => {
        return {
          contents: [{
            uri: 'federation://config',
            mimeType: 'application/json',
            text: JSON.stringify({
              mcp_id: config.mcpId,
              trust_anchor: context?.federationInfo?.trust_anchor,
              federation_aware: true,
              oidcfed_compliant: true
            }, null, 2)
          }]
        };
      }
    });

    this.resources.set('user://profile', {
      uri: 'user://profile',
      name: 'User Profile',
      description: 'Current authenticated user profile information',
      mimeType: 'application/json',
      getData: (context) => {
        return {
          contents: [{
            uri: 'user://profile',
            mimeType: 'application/json',
            text: JSON.stringify({
              subject: context?.user?.sub,
              username: context?.user?.preferred_username,
              name: context?.user?.name,
              email: context?.user?.email,
              github: context?.user?.github
            }, null, 2)
          }]
        };
      }
    });

    console.log(`✅ Registered ${this.resources.size} MCP resources: ${Array.from(this.resources.keys()).join(', ')}`);
  }

  async handleInitialize(params) {
    console.log('🚀 MCP Initialize called with params:', JSON.stringify(params, null, 2));
    const result = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {}
      },
      serverInfo: {
        name: config.mcpId || 'mcp-federated-server',
        version: '1.0.0'
      }
    };
    console.log('✅ MCP Initialize response:', JSON.stringify(result, null, 2));
    return result;
  }

  async handleListTools(params, context) {
    console.log('🔧 MCP List Tools called');
    const tools = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
    console.log(`✅ Returning ${tools.length} tools:`, tools.map(t => t.name));
    return { tools };
  }

  async handleCallTool(params, context) {
    const { name, arguments: args } = params;
    console.log(`🔧 MCP Call Tool: ${name} with args:`, JSON.stringify(args, null, 2));
    
    const tool = this.tools.get(name);
    if (!tool) {
      console.error(`❌ Tool not found: ${name}`);
      throw new Error(`Tool not found: ${name}`);
    }

    try {
      const result = await tool.execute(args, context);
      console.log(`✅ Tool ${name} executed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Tool ${name} execution failed:`, error);
      throw error;
    }
  }

  async handleListResources(params, context) {
    console.log('📚 MCP List Resources called');
    const resources = Array.from(this.resources.values()).map(resource => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType
    }));
    console.log(`✅ Returning ${resources.length} resources:`, resources.map(r => r.uri));
    return { resources };
  }

  async handleReadResource(params, context) {
    const { uri } = params;
    console.log(`📚 MCP Read Resource: ${uri}`);
    
    const resource = this.resources.get(uri);
    if (!resource) {
      console.error(`❌ Resource not found: ${uri}`);
      throw new Error(`Resource not found: ${uri}`);
    }

    try {
      const result = resource.getData(context);
      console.log(`✅ Resource ${uri} read successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Resource ${uri} read failed:`, error);
      throw error;
    }
  }
}

const mcpHandler = new MCPProtocolHandler();

// Middleware for logging
app.use((req, res, next) => {
  const userInfo = req.user?.preferred_username || req.user?.sub || 'anonymous';
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} - User: ${userInfo}`);
  next();
});

// Root route with enhanced MCP interface
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  
  console.log(`🔍 Looking for index.html at: ${indexPath}`);
  
  if (fs.existsSync(indexPath)) {
    console.log(`✅ Found index.html, serving file`);
    res.sendFile(indexPath);
  } else {
    console.log(`❌ index.html not found, serving MCP fallback HTML`);
    // Enhanced MCP-focused fallback HTML
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
          .mcp-config { background: #e8f5e8; padding: 15px; border-radius: 4px; margin: 15px 0; }
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
          <h2>🔌 MCP Configuration for VS Code</h2>
          <div class="mcp-config">
            <p><strong>Add this to your VS Code settings.json:</strong></p>
            <pre>{
  "mcp.servers": {
    "${config.mcpId}": {
      "url": "http://localhost:${config.mcpPort}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN_HERE",
        "Content-Type": "application/json"
      }
    }
  }
}</pre>
            <p><strong>Available MCP Tools:</strong> whoami, showtrust, get_system_status, get_federation_info</p>
            <p><strong>Available MCP Resources:</strong> federation://config, user://profile</p>
          </div>
        </div>
        
        <div class="container">
          <h2>📊 Server Information</h2>
          <div class="status-box">
            <p><strong>MCP ID:</strong> ${config.mcpId}</p>
            <p><strong>Port:</strong> ${config.mcpPort}</p>
            <p><strong>Protocol Support:</strong> HTTP REST + MCP JSON-RPC</p>
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
          <button onclick="testMcpInitialize()">Test MCP Initialize</button>
          <button onclick="testMcpTools()">Test MCP Tools</button>
          <button onclick="testMcpWhoami()">Test MCP Whoami Tool</button>
          <button onclick="testApi()">Test REST API</button>
          <div id="test-results" class="test-results"></div>
        </div>

        <div class="container">
          <h2>🔌 Available Endpoints</h2>
          <h3>REST API Endpoints:</h3>
          <div class="endpoint">🏥 GET /health - Health check (public)</div>
          <div class="endpoint">🤖 GET /api - Main API with user details</div>
          <div class="endpoint">👤 GET /whoami - MCP identity and federation info</div>
          
          <h3>MCP Protocol Endpoints:</h3>
          <div class="endpoint">🔧 POST /mcp - MCP JSON-RPC endpoint</div>
          <div class="endpoint">📋 Methods: initialize, tools/list, tools/call, resources/list, resources/read</div>
          
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
          
          async function makeAuthenticatedRequest(endpoint, displayName, body = null, method = 'GET') {
            const token = document.getElementById('token-input').value.trim();
            
            if (!token) {
              alert('Please enter your JWT token first');
              return;
            }
            
            try {
              const options = {
                method: method,
                headers: { 
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                }
              };
              
              if (body) {
                options.body = JSON.stringify(body);
              }
              
              const response = await fetch(endpoint, options);
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
            await makeAuthenticatedRequest('/api', 'REST API');
          }
          
          async function testMcpInitialize() {
            const mcpRequest = {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
              }
            };
            await makeAuthenticatedRequest('/mcp', 'MCP Initialize', mcpRequest, 'POST');
          }
          
          async function testMcpTools() {
            const mcpRequest = {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {}
            };
            await makeAuthenticatedRequest('/mcp', 'MCP Tools List', mcpRequest, 'POST');
          }
          
          async function testMcpWhoami() {
            const mcpRequest = {
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'whoami',
                arguments: {}
              }
            };
            await makeAuthenticatedRequest('/mcp', 'MCP Whoami Tool', mcpRequest, 'POST');
          }
        </script>
      </body>
      </html>
    `);
  }
});

// MCP JSON-RPC endpoint
app.post('/mcp', validateFederationJwt, async (req, res) => {
  try {
    console.log('📨 MCP Request received:', JSON.stringify(req.body, null, 2));
    
    const { jsonrpc, id, method, params } = req.body;
    
    if (jsonrpc !== '2.0') {
      console.error('❌ Invalid JSON-RPC version:', jsonrpc);
      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request - must be JSON-RPC 2.0' }
      });
    }

    let result;
    const context = { user: req.user, federationInfo: req.federationInfo };

    switch (method) {
      case 'initialize':
        result = await mcpHandler.handleInitialize(params);
        break;
      case 'tools/list':
        result = await mcpHandler.handleListTools(params, context);
        break;
      case 'tools/call':
        result = await mcpHandler.handleCallTool(params, context);
        break;
      case 'resources/list':
        result = await mcpHandler.handleListResources(params, context);
        break;
      case 'resources/read':
        result = await mcpHandler.handleReadResource(params, context);
        break;
      default:
        console.error('❌ Unknown MCP method:', method);
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }

    const response = {
      jsonrpc: '2.0',
      id,
      result
    };
    
    console.log('📤 MCP Response:', JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error('❌ MCP request error:', error);
    res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: { code: -32603, message: error.message }
    });
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
    mcp_protocol_support: 'active',
    mcp_tools: Array.from(mcpHandler.tools.keys()),
    mcp_resources: Array.from(mcpHandler.resources.keys()),
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
      trust_validation: 'active',
      protocol_support: ['HTTP REST', 'MCP JSON-RPC'],
      mcp_tools: Array.from(mcpHandler.tools.keys()),
      mcp_resources: Array.from(mcpHandler.resources.keys())
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
        base_url: config.mcpBaseUrl,
        protocol_support: ['HTTP REST', 'MCP JSON-RPC']
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
    console.log(`🔌 MCP JSON-RPC protocol support enabled`);
    console.log(`🔧 MCP Tools: ${Array.from(mcpHandler.tools.keys()).join(', ')}`);
    console.log(`📚 MCP Resources: ${Array.from(mcpHandler.resources.keys()).join(', ')}`);
    console.log(`📁 Static files served from: ${publicDir}`);
    console.log(`🔗 Trust anchor: http://localhost:3001`);
    console.log(`📋 Test the server at: http://localhost:${config.mcpPort}`);
    console.log(`🔧 MCP endpoint: POST http://localhost:${config.mcpPort}/mcp`);
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
