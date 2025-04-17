
/**
 * fedmgr Web Interface Server
 *
 * Provides a web interface for visualizing and interacting with the federation
 * and MCP instances. Integrates with the MCP Server Interface to provide
 * real-time data about the federation and MCPs.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const fetch = require('node-fetch');
const MCPInterface = require('./src/server/mcp-interface');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5173;

// Initialize MCP Interface
const registryPath = path.resolve(__dirname, './data/registry.json');
const mcpInterface = new MCPInterface(registryPath);

// Create data directory if it doesn't exist
const dataDir = path.resolve(__dirname, './data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Enable JSON parsing middleware
app.use(express.json());

// Serve everything inside the public folder
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints for the web interface

// Get federation, MCP, and MCP Protocol server information
app.get('/api/status', (req, res) => {
  const federations = mcpInterface.getAllFederations();
  const mcps = mcpInterface.getAllMcps();
  const mcpProtocolServers = mcpInterface.getAllMcpProtocolServers();
  
  res.json({
    federations,
    mcps: Object.entries(mcps).map(([name, port]) => ({
      name,
      port,
      url: `http://localhost:${port}`
    })),
    mcpProtocolServers: Object.entries(mcpProtocolServers).map(([name, port]) => ({
      name,
      port,
      url: `http://localhost:${port}`,
      configUrl: `http://localhost:${port}/.well-known/mcp-configuration`
    }))
  });
});

// Create a new MCP
app.post('/api/mcps', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Missing MCP name' });
  }
  
  const result = mcpInterface.createMcp(name);
  
  if (result.success) {
    // Start the MCP instance
    mcpInterface.startMcp(name);
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

// Stop an MCP
app.post('/api/mcps/:name/stop', (req, res) => {
  const { name } = req.params;
  const result = mcpInterface.stopMcp(name);
  res.json(result);
});

// Restart an MCP
app.post('/api/mcps/:name/restart', (req, res) => {
  const { name } = req.params;
  const result = mcpInterface.restartMcp(name);
  res.json(result);
});

// Distribute entity statements
app.post('/api/distribute', async (req, res) => {
  const { federation } = req.body;
  
  if (!federation) {
    return res.status(400).json({ error: 'Missing federation name' });
  }
  
  try {
    const result = await mcpInterface.distributeEntityStatements(federation);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MCP Protocol server endpoints

// Create a new MCP Protocol server
app.post('/api/mcp-protocol-servers', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Missing MCP Protocol server name' });
  }
  
  const result = mcpInterface.createMcpProtocolServer(name);
  
  if (result.success) {
    // Start the MCP Protocol server
    mcpInterface.startMcpProtocolServer(name);
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

// Stop an MCP Protocol server
app.post('/api/mcp-protocol-servers/:name/stop', (req, res) => {
  const { name } = req.params;
  const result = mcpInterface.stopMcpProtocolServer(name);
  res.json(result);
});

// Restart an MCP Protocol server
app.post('/api/mcp-protocol-servers/:name/restart', (req, res) => {
  const { name } = req.params;
  const result = mcpInterface.restartMcpProtocolServer(name);
  res.json(result);
});

// Get MCP Protocol server details
app.get('/api/mcp-protocol-servers/:name', async (req, res) => {
  const { name } = req.params;
  const mcpProtocolServers = mcpInterface.getAllMcpProtocolServers();
  const port = mcpProtocolServers[name];
  
  if (!port) {
    return res.status(404).json({ error: `MCP Protocol server '${name}' not found` });
  }
  
  try {
    // Fetch MCP configuration
    const configResponse = await fetch(`http://localhost:${port}/.well-known/mcp-configuration`);
    const config = await configResponse.json();
    
    // Fetch available tools
    const toolsResponse = await fetch(`http://localhost:${port}/tools`);
    const tools = await toolsResponse.json();
    
    // Fetch available resources
    const resourcesResponse = await fetch(`http://localhost:${port}/resources`);
    const resources = await resourcesResponse.json();
    
    res.json({
      name,
      port,
      url: `http://localhost:${port}`,
      config,
      tools,
      resources
    });
  } catch (error) {
    res.status(500).json({
      error: `Failed to fetch MCP Protocol server details: ${error.message}`,
      name,
      port,
      url: `http://localhost:${port}`
    });
  }
});

// Set up WebSocket for real-time updates
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // Send initial status
  const federations = mcpInterface.getAllFederations();
  const mcps = mcpInterface.getAllMcps();
  const mcpProtocolServers = mcpInterface.getAllMcpProtocolServers();
  
  ws.send(JSON.stringify({
    type: 'status',
    data: {
      federations,
      mcps: Object.entries(mcps).map(([name, port]) => ({
        name,
        port,
        url: `http://localhost:${port}`
      })),
      mcpProtocolServers: Object.entries(mcpProtocolServers).map(([name, port]) => ({
        name,
        port,
        url: `http://localhost:${port}`,
        configUrl: `http://localhost:${port}/.well-known/mcp-configuration`
      }))
    }
  }));
  
  // Handle client messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'get_status') {
        // Send updated status
        const federations = mcpInterface.getAllFederations();
        const mcps = mcpInterface.getAllMcps();
        const mcpProtocolServers = mcpInterface.getAllMcpProtocolServers();
        
        ws.send(JSON.stringify({
          type: 'status',
          data: {
            federations,
            mcps: Object.entries(mcps).map(([name, port]) => ({
              name,
              port,
              url: `http://localhost:${port}`
            })),
            mcpProtocolServers: Object.entries(mcpProtocolServers).map(([name, port]) => ({
              name,
              port,
              url: `http://localhost:${port}`,
              configUrl: `http://localhost:${port}/.well-known/mcp-configuration`
            }))
          }
        }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Default route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 fedmgr interface running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`🌐 API endpoints available at http://localhost:${PORT}/api/*`);
});
