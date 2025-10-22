#!/usr/bin/env node
/**
 * Test launcher for the enhanced Federation Admin Dashboard
 * 
 * This script starts the enhanced federation admin server with
 * JSON-RPC 2.0 API, WebSocket support, and MCP server management.
 */

const path = require('path');
const fs = require('fs');

// Set environment variables for testing
process.env.PORT = process.env.PORT || '3001';
process.env.FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.resolve(__dirname, 'federations');
process.env.FEDMGR_MCP_INSTANCES_DIR = process.env.FEDMGR_MCP_INSTANCES_DIR || path.resolve(__dirname, 'mcp_instances');
process.env.FEDMGR_PUBLIC_DIR = process.env.FEDMGR_PUBLIC_DIR || path.resolve(__dirname, 'public');

// Ensure directories exist
const dirs = [
  process.env.FEDMGR_FEDERATIONS_DIR,
  process.env.FEDMGR_MCP_INSTANCES_DIR,
  path.join(process.env.FEDMGR_FEDERATIONS_DIR, 'config'),
  path.join(process.env.FEDMGR_FEDERATIONS_DIR, 'keys')
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Start the enhanced federation admin server
console.log('🚀 Starting Enhanced Federation Admin Dashboard...');
console.log(`📁 Federations directory: ${process.env.FEDMGR_FEDERATIONS_DIR}`);
console.log(`🤖 MCP instances directory: ${process.env.FEDMGR_MCP_INSTANCES_DIR}`);
console.log(`📱 Public directory: ${process.env.FEDMGR_PUBLIC_DIR}`);
console.log('');

try {
  require('./src/fedmgr/server/federation-admin.js');
} catch (error) {
  console.error('❌ Failed to start server:', error.message);
  console.error(error.stack);
  process.exit(1);
}