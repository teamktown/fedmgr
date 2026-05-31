/**
 * MCP Server Interface
 *
 * Abstraction layer for managing MCP instances:
 * - Create and initialize MCP instances
 * - Route requests to appropriate MCP instances
 * - Manage MCP lifecycle (start, stop, restart)
 * - Handle configuration and key management for MCPs
 * - Distribute entity statements from Federation Admin to MCPs
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const MCPProtocolServer = require('./mcp-protocol-server');
const certificateUtils = require('./utils/certificate-utils');
const config = require('../config');

class MCPInterface extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const defaultInstancesDir = process.env.FEDMGR_HOME
      ? path.join(process.env.FEDMGR_HOME, 'mcp_instances')
      : path.resolve(__dirname, '../../mcp_instances');
    const defaultProtocolDir = process.env.FEDMGR_HOME
      ? path.join(process.env.FEDMGR_HOME, 'mcp_protocol_servers')
      : path.resolve(__dirname, '../../mcp_protocol_servers');

    // Handle backward compatibility - if first arg is string, treat as registryPath
    if (typeof options === 'string') {
      this.registryPath = options;
      this.mcpInstancesDir = defaultInstancesDir;
      this.mcpProtocolServersDir = defaultProtocolDir;
    } else {
      this.registryPath = options.registryPath || config.federations.registryPath;
      this.mcpInstancesDir = options.mcpInstancesDir || defaultInstancesDir;
      this.mcpProtocolServersDir = options.mcpProtocolServersDir || defaultProtocolDir;
    }
    
    this.portCounter = 3100;
    this.mcpProcesses = new Map(); // Track running MCP processes
    this.mcpProtocolServers = new Map(); // Track running MCP Protocol servers
    
    // Ensure registry directory exists
    const registryDir = path.dirname(this.registryPath);
    if (!fs.existsSync(registryDir)) {
      console.log(`📁 Creating registry directory: ${registryDir}`);
      fs.mkdirSync(registryDir, { recursive: true });
    }
    
    this.loadRegistry();
  }

  /**
   * Ensure a directory exists
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      console.log(`📁 Creating directory: ${dirPath}`);
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Load registry data from file
   */
  loadRegistry() {
    if (!fs.existsSync(this.registryPath)) {
      console.log(`📝 Creating new registry at: ${this.registryPath}`);
      this.registry = { federations: [], mcps: {}, mcpProtocolServers: {} };
      this.saveRegistry();
      return this.registry;
    }
    try {
      const data = fs.readFileSync(this.registryPath, 'utf-8');
      this.registry = JSON.parse(data);
      console.log(`📖 Loaded registry from: ${this.registryPath}`);
    } catch (err) {
      console.error(`❌ Failed to load registry from ${this.registryPath}: ${err.message}`);
      this.registry = { federations: [], mcps: {}, mcpProtocolServers: {} };
      return this.registry;
    }
    
    // Ensure registry has all required sections
    if (!this.registry.federations) this.registry.federations = [];
    if (!this.registry.mcps) this.registry.mcps = {};
    if (!this.registry.mcpProtocolServers) this.registry.mcpProtocolServers = {};
    
    // Update portCounter based on existing MCPs and MCP Protocol servers
    const mcpPorts = Object.values(this.registry.mcps);
    const protocolPorts = Object.values(this.registry.mcpProtocolServers);
    const allPorts = [...mcpPorts, ...protocolPorts];
    
    if (allPorts.length > 0) {
      this.portCounter = Math.max(...allPorts) + 1;
    }

    return this.registry;
  }

  /**
   * Save registry data to file
   */
  saveRegistry() {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
      console.log(`💾 Registry saved to: ${this.registryPath}`);
    } catch (err) {
      console.error(`❌ Failed to save registry: ${err.message}`);
      throw err;
    }
  }

  /**
   * Create a new MCP instance
   * @param {string} name - Name of the MCP instance
   * @returns {Object} - MCP instance details
   */
  createMcp(name) {
    this.loadRegistry(); // Ensure we have the latest registry data
    
    if (this.registry.mcps[name]) {
      console.log(`⚠️ MCP '${name}' already exists in registry.`);
      return { success: false, message: `MCP '${name}' already exists` };
    }

    const baseDir = path.join(this.mcpInstancesDir, name);
    const keysPath = path.join(baseDir, 'keys');
    const configPath = path.join(baseDir, 'config');
    const entityConfigFile = path.join(configPath, 'entity-configuration.json');
    const privateKeyFile = path.join(keysPath, 'mcp-private.pem');
    const publicKeyFile = path.join(keysPath, 'mcp-public.pem');
    const port = this.portCounter++;

    try {
      // Create directories
      console.log(`📁 Creating MCP directories for '${name}'...`);
      this.ensureDirectoryExists(keysPath);
      this.ensureDirectoryExists(configPath);

      // Generate keys with proper path handling
      console.log(`🔑 Generating MCP keys for '${name}'...`);
      execSync(`openssl genrsa -out "${privateKeyFile}" 2048`, { stdio: 'inherit' });
      execSync(`openssl rsa -in "${privateKeyFile}" -pubout -out "${publicKeyFile}"`, { stdio: 'inherit' });

      // Load the public key and convert to JWK format
      const jwk = certificateUtils.loadPublicKeyAsJwk(
        publicKeyFile,
        { kid: `${name}-key-${Date.now()}`, use: 'sig' }
      );

      // Create entity configuration
      const entityId = `http://localhost:${port}`;
      const now = Math.floor(Date.now() / 1000);

      const entityConfig = {
        sub: entityId,
        metadata: {
          federation_entity: {
            organization_name: `MCP Instance ${name}`,
            contacts: [`ops@${name}.local`],
            federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
            trust_marks: []
          }
        },
        authority_hints: ["http://localhost:3001"],
        jwks: { keys: [jwk] },
        iat: now
      };

      fs.writeFileSync(entityConfigFile, JSON.stringify(entityConfig, null, 2));
      
      // Update registry
      this.registry.mcps[name] = port;
      this.saveRegistry();

      console.log(`✅ MCP '${name}' initialized at ${baseDir}`);
      
      return { 
        success: true, 
        name, 
        port, 
        baseDir,
        entityId
      };
    } catch (error) {
      console.error(`❌ Failed to create MCP '${name}':`, error.message);
      return { success: false, message: `Failed to create MCP: ${error.message}` };
    }
  }

  /**
   * Start an MCP instance
   * @param {string} name - Name of the MCP instance
   * @returns {Object} - Result of the operation
   */
  startMcp(name) {
    this.loadRegistry();
    
    const port = this.registry.mcps[name];
    if (!port) {
      return { success: false, message: `MCP '${name}' not found in registry` };
    }

    if (this.mcpProcesses.has(name)) {
      return { success: false, message: `MCP '${name}' is already running` };
    }

    const serverPath = path.resolve(__dirname, './mcp-server.js');
    console.log(`🚀 Starting MCP '${name}' on port ${port}...`);
    
    const childProcess = spawn('node', [serverPath, '--name', name, '--port', port], {
      stdio: 'inherit',
      env: { ...process.env, NAME: name, PORT: port.toString() }
    });

    this.mcpProcesses.set(name, childProcess);
    
    childProcess.on('exit', (code) => {
      console.log(`MCP '${name}' exited with code ${code}`);
      this.mcpProcesses.delete(name);
    });

    return { success: true, name, port };
  }

  /**
   * Stop an MCP instance
   * @param {string} name - Name of the MCP instance
   * @returns {Object} - Result of the operation
   */
  stopMcp(name) {
    if (!this.mcpProcesses.has(name)) {
      return { success: false, message: `MCP '${name}' is not running` };
    }

    const childProcess = this.mcpProcesses.get(name);
    childProcess.kill();
    this.mcpProcesses.delete(name);
    
    return { success: true, message: `MCP '${name}' stopped` };
  }

  /**
   * Restart an MCP instance
   * @param {string} name - Name of the MCP instance
   * @returns {Object} - Result of the operation
   */
  restartMcp(name) {
    const stopResult = this.stopMcp(name);
    if (!stopResult.success && stopResult.message !== `MCP '${name}' is not running`) {
      return stopResult;
    }
    
    return this.startMcp(name);
  }

  /**
   * Route a request to an MCP instance
   * @param {string} name - Name of the MCP instance
   * @param {Object} options - Request options
   * @returns {Promise} - Promise resolving to the response
   */
  routeRequest(name, options = {}) {
    this.loadRegistry();
    
    const port = this.registry.mcps[name];
    if (!port) {
      return Promise.reject(new Error(`MCP '${name}' not found in registry`));
    }

    // Default options
    const requestOptions = {
      hostname: 'localhost',
      port,
      path: '/api',
      method: 'GET',
      ...options
    };

    return new Promise((resolve, reject) => {
      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  /**
   * Distribute entity statements from Federation Admin to MCPs
   * @param {string} federationName - Name of the federation
   * @returns {Promise} - Promise resolving to the distribution result
   */
  async distributeEntityStatements(federationName) {
    this.loadRegistry();
    
    // Check if federation exists
    if (!this.registry.federations.includes(federationName)) {
      return { success: false, message: `Federation '${federationName}' not found` };
    }

    // Fetch entity statements from Federation Admin
    try {
      // First, get the federation entity configuration
      const fedAdminResponse = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3001, // Federation Admin port
          path: '/.well-known/openid-federation',
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve(JSON.parse(data));
          });
        });

        req.on('error', (error) => {
          reject(error);
        });
        
        req.end();
      });

      // Now get entity statements for each MCP
      const federationEndpoint = '/federation';
      const federationResponse = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3001, // Federation Admin port
          path: federationEndpoint,
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve(JSON.parse(data));
          });
        });

        req.on('error', (error) => {
          reject(error);
        });
        
        req.end();
      });

      // Distribute to all MCPs
      const results = [];
      for (const [name, port] of Object.entries(this.registry.mcps)) {
        try {
          // Send the entity statements to each MCP
          const response = await new Promise((resolve, reject) => {
            const req = http.request({
              hostname: 'localhost',
              port: port,
              path: '/entity-statements',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              }
            }, (res) => {
              let data = '';
              res.on('data', (chunk) => {
                data += chunk;
              });
              res.on('end', () => {
                resolve(JSON.parse(data));
              });
            });

            req.on('error', (error) => {
              reject(error);
            });
            
            // Send the entity statements
            req.write(JSON.stringify({
              statements: federationResponse.statements
            }));
            
            req.end();
          });
          
          console.log(`📡 Distributed entity statements to MCP '${name}' on port ${port}`);
          results.push({ name, success: true, response });
        } catch (error) {
          console.error(`❌ Failed to distribute entity statements to MCP '${name}': ${error.message}`);
          results.push({ name, success: false, error: error.message });
        }
      }

      return {
        success: true,
        federation: federationName,
        entityStatements: federationResponse.statements,
        distributionResults: results
      };
    } catch (error) {
      return { success: false, message: `Failed to fetch entity statements: ${error.message}` };
    }
  }

  /**
   * Get all registered MCPs
   * @returns {Object} - Object with MCP names as keys and ports as values
   */
  getAllMcps() {
    this.loadRegistry();
    return this.registry.mcps;
  }

  /**
   * Get all registered federations
   * @returns {Array} - Array of federation names
   */
  getAllFederations() {
    this.loadRegistry();
    return this.registry.federations;
  }
  
  /**
   * Create a new MCP Protocol server
   * @param {string} name - Name of the MCP Protocol server
   * @returns {Object} - MCP Protocol server details
   */
  createMcpProtocolServer(name) {
    this.loadRegistry();
    
    if (this.registry.mcpProtocolServers[name]) {
      console.log(`⚠️ MCP Protocol Server '${name}' already exists in registry.`);
      return { success: false, message: `MCP Protocol Server '${name}' already exists` };
    }

    const baseDir = path.join(this.mcpProtocolServersDir, name);
    const keysPath = path.join(baseDir, 'keys');
    const configPath = path.join(baseDir, 'config');
    const entityConfigFile = path.join(configPath, 'entity-configuration.json');
    const privateKeyFile = path.join(keysPath, 'mcp-private.pem');
    const publicKeyFile = path.join(keysPath, 'mcp-public.pem');
    const port = this.portCounter++;

    try {
      // Create directories
      console.log(`📁 Creating MCP Protocol Server directories for '${name}'...`);
      this.ensureDirectoryExists(keysPath);
      this.ensureDirectoryExists(configPath);

      // Generate keys
      console.log(`🔑 Generating MCP Protocol Server keys for '${name}'...`);
      execSync(`openssl genrsa -out "${privateKeyFile}" 2048`, { stdio: 'inherit' });
      execSync(`openssl rsa -in "${privateKeyFile}" -pubout -out "${publicKeyFile}"`, { stdio: 'inherit' });

      // Load the public key and convert to JWK format
      const jwk = certificateUtils.loadPublicKeyAsJwk(
        publicKeyFile,
        { kid: `${name}-key-${Date.now()}`, use: 'sig' }
      );

      // Create entity configuration
      const entityId = `http://localhost:${port}`;
      const now = Math.floor(Date.now() / 1000);

      const entityConfig = {
        sub: entityId,
        metadata: {
          federation_entity: {
            organization_name: `MCP Protocol Server ${name}`,
            contacts: [`ops@${name}.local`],
            federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
            trust_marks: []
          },
          mcp_protocol: {
            protocol_version: "1.0",
            server_name: name,
            description: `MCP Protocol Server: ${name}`,
            tools_endpoint: `${entityId}/tools`,
            resources_endpoint: `${entityId}/resources`,
            websocket_endpoint: `${entityId}/mcp`
          }
        },
        authority_hints: ["http://localhost:3001"],
        jwks: { keys: [jwk] },
        iat: now
      };

      fs.writeFileSync(entityConfigFile, JSON.stringify(entityConfig, null, 2));
      
      // Update registry
      this.registry.mcpProtocolServers[name] = port;
      this.saveRegistry();

      console.log(`✅ MCP Protocol Server '${name}' initialized at ${baseDir}`);
      
      return {
        success: true,
        name,
        port,
        baseDir,
        entityId
      };
    } catch (error) {
      console.error(`❌ Failed to create MCP Protocol Server '${name}':`, error.message);
      return { success: false, message: `Failed to create MCP Protocol Server: ${error.message}` };
    }
  }
  
  /**
   * Start an MCP Protocol server
   * @param {string} name - Name of the MCP Protocol server
   * @returns {Object} - Result of the operation
   */
  startMcpProtocolServer(name) {
    this.loadRegistry();
    
    const port = this.registry.mcpProtocolServers[name];
    if (!port) {
      return { success: false, message: `MCP Protocol Server '${name}' not found in registry` };
    }

    if (this.mcpProtocolServers.has(name)) {
      return { success: false, message: `MCP Protocol Server '${name}' is already running` };
    }

    const baseDir = path.join(this.mcpProtocolServersDir, name);
    console.log(`🚀 Starting MCP Protocol Server '${name}' on port ${port}...`);
    
    try {
      // Create and start the MCP Protocol server
      const server = new MCPProtocolServer({
        name,
        port,
        baseDir,
        configPath: path.join(baseDir, 'config'),
        entityConfigFile: path.join(baseDir, 'config', 'entity-configuration.json')
      });
      
      server.start();
      this.mcpProtocolServers.set(name, server);
      
      return { success: true, name, port };
    } catch (error) {
      console.error(`❌ Failed to start MCP Protocol Server: ${error.message}`);
      return { success: false, message: `Failed to start MCP Protocol Server: ${error.message}` };
    }
  }
  
  /**
   * Stop an MCP Protocol server
   * @param {string} name - Name of the MCP Protocol server
   * @returns {Object} - Result of the operation
   */
  stopMcpProtocolServer(name) {
    if (!this.mcpProtocolServers.has(name)) {
      return { success: false, message: `MCP Protocol Server '${name}' is not running` };
    }

    const server = this.mcpProtocolServers.get(name);
    
    try {
      server.stop();
      this.mcpProtocolServers.delete(name);
      return { success: true, message: `MCP Protocol Server '${name}' stopped` };
    } catch (error) {
      return { success: false, message: `Failed to stop MCP Protocol Server: ${error.message}` };
    }
  }
  
  /**
   * Restart an MCP Protocol server
   * @param {string} name - Name of the MCP Protocol server
   * @returns {Object} - Result of the operation
   */
  restartMcpProtocolServer(name) {
    const stopResult = this.stopMcpProtocolServer(name);
    if (!stopResult.success && stopResult.message !== `MCP Protocol Server '${name}' is not running`) {
      return stopResult;
    }
    
    return this.startMcpProtocolServer(name);
  }
  
  /**
   * Get all registered MCP Protocol servers
   * @returns {Object} - Object with MCP Protocol server names as keys and ports as values
   */
  getAllMcpProtocolServers() {
    this.loadRegistry();
    return this.registry.mcpProtocolServers;
  }
}

module.exports = MCPInterface;
