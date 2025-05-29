const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getConfig } = require('./config');
const { handleWhoami, handleShowtrust, handleStats, handleStatus } = require('./api-handlers');

const app = express();
const config = getConfig();

app.use(express.json());

// Enhanced JWT validation middleware with federation support
const validateFederationJwt = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    // Decode token to get issuer
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const issuer = decoded.payload.iss;
    const federationAdminUrl = process.env.FEDERATION_ADMIN_URL || 'http://localhost:3001';

    // Validate with federation admin
    const validationResponse = await fetch(`${federationAdminUrl}/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const validationResult = await validationResponse.json();

    if (!validationResult.valid) {
      return res.status(403).json({ error: 'Token validation failed', reason: validationResult.error });
    }

    // Attach user info to request
    req.user = validationResult.payload;
    req.federationInfo = {
      trust_chain_valid: validationResult.trust_chain_valid,
      issuer: issuer
    };

    next();
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Token validation failed', reason: error.message });
  }
};

// Middleware for logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} - User: ${req.user?.login || 'anonymous'}`);
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
    federation_integration: 'enabled'
  });
});

// Protected API endpoints
app.get('/api', (req, res) => {
  res.json({
    message: 'Hello from MCP!',
    user: req.user.login,
    federation: req.federationInfo.issuer,
    trust_chain: req.federationInfo.trust_chain_valid ? 'valid' : 'invalid',
    timestamp: new Date().toISOString()
  });
});

app.get('/whoami', handleWhoami);
app.get('/showtrust', handleShowtrust);
app.get('/stats', handleStats);
app.get('/status', handleStatus);

const startServer = () => {
  const server = app.listen(config.mcpPort, config.mcpHost, () => {
    console.log(`🤖 MCP server listening on http://${config.mcpHost}:${config.mcpPort}`);
    console.log(`🔒 Federation JWT validation enabled`);
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
