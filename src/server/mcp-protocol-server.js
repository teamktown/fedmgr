/**
 * MCP Protocol Server Implementation
 * 
 * This file implements a Model Context Protocol (MCP) server that can be used
 * to provide tools and resources to LLM clients. It follows the MCP specification
 * and integrates with the federation trust environment.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class MCPProtocolServer {
  constructor(options = {}) {
    this.name = options.name || 'mcp-protocol-server';
    this.port = options.port || 3200;
    this.baseDir = options.baseDir || path.resolve(__dirname, '../../mcp_instances', this.name);
    this.configPath = options.configPath || path.join(this.baseDir, 'config');
    this.entityConfigFile = options.entityConfigFile || path.join(this.configPath, 'entity-configuration.json');
    
    // Create directories if they don't exist
    fs.mkdirSync(this.configPath, { recursive: true });
    
    // Initialize Express app and HTTP server
    this.app = express();
    this.server = http.createServer(this.app);
    this.emitter = new EventEmitter();
    
    // Available tools and resources
    this.tools = new Map();
    this.resources = new Map();
    
    // Entity configuration
    this.entityConfig = {};
    if (fs.existsSync(this.entityConfigFile)) {
      this.entityConfig = JSON.parse(fs.readFileSync(this.entityConfigFile, 'utf-8'));
    }
    
    // Set up middleware
    this.app.use(express.json());
    
    // Set up WebSocket server for real-time communication
    this.wss = new WebSocket.Server({ server: this.server, path: '/mcp' });
    
    // Set up routes and WebSocket handlers
    this.setupRoutes();
    this.setupWebSocketHandlers();
    
    // Register default tools and resources
    this.registerDefaultTools();
    this.registerDefaultResources();
  }
  
  /**
   * Set up Express routes
   */
  setupRoutes() {
    // MCP Protocol discovery endpoint
    this.app.get('/.well-known/mcp-configuration', (req, res) => {
      res.json({
        protocol_version: '1.0',
        server_name: this.name,
        description: `MCP Protocol Server: ${this.name}`,
        tools_endpoint: '/tools',
        resources_endpoint: '/resources',
        websocket_endpoint: '/mcp',
        auth_required: false // For simplicity, no auth required in this implementation
      });
    });
    
    // Entity configuration endpoint (for federation trust)
    this.app.get('/.well-known/openid-federation', (req, res) => {
      if (Object.keys(this.entityConfig).length === 0) {
        res.status(404).json({ error: 'Entity configuration not available' });
        return;
      }
      
      this.log('INFO', 'CONFIG_SERVED', 'Entity configuration served');
      res.json(this.entityConfig);
    });
    
    // List available tools
    this.app.get('/tools', (req, res) => {
      const toolsList = Array.from(this.tools.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: tool.inputSchema,
        output_schema: tool.outputSchema
      }));
      
      res.json({
        tools: toolsList
      });
    });
    
    // Execute a tool
    this.app.post('/tools/:name', async (req, res) => {
      const { name } = req.params;
      const tool = this.tools.get(name);
      
      if (!tool) {
        res.status(404).json({ error: `Tool '${name}' not found` });
        return;
      }
      
      try {
        // Validate input against schema (simplified validation)
        const input = req.body;
        
        // Execute the tool
        this.log('INFO', 'TOOL_EXECUTION', `Executing tool: ${name}`);
        const result = await tool.execute(input);
        
        // Return the result
        res.json(result);
      } catch (error) {
        this.log('ERROR', 'TOOL_EXECUTION_FAILED', `Tool execution failed: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    // List available resources
    this.app.get('/resources', (req, res) => {
      const resourcesList = Array.from(this.resources.keys()).map(uri => ({
        uri,
        description: this.resources.get(uri).description
      }));
      
      res.json({
        resources: resourcesList
      });
    });
    
    // Access a resource
    this.app.get('/resources/:uri(*)', (req, res) => {
      const uri = req.params.uri;
      const resource = this.resources.get(uri);
      
      if (!resource) {
        res.status(404).json({ error: `Resource '${uri}' not found` });
        return;
      }
      
      try {
        this.log('INFO', 'RESOURCE_ACCESS', `Accessing resource: ${uri}`);
        const data = resource.getData();
        res.json(data);
      } catch (error) {
        this.log('ERROR', 'RESOURCE_ACCESS_FAILED', `Resource access failed: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        name: this.name,
        tools: this.tools.size,
        resources: this.resources.size
      });
    });
  }
  
  /**
   * Set up WebSocket handlers
   */
  setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      this.log('INFO', 'WS_CONNECTED', 'WebSocket client connected');
      
      // Send server information
      ws.send(JSON.stringify({
        type: 'server_info',
        data: {
          server_name: this.name,
          protocol_version: '1.0',
          tools: Array.from(this.tools.keys()),
          resources: Array.from(this.resources.keys())
        }
      }));
      
      // Set up message handler
      ws.on('message', async (message) => {
        try {
          const request = JSON.parse(message);
          
          if (request.type === 'tool_request') {
            const { tool_name, arguments: args } = request;
            const tool = this.tools.get(tool_name);
            
            if (!tool) {
              ws.send(JSON.stringify({
                type: 'error',
                request_id: request.request_id,
                error: `Tool '${tool_name}' not found`
              }));
              return;
            }
            
            try {
              const result = await tool.execute(args);
              
              ws.send(JSON.stringify({
                type: 'tool_response',
                request_id: request.request_id,
                result
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                request_id: request.request_id,
                error: error.message
              }));
            }
          } 
          else if (request.type === 'resource_request') {
            const { uri } = request;
            const resource = this.resources.get(uri);
            
            if (!resource) {
              ws.send(JSON.stringify({
                type: 'error',
                request_id: request.request_id,
                error: `Resource '${uri}' not found`
              }));
              return;
            }
            
            try {
              const data = resource.getData();
              
              ws.send(JSON.stringify({
                type: 'resource_response',
                request_id: request.request_id,
                data
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                request_id: request.request_id,
                error: error.message
              }));
            }
          }
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: `Invalid request: ${error.message}`
          }));
        }
      });
      
      // Handle disconnection
      ws.on('close', () => {
        this.log('INFO', 'WS_DISCONNECTED', 'WebSocket client disconnected');
      });
    });
  }
  
  /**
   * Register a tool with the MCP server
   * @param {string} name - Tool name
   * @param {Object} tool - Tool implementation
   */
  registerTool(name, tool) {
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error('Tool must have an execute method');
    }
    
    this.tools.set(name, tool);
    this.log('INFO', 'TOOL_REGISTERED', `Registered tool: ${name}`);
  }
  
  /**
   * Register a resource with the MCP server
   * @param {string} uri - Resource URI
   * @param {Object} resource - Resource implementation
   */
  registerResource(uri, resource) {
    if (!resource.getData || typeof resource.getData !== 'function') {
      throw new Error('Resource must have a getData method');
    }
    
    this.resources.set(uri, resource);
    this.log('INFO', 'RESOURCE_REGISTERED', `Registered resource: ${uri}`);
  }
  
  /**
   * Register default tools
   */
  registerDefaultTools() {
    // Example tool: weather forecast
    this.registerTool('get_weather', {
      description: 'Get weather forecast for a location',
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'Location to get weather for'
          },
          days: {
            type: 'number',
            description: 'Number of days to forecast'
          }
        },
        required: ['location']
      },
      outputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'Location of the forecast'
          },
          forecast: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: {
                  type: 'string',
                  description: 'Date of the forecast'
                },
                temperature: {
                  type: 'number',
                  description: 'Temperature in Celsius'
                },
                conditions: {
                  type: 'string',
                  description: 'Weather conditions'
                }
              }
            }
          }
        }
      },
      execute: async (args) => {
        // Simulate weather forecast
        const { location, days = 3 } = args;
        const forecast = [];
        
        const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Stormy', 'Snowy'];
        const now = new Date();
        
        for (let i = 0; i < days; i++) {
          const date = new Date(now);
          date.setDate(date.getDate() + i);
          
          forecast.push({
            date: date.toISOString().split('T')[0],
            temperature: Math.round(15 + 10 * Math.random()),
            conditions: conditions[Math.floor(Math.random() * conditions.length)]
          });
        }
        
        return {
          location,
          forecast
        };
      }
    });
    
    // Example tool: generate UUID
    this.registerTool('generate_uuid', {
      description: 'Generate a random UUID',
      inputSchema: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'UUID version (v4 or v1)'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uuid: {
            type: 'string',
            description: 'Generated UUID'
          }
        }
      },
      execute: async (args) => {
        const { version = 'v4' } = args;
        let uuid;
        
        if (version === 'v1') {
          uuid = crypto.randomUUID({ version: 1 });
        } else {
          uuid = crypto.randomUUID();
        }
        
        return { uuid };
      }
    });
  }
  
  /**
   * Register default resources
   */
  registerDefaultResources() {
    // Example resource: system information
    this.registerResource('system://info', {
      description: 'System information',
      getData: () => {
        return {
          hostname: require('os').hostname(),
          platform: process.platform,
          arch: process.arch,
          cpus: require('os').cpus().length,
          memory: {
            total: require('os').totalmem(),
            free: require('os').freemem()
          },
          uptime: process.uptime()
        };
      }
    });
    
    // Example resource: federation information
    this.registerResource('federation://info', {
      description: 'Federation information',
      getData: () => {
        return {
          name: this.name,
          entity_id: this.entityConfig.sub || null,
          metadata: this.entityConfig.metadata || {},
          authority_hints: this.entityConfig.authority_hints || []
        };
      }
    });
  }
  
  /**
   * Log a message
   * @param {string} level - Log level
   * @param {string} event - Event name
   * @param {string} detail - Event details
   */
  log(level, event, detail) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      detail,
      mcp: this.name
    };
    
    console.log(`[${level}] ${event}: ${detail}`);
    this.emitter.emit('log', logEntry);
    return logEntry;
  }
  
  /**
   * Start the MCP server
   * @returns {Promise} - Promise that resolves when the server is started
   */
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.log('INFO', 'MCP_START', `MCP Protocol Server '${this.name}' running on http://localhost:${this.port}`);
        console.log(`🤖 MCP Protocol Server '${this.name}' running on http://localhost:${this.port}`);
        console.log(`📡 WebSocket available at ws://localhost:${this.port}/mcp`);
        console.log(`🔍 MCP configuration at http://localhost:${this.port}/.well-known/mcp-configuration`);
        resolve();
      });
    });
  }
  
  /**
   * Stop the MCP server
   * @returns {Promise} - Promise that resolves when the server is stopped
   */
  stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log('INFO', 'MCP_STOP', `MCP Protocol Server '${this.name}' stopped`);
        resolve();
      });
    });
  }
}

module.exports = MCPProtocolServer;

// If this file is run directly, start the server
if (require.main === module) {
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
  
  const server = new MCPProtocolServer({ name, port });
  server.start();
}