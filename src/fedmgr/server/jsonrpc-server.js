/**
 * JSON-RPC 2.0 Server Implementation
 * 
 * This server implements the JSON-RPC 2.0 specification to provide a standardized
 * API for federation management and MCP server control operations.
 * 
 * Features:
 * - JSON-RPC 2.0 compliance
 * - WebSocket and HTTP transport support
 * - Federation management methods
 * - MCP server control methods
 * - Authentication integration
 * - Real-time notifications
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn, exec } = require('child_process');

class JSONRPCServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.port = options.port || 4000;
    this.host = options.host || 'localhost';
    this.auth = options.auth || null;
    this.mcpInstancesDir = options.mcpInstancesDir || path.resolve(__dirname, '../../../mcp_instances');
    this.federationsDir = options.federationsDir || path.resolve(__dirname, '../../../federations');
    
    // Initialize Express app and HTTP server
    this.app = express();
    this.server = http.createServer(this.app);
    
    // WebSocket server for real-time communication
    this.wss = new WebSocket.Server({ server: this.server, path: '/jsonrpc' });
    
    // Connected clients
    this.clients = new Set();
    
    // Request ID counter
    this.requestIdCounter = 0;
    
    // Active processes
    this.processes = new Map();
    
    // Set up middleware
    this.setupMiddleware();
    
    // Set up routes
    this.setupRoutes();
    
    // Set up WebSocket handlers
    this.setupWebSocketHandlers();
    
    // Set up method handlers
    this.setupMethods();
  }
  
  setupMiddleware() {
    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
    
    // JSON parsing middleware
    this.app.use(express.json());
    
    // Authentication middleware
    this.app.use((req, res, next) => {
      if (this.auth && req.path.startsWith('/jsonrpc')) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Authentication required'
            },
            id: null
          });
        }
        
        const token = authHeader.substring(7);
        // TODO: Validate token with federation system
        req.user = { token };
      }
      next();
    });
  }
  
  setupRoutes() {
    // HTTP JSON-RPC endpoint
    this.app.post('/jsonrpc', (req, res) => {
      this.handleHTTPRequest(req, res);
    });
    
    // Health check endpoint
    this.app.get('/jsonrpc/health', (req, res) => {
      res.json({
        status: 'healthy',
        server: 'JSON-RPC 2.0',
        version: '1.0.0',
        clients: this.clients.size,
        processes: this.processes.size
      });
    });
    
    // Method discovery endpoint
    this.app.get('/jsonrpc/methods', (req, res) => {
      res.json({
        methods: Object.keys(this.methods),
        description: 'Available JSON-RPC methods'
      });
    });
  }
  
  setupWebSocketHandlers() {
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      
      console.log(`📡 JSON-RPC WebSocket client connected (${this.clients.size} total)`);
      
      // Send welcome message
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'server.welcome',
        params: {
          server: 'FedMgr JSON-RPC 2.0',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        }
      }));
      
      // Handle messages
      ws.on('message', (message) => {
        try {
          const request = JSON.parse(message);
          this.handleWebSocketRequest(ws, request);
        } catch (error) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error'
            },
            id: null
          }));
        }
      });
      
      // Handle disconnection
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`📡 JSON-RPC WebSocket client disconnected (${this.clients.size} remaining)`);
      });
    });
  }
  
  setupMethods() {
    this.methods = {
      // System methods
      'system.info': this.getSystemInfo.bind(this),
      'system.health': this.getSystemHealth.bind(this),
      'system.restart': this.restartSystem.bind(this),
      
      // Federation methods
      'federation.info': this.getFederationInfo.bind(this),
      'federation.config': this.getFederationConfig.bind(this),
      'federation.update': this.updateFederationConfig.bind(this),
      'federation.entities': this.getFederationEntities.bind(this),
      'federation.addEntity': this.addFederationEntity.bind(this),
      'federation.removeEntity': this.removeFederationEntity.bind(this),
      'federation.validateToken': this.validateFederationToken.bind(this),
      
      // MCP methods
      'mcp.list': this.listMCPServers.bind(this),
      'mcp.create': this.createMCPServer.bind(this),
      'mcp.start': this.startMCPServer.bind(this),
      'mcp.stop': this.stopMCPServer.bind(this),
      'mcp.restart': this.restartMCPServer.bind(this),
      'mcp.status': this.getMCPServerStatus.bind(this),
      'mcp.logs': this.getMCPServerLogs.bind(this),
      'mcp.config': this.getMCPServerConfig.bind(this),
      'mcp.updateConfig': this.updateMCPServerConfig.bind(this),
      
      // OAuth methods
      'oauth.config': this.getOAuthConfig.bind(this),
      'oauth.update': this.updateOAuthConfig.bind(this),
      
      // Utility methods
      'util.generateId': this.generateId.bind(this),
      'util.timestamp': this.getTimestamp.bind(this),
      'util.encrypt': this.encryptData.bind(this),
      'util.decrypt': this.decryptData.bind(this)
    };
  }
  
  async handleHTTPRequest(req, res) {
    try {
      const result = await this.processRequest(req.body);
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
  }
  
  async handleWebSocketRequest(ws, request) {
    try {
      const result = await this.processRequest(request);
      ws.send(JSON.stringify(result));
    } catch (error) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id: request.id || null
      }));
    }
  }
  
  async processRequest(request) {
    // Validate JSON-RPC 2.0 format
    if (!request.jsonrpc || request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request'
        },
        id: request.id || null
      };
    }
    
    // Handle batch requests
    if (Array.isArray(request)) {
      const results = await Promise.all(request.map(req => this.processRequest(req)));
      return results.filter(result => result !== null);
    }
    
    // Check if method exists
    if (!request.method || !this.methods[request.method]) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found'
        },
        id: request.id || null
      };
    }
    
    try {
      // Call method
      const result = await this.methods[request.method](request.params || {});
      
      // For notifications (no id), return null
      if (request.id === undefined) {
        return null;
      }
      
      return {
        jsonrpc: '2.0',
        result,
        id: request.id
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id: request.id || null
      };
    }
  }
  
  // Broadcast notification to all connected clients
  broadcast(method, params) {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };
    
    const message = JSON.stringify(notification);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  // Method implementations
  async getSystemInfo() {
    return {
      server: 'FedMgr JSON-RPC 2.0',
      version: '1.0.0',
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      clients: this.clients.size,
      processes: this.processes.size
    };
  }
  
  async getSystemHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      components: {
        jsonrpc: 'healthy',
        websocket: 'healthy',
        federation: 'healthy',
        mcp: 'healthy'
      }
    };
  }
  
  async restartSystem() {
    // TODO: Implement system restart
    throw new Error('System restart not implemented');
  }
  
  async getFederationInfo() {
    try {
      const configPath = path.join(this.federationsDir, 'config', 'entity-configuration.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return {
          entity_id: config.sub,
          metadata: config.metadata,
          authority_hints: config.authority_hints,
          jwks: config.jwks
        };
      }
      return { error: 'Federation configuration not found' };
    } catch (error) {
      throw new Error(`Failed to get federation info: ${error.message}`);
    }
  }
  
  async getFederationConfig() {
    return this.getFederationInfo();
  }
  
  async updateFederationConfig(params) {
    // TODO: Implement federation config update
    throw new Error('Federation config update not implemented');
  }
  
  async getFederationEntities() {
    // TODO: Implement federation entities listing
    return [];
  }
  
  async addFederationEntity(params) {
    // TODO: Implement federation entity addition
    throw new Error('Federation entity addition not implemented');
  }
  
  async removeFederationEntity(params) {
    // TODO: Implement federation entity removal
    throw new Error('Federation entity removal not implemented');
  }
  
  async validateFederationToken(params) {
    const { token } = params;
    
    if (!token) {
      throw new Error('Token is required');
    }
    
    try {
      // Import JWT library
      const jwt = require('jsonwebtoken');
      
      // Decode token without verification first to get claims
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded) {
        return {
          valid: false,
          error: 'Invalid token format',
          trust_chain_valid: false
        };
      }
      
      const payload = decoded.payload;
      const issuer = payload.iss;
      const subject = payload.sub;
      
      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return {
          valid: false,
          error: 'Token has expired',
          trust_chain_valid: false
        };
      }
      
      // Load federation public key for verification
      // Try multiple possible locations for the federation public key
      const envKeyPath = process.env.FEDMGR_KEYS_PATH
        ? path.join(process.env.FEDMGR_KEYS_PATH, 'anchor-public.pem')
        : null;

      const possiblePaths = [
        envKeyPath,
        path.join(this.federationsDir, 'alpha', 'keys', 'anchor-public.pem'),
        path.join(this.federationsDir, 'keys', 'anchor-public.pem'),
        path.join(__dirname, '../../../federations/alpha/keys/anchor-public.pem')
      ].filter(Boolean);
      
      let publicKeyPath = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          publicKeyPath = testPath;
          break;
        }
      }
      
      if (!publicKeyPath) {
        return {
          valid: false,
          error: `Federation public key not found. Tried paths: ${possiblePaths.join(', ')}`,
          trust_chain_valid: false
        };
      }
      
      const publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
      
      // Verify token signature
      let verifiedPayload;
      try {
        verifiedPayload = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      } catch (verifyError) {
        return {
          valid: false,
          error: `Token signature verification failed: ${verifyError.message}`,
          trust_chain_valid: false
        };
      }
      
      // Validate trust chain
      const trustChainValid = verifiedPayload.trust_chain && 
                             verifiedPayload.trust_chain.includes(issuer);
      
      // Check required claims
      const requiredClaims = ['iss', 'sub', 'aud', 'exp', 'iat'];
      const missingClaims = requiredClaims.filter(claim => !verifiedPayload[claim]);
      
      if (missingClaims.length > 0) {
        return {
          valid: false,
          error: `Missing required claims: ${missingClaims.join(', ')}`,
          trust_chain_valid: false
        };
      }
      
      // Token is valid
      return {
        valid: true,
        payload: verifiedPayload,
        trust_chain_valid: trustChainValid,
        trust_anchor: issuer,
        validation_details: {
          signature_verified: true,
          not_expired: true,
          trust_chain_valid: trustChainValid,
          audience_valid: Array.isArray(verifiedPayload.aud) && verifiedPayload.aud.length > 0,
          trust_marks_present: Array.isArray(verifiedPayload.trust_marks) && verifiedPayload.trust_marks.length > 0,
          federation_entity_present: !!verifiedPayload.federation_entity
        }
      };
      
    } catch (error) {
      return {
        valid: false,
        error: `Token validation failed: ${error.message}`,
        trust_chain_valid: false
      };
    }
  }
  
  async listMCPServers() {
    try {
      const servers = [];
      if (fs.existsSync(this.mcpInstancesDir)) {
        const instances = fs.readdirSync(this.mcpInstancesDir);
        for (const instance of instances) {
          const instancePath = path.join(this.mcpInstancesDir, instance);
          if (fs.statSync(instancePath).isDirectory()) {
            const configPath = path.join(instancePath, 'config', 'entity-configuration.json');
            let config = {};
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
            
            servers.push({
              name: instance,
              path: instancePath,
              config,
              status: this.processes.has(instance) ? 'running' : 'stopped'
            });
          }
        }
      }
      return servers;
    } catch (error) {
      throw new Error(`Failed to list MCP servers: ${error.message}`);
    }
  }
  
  async createMCPServer(params) {
    const { name, port, description } = params;
    
    if (!name || !port) {
      throw new Error('Name and port are required');
    }
    
    try {
      const instancePath = path.join(this.mcpInstancesDir, name);
      
      if (fs.existsSync(instancePath)) {
        throw new Error(`MCP server '${name}' already exists`);
      }
      
      // Create instance directory structure
      fs.mkdirSync(instancePath, { recursive: true });
      fs.mkdirSync(path.join(instancePath, 'config'), { recursive: true });
      fs.mkdirSync(path.join(instancePath, 'keys'), { recursive: true });
      
      // Generate entity configuration
      const entityConfig = {
        sub: `http://localhost:${port}`,
        metadata: {
          mcp_server: {
            name,
            description: description || `MCP Server ${name}`,
            port,
            created_at: new Date().toISOString()
          }
        },
        jwks: { keys: [] },
        iat: Math.floor(Date.now() / 1000),
        authority_hints: []
      };
      
      fs.writeFileSync(
        path.join(instancePath, 'config', 'entity-configuration.json'),
        JSON.stringify(entityConfig, null, 2)
      );
      
      // Broadcast notification
      this.broadcast('mcp.server.created', { name, port, description });
      
      return {
        name,
        port,
        description,
        status: 'created',
        path: instancePath
      };
    } catch (error) {
      throw new Error(`Failed to create MCP server: ${error.message}`);
    }
  }
  
  async startMCPServer(params) {
    const { name } = params;
    
    if (!name) {
      throw new Error('Server name is required');
    }
    
    try {
      if (this.processes.has(name)) {
        throw new Error(`MCP server '${name}' is already running`);
      }
      
      const instancePath = path.join(this.mcpInstancesDir, name);
      if (!fs.existsSync(instancePath)) {
        throw new Error(`MCP server '${name}' does not exist`);
      }
      
      const configPath = path.join(instancePath, 'config', 'entity-configuration.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const port = config.metadata.mcp_server.port;
      
      // Start MCP server process
      const serverPath = path.resolve(__dirname, 'mcp-protocol-server.js');
      const process = spawn('node', [serverPath, '--name', name, '--port', port], {
        cwd: instancePath,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.processes.set(name, process);
      
      // Handle process events
      process.on('exit', (code) => {
        this.processes.delete(name);
        this.broadcast('mcp.server.stopped', { name, code });
      });
      
      process.stdout.on('data', (data) => {
        this.broadcast('mcp.server.log', { name, type: 'stdout', data: data.toString() });
      });
      
      process.stderr.on('data', (data) => {
        this.broadcast('mcp.server.log', { name, type: 'stderr', data: data.toString() });
      });
      
      // Broadcast notification
      this.broadcast('mcp.server.started', { name, port });
      
      return {
        name,
        port,
        status: 'started',
        pid: process.pid
      };
    } catch (error) {
      throw new Error(`Failed to start MCP server: ${error.message}`);
    }
  }
  
  async stopMCPServer(params) {
    const { name } = params;
    
    if (!name) {
      throw new Error('Server name is required');
    }
    
    try {
      const process = this.processes.get(name);
      if (!process) {
        throw new Error(`MCP server '${name}' is not running`);
      }
      
      process.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise((resolve) => {
        process.on('exit', resolve);
        setTimeout(resolve, 5000); // Force kill after 5 seconds
      });
      
      return {
        name,
        status: 'stopped'
      };
    } catch (error) {
      throw new Error(`Failed to stop MCP server: ${error.message}`);
    }
  }
  
  async restartMCPServer(params) {
    await this.stopMCPServer(params);
    return this.startMCPServer(params);
  }
  
  async getMCPServerStatus(params) {
    const { name } = params;
    
    if (!name) {
      throw new Error('Server name is required');
    }
    
    const process = this.processes.get(name);
    return {
      name,
      status: process ? 'running' : 'stopped',
      pid: process ? process.pid : null
    };
  }
  
  async getMCPServerLogs(params) {
    // TODO: Implement MCP server logs retrieval
    throw new Error('MCP server logs not implemented');
  }
  
  async getMCPServerConfig(params) {
    const { name } = params;
    
    if (!name) {
      throw new Error('Server name is required');
    }
    
    try {
      const configPath = path.join(this.mcpInstancesDir, name, 'config', 'entity-configuration.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      throw new Error(`Config not found for MCP server '${name}'`);
    } catch (error) {
      throw new Error(`Failed to get MCP server config: ${error.message}`);
    }
  }
  
  async updateMCPServerConfig(params) {
    // TODO: Implement MCP server config update
    throw new Error('MCP server config update not implemented');
  }
  
  async getOAuthConfig() {
    return {
      client_id: process.env.GITHUB_CLIENT_ID || null,
      redirect_uri: process.env.OAUTH_REDIRECT_URI || null,
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
    };
  }
  
  async updateOAuthConfig(params) {
    // TODO: Implement OAuth config update
    throw new Error('OAuth config update not implemented');
  }
  
  async generateId() {
    return crypto.randomUUID();
  }
  
  async getTimestamp() {
    return new Date().toISOString();
  }
  
  async encryptData(params) {
    // TODO: Implement data encryption
    throw new Error('Data encryption not implemented');
  }
  
  async decryptData(params) {
    // TODO: Implement data decryption
    throw new Error('Data decryption not implemented');
  }
  
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        console.log(`🚀 JSON-RPC 2.0 Server running on http://${this.host}:${this.port}`);
        console.log(`📡 WebSocket endpoint: ws://${this.host}:${this.port}/jsonrpc`);
        console.log(`🔍 Health check: http://${this.host}:${this.port}/jsonrpc/health`);
        console.log(`📚 Methods: http://${this.host}:${this.port}/jsonrpc/methods`);
        resolve();
      });
    });
  }
  
  stop() {
    return new Promise((resolve) => {
      // Stop all MCP processes
      this.processes.forEach((process, name) => {
        process.kill('SIGTERM');
      });
      
      // Close WebSocket connections
      this.clients.forEach(client => {
        client.close();
      });
      
      // Close HTTP server
      this.server.close(() => {
        console.log('🛑 JSON-RPC 2.0 Server stopped');
        resolve();
      });
    });
  }
}

module.exports = JSONRPCServer;

// If this file is run directly, start the server
if (require.main === module) {
  const server = new JSONRPCServer({
    port: process.env.JSONRPC_PORT || 4000,
    host: process.env.JSONRPC_HOST || 'localhost'
  });
  
  server.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    server.stop().then(() => process.exit(0));
  });
  
  process.on('SIGINT', () => {
    server.stop().then(() => process.exit(0));
  });
}