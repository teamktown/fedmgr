/**
 * Admin API Routes
 * 
 * RESTful API endpoints for federation management operations
 * These routes complement the JSON-RPC server and provide HTTP-based
 * administration capabilities for the FedMgr system.
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const JSONRPCServer = require('./jsonrpc-server');

function registerAdminAPIRoutes(app, opts) {
  const { fedName, entityConfig, publicKeyPath, mcpInstancesDir, federationsDir } = opts;
  
  // Initialize JSON-RPC server instance for internal API calls
  const jsonrpcServer = new JSONRPCServer({
    port: 4000,
    mcpInstancesDir: mcpInstancesDir || path.resolve(__dirname, '../../../mcp_instances'),
    federationsDir: federationsDir || path.resolve(__dirname, '../../../federations')
  });
  
  // Middleware for admin API authentication
  function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.substring(7);
    // TODO: Validate token with federation system
    req.user = { token };
    next();
  }
  
  // API prefix
  const API_PREFIX = '/api/v1';
  
  // System Information Endpoints
  app.get(`${API_PREFIX}/system/info`, async (req, res) => {
    try {
      const info = await jsonrpcServer.getSystemInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/system/health`, async (req, res) => {
    try {
      const health = await jsonrpcServer.getSystemHealth();
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/system/restart`, requireAuth, async (req, res) => {
    try {
      // TODO: Implement system restart
      res.json({ message: 'System restart initiated' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Federation Management Endpoints
  app.get(`${API_PREFIX}/federation/info`, async (req, res) => {
    try {
      const info = await jsonrpcServer.getFederationInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/federation/config`, async (req, res) => {
    try {
      const config = await jsonrpcServer.getFederationConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.put(`${API_PREFIX}/federation/config`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.updateFederationConfig(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/federation/entities`, async (req, res) => {
    try {
      const entities = await jsonrpcServer.getFederationEntities();
      res.json(entities);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/federation/entities`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.addFederationEntity(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.delete(`${API_PREFIX}/federation/entities/:id`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.removeFederationEntity({ id: req.params.id });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/federation/validate-token`, async (req, res) => {
    try {
      const result = await jsonrpcServer.validateFederationToken(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // MCP Server Management Endpoints
  app.get(`${API_PREFIX}/mcp/servers`, async (req, res) => {
    try {
      const servers = await jsonrpcServer.listMCPServers();
      res.json(servers);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/mcp/servers`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.createMCPServer(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/mcp/servers/:name`, async (req, res) => {
    try {
      const status = await jsonrpcServer.getMCPServerStatus({ name: req.params.name });
      const config = await jsonrpcServer.getMCPServerConfig({ name: req.params.name });
      res.json({ ...status, config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/mcp/servers/:name/start`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.startMCPServer({ name: req.params.name });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/mcp/servers/:name/stop`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.stopMCPServer({ name: req.params.name });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post(`${API_PREFIX}/mcp/servers/:name/restart`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.restartMCPServer({ name: req.params.name });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/mcp/servers/:name/status`, async (req, res) => {
    try {
      const status = await jsonrpcServer.getMCPServerStatus({ name: req.params.name });
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/mcp/servers/:name/logs`, async (req, res) => {
    try {
      const logs = await jsonrpcServer.getMCPServerLogs({ name: req.params.name });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/mcp/servers/:name/config`, async (req, res) => {
    try {
      const config = await jsonrpcServer.getMCPServerConfig({ name: req.params.name });
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.put(`${API_PREFIX}/mcp/servers/:name/config`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.updateMCPServerConfig({ 
        name: req.params.name,
        ...req.body 
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // OAuth Configuration Endpoints
  app.get(`${API_PREFIX}/oauth/config`, async (req, res) => {
    try {
      const config = await jsonrpcServer.getOAuthConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.put(`${API_PREFIX}/oauth/config`, requireAuth, async (req, res) => {
    try {
      const result = await jsonrpcServer.updateOAuthConfig(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // WebSocket endpoint for real-time updates
  app.get(`${API_PREFIX}/ws`, (req, res) => {
    res.json({
      websocket_url: `ws://${req.get('host')}/ws`,
      jsonrpc_websocket_url: `ws://${req.get('host')}/jsonrpc`,
      protocols: ['json-rpc-2.0', 'fedmgr-admin']
    });
  });
  
  // JSON-RPC proxy endpoint
  app.post(`${API_PREFIX}/jsonrpc`, async (req, res) => {
    try {
      const result = await jsonrpcServer.processRequest(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id: req.body.id || null
      });
    }
  });
  
  // Utility endpoints
  app.get(`${API_PREFIX}/util/generate-id`, async (req, res) => {
    try {
      const id = await jsonrpcServer.generateId();
      res.json({ id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get(`${API_PREFIX}/util/timestamp`, async (req, res) => {
    try {
      const timestamp = await jsonrpcServer.getTimestamp();
      res.json({ timestamp });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // File management endpoints
  app.get(`${API_PREFIX}/files/federation/:path(*)`, async (req, res) => {
    try {
      const filePath = path.join(federationsDir, req.params.path);
      
      // Security check: ensure path is within federations directory
      if (!filePath.startsWith(path.resolve(federationsDir))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          res.json({ 
            path: req.params.path,
            content,
            size: stats.size,
            modified: stats.mtime
          });
        } else {
          const files = fs.readdirSync(filePath);
          res.json({
            path: req.params.path,
            type: 'directory',
            files
          });
        }
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.put(`${API_PREFIX}/files/federation/:path(*)`, requireAuth, async (req, res) => {
    try {
      const filePath = path.join(federationsDir, req.params.path);
      
      // Security check: ensure path is within federations directory
      if (!filePath.startsWith(path.resolve(federationsDir))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Ensure directory exists
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      
      // Write file
      fs.writeFileSync(filePath, req.body.content);
      
      res.json({ 
        path: req.params.path,
        message: 'File saved successfully'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // API documentation endpoint
  app.get(`${API_PREFIX}`, (req, res) => {
    res.json({
      name: 'FedMgr Admin API',
      version: '1.0.0',
      description: 'RESTful API for federation and MCP server management',
      endpoints: {
        system: [
          'GET /api/v1/system/info',
          'GET /api/v1/system/health',
          'POST /api/v1/system/restart'
        ],
        federation: [
          'GET /api/v1/federation/info',
          'GET /api/v1/federation/config',
          'PUT /api/v1/federation/config',
          'GET /api/v1/federation/entities',
          'POST /api/v1/federation/entities',
          'DELETE /api/v1/federation/entities/:id',
          'POST /api/v1/federation/validate-token'
        ],
        mcp: [
          'GET /api/v1/mcp/servers',
          'POST /api/v1/mcp/servers',
          'GET /api/v1/mcp/servers/:name',
          'POST /api/v1/mcp/servers/:name/start',
          'POST /api/v1/mcp/servers/:name/stop',
          'POST /api/v1/mcp/servers/:name/restart',
          'GET /api/v1/mcp/servers/:name/status',
          'GET /api/v1/mcp/servers/:name/logs',
          'GET /api/v1/mcp/servers/:name/config',
          'PUT /api/v1/mcp/servers/:name/config'
        ],
        oauth: [
          'GET /api/v1/oauth/config',
          'PUT /api/v1/oauth/config'
        ],
        utils: [
          'GET /api/v1/util/generate-id',
          'GET /api/v1/util/timestamp',
          'GET /api/v1/ws',
          'POST /api/v1/jsonrpc'
        ],
        files: [
          'GET /api/v1/files/federation/:path',
          'PUT /api/v1/files/federation/:path'
        ]
      },
      authentication: 'Bearer token required for write operations',
      websocket: 'Available at /ws and /jsonrpc endpoints'
    });
  });
  
  console.log(`🔗 Admin API routes registered at ${API_PREFIX}`);
  
  return jsonrpcServer;
}

module.exports = registerAdminAPIRoutes;