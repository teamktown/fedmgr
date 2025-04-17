const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')

const app = express()
const server = http.createServer(app)
const emitter = new EventEmitter()

// Parse command line arguments
const args = process.argv.slice(2);
let name, port;

for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--name') name = args[i + 1];
  if (args[i] === '--port') port = parseInt(args[i + 1]);
}

if (!name || !port) {
  console.error('❌ Missing required arguments: --name and --port');
  process.exit(1);
}

const baseDir = path.resolve(__dirname, '../../mcp_instances', name)
const configPath = path.join(baseDir, 'config')
const entityConfigFile = path.join(configPath, 'entity-configuration.json')
const telemetryPath = '/ws/telemetry'

// Entity statements received from MCP Interface
let entityStatements = [];

// Load entity configuration
let entityConfig = {};
if (fs.existsSync(entityConfigFile)) {
  entityConfig = JSON.parse(fs.readFileSync(entityConfigFile, 'utf-8'));
  log('INFO', 'CONFIG_LOADED', `Entity configuration loaded for ${name}`);
} else {
  log('ERROR', 'CONFIG_MISSING', `Entity configuration not found at ${entityConfigFile}`);
}

// Set up WebSocket for telemetry
const wss = new WebSocket.Server({ server, path: telemetryPath })
wss.on('connection', ws => {
  log('INFO', 'WS_CONNECTED', `WebSocket client connected`);
  const listener = log => ws.send(JSON.stringify(log))
  emitter.on('log', listener)
  ws.on('close', () => {
    emitter.off('log', listener);
    log('INFO', 'WS_DISCONNECTED', `WebSocket client disconnected`);
  })
})

function log(level, event, detail) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    detail,
    mcp: name
  };
  
  console.log(`[${level}] ${event}: ${detail}`);
  emitter.emit('log', logEntry);
  return logEntry;
}

// Serve entity configuration
app.get('/.well-known/openid-federation', (req, res) => {
  if (Object.keys(entityConfig).length === 0) {
    res.status(404).json({ error: 'Entity configuration not available' });
    return;
  }
  
  log('INFO', 'CONFIG_SERVED', `Entity configuration served`);
  res.json(entityConfig);
});

// Endpoint to receive entity statements from MCP Interface
app.post('/entity-statements', express.json(), (req, res) => {
  const { statements } = req.body;
  
  if (!statements || !Array.isArray(statements)) {
    log('ERROR', 'INVALID_STATEMENTS', `Invalid entity statements received`);
    res.status(400).json({ error: 'Invalid entity statements' });
    return;
  }
  
  entityStatements = statements;
  log('INFO', 'STATEMENTS_RECEIVED', `Received ${statements.length} entity statements`);
  res.json({ success: true, count: statements.length });
});

// Improved token validation
app.get('/api', (req, res) => {
  const authHeader = req.headers.authorization || '';
  
  if (!authHeader.startsWith('Bearer ')) {
    log('ERROR', 'INVALID_AUTH', `Missing or invalid Authorization header`);
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Log the token receipt
  log('INFO', 'CALL_RECEIVED', `Token received: ${token.substring(0, 10)}...`);
  
  // In a real implementation, we would:
  // 1. Decode the JWT
  // 2. Verify the signature using the federation trust chain
  // 3. Validate claims (exp, iss, aud, etc.)
  // 4. Check for revocation
  
  // For now, we'll simulate validation
  const validationResult = simulateTokenValidation(token);
  
  if (validationResult.valid) {
    log('INFO', 'VALIDATION_PASSED', `Trust validation passed: ${validationResult.reason}`);
    res.json({
      message: `Hello from ${name}!`,
      validation: 'passed',
      timestamp: new Date().toISOString()
    });
  } else {
    log('ERROR', 'VALIDATION_FAILED', `Trust validation failed: ${validationResult.reason}`);
    res.status(401).json({
      error: 'Token validation failed',
      reason: validationResult.reason
    });
  }
});

// Simulate token validation
function simulateTokenValidation(token) {
  // This is a placeholder for actual JWT validation logic
  // In a real implementation, this would verify the token against the federation trust chain
  
  // For demo purposes, we'll just check if the token is non-empty and has a valid format
  if (!token || token === 'none') {
    return { valid: false, reason: 'Missing token' };
  }
  
  // Check if it looks like a JWT (three dot-separated segments)
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { valid: false, reason: 'Invalid token format' };
  }
  
  // In a real implementation, we would:
  // - Decode the JWT
  // - Verify the signature using keys from the federation
  // - Validate claims (exp, iss, aud, etc.)
  
  return { valid: true, reason: 'Token format valid (simulated validation)' };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    name,
    entityConfigLoaded: Object.keys(entityConfig).length > 0,
    entityStatementsCount: entityStatements.length
  });
});

server.listen(port, () => {
  log('INFO', 'MCP_START', `MCP '${name}' running on http://localhost:${port}`);
  console.log(`🤖 MCP '${name}' running on http://localhost:${port}`);
  console.log(`📡 WebSocket telemetry available at ws://localhost:${port}${telemetryPath}`);
  console.log(`🔍 Entity configuration at http://localhost:${port}/.well-known/openid-federation`);
});
