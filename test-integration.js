#!/usr/bin/env node
/**
 * Integration Test for Enhanced FedMgr System
 * 
 * This script tests the JSON-RPC 2.0 API, WebSocket connections,
 * and MCP server management functionality.
 */

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

class IntegrationTester {
  constructor() {
    this.baseUrl = 'http://localhost:3001';
    this.apiUrl = `${this.baseUrl}/api/v1`;
    this.wsUrl = 'ws://localhost:3001';
    this.tests = [];
    this.results = [];
  }
  
  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
  
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const requestOptions = {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      };
      
      const req = http.request(url, requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = {
              status: res.statusCode,
              headers: res.headers,
              data: data ? JSON.parse(data) : null
            };
            resolve(result);
          } catch (error) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data,
              error: error.message
            });
          }
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      
      req.end();
    });
  }
  
  async testWebSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws`);
      let connected = false;
      
      const timeout = setTimeout(() => {
        if (!connected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 5000);
      
      ws.on('open', () => {
        connected = true;
        clearTimeout(timeout);
        this.log('✅ WebSocket connected');
        
        ws.send(JSON.stringify({
          type: 'test',
          message: 'Hello from integration test'
        }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.log(`📨 WebSocket message: ${message.type}`);
          
          if (message.type === 'welcome') {
            ws.close();
            resolve(true);
          }
        } catch (error) {
          this.log(`⚠️ WebSocket message parse error: ${error.message}`);
        }
      });
      
      ws.on('close', () => {
        this.log('📡 WebSocket disconnected');
        if (connected) {
          resolve(true);
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
  
  async runTests() {
    this.log('🧪 Starting Enhanced FedMgr Integration Tests');
    this.log('===============================================');
    
    // Test 1: Check if server is running
    try {
      this.log('🔍 Testing server health...');
      const health = await this.makeRequest('/health');
      if (health.status === 200) {
        this.log('✅ Server is healthy');
        this.results.push({ test: 'Server Health', status: 'PASS' });
      } else {
        throw new Error(`Server health check failed: ${health.status}`);
      }
    } catch (error) {
      this.log(`❌ Server health test failed: ${error.message}`);
      this.results.push({ test: 'Server Health', status: 'FAIL', error: error.message });
      return; // Can't continue if server is not running
    }
    
    // Test 2: Test Admin API endpoints
    try {
      this.log('🔍 Testing Admin API...');
      const apiInfo = await this.makeRequest('/api/v1');
      if (apiInfo.status === 200 && apiInfo.data.name === 'FedMgr Admin API') {
        this.log('✅ Admin API is accessible');
        this.results.push({ test: 'Admin API', status: 'PASS' });
      } else {
        throw new Error('Admin API not responding correctly');
      }
    } catch (error) {
      this.log(`❌ Admin API test failed: ${error.message}`);
      this.results.push({ test: 'Admin API', status: 'FAIL', error: error.message });
    }
    
    // Test 3: Test JSON-RPC 2.0 endpoint
    try {
      this.log('🔍 Testing JSON-RPC 2.0...');
      const jsonrpc = await this.makeRequest('/api/v1/jsonrpc', {
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          method: 'system.info',
          id: 1
        }
      });
      
      if (jsonrpc.status === 200 && jsonrpc.data.jsonrpc === '2.0' && jsonrpc.data.result) {
        this.log('✅ JSON-RPC 2.0 is working');
        this.results.push({ test: 'JSON-RPC 2.0', status: 'PASS' });
      } else {
        throw new Error('JSON-RPC 2.0 not responding correctly');
      }
    } catch (error) {
      this.log(`❌ JSON-RPC 2.0 test failed: ${error.message}`);
      this.results.push({ test: 'JSON-RPC 2.0', status: 'FAIL', error: error.message });
    }
    
    // Test 4: Test Federation endpoints
    try {
      this.log('🔍 Testing Federation API...');
      const federation = await this.makeRequest('/api/v1/federation/info');
      if (federation.status === 200) {
        this.log('✅ Federation API is working');
        this.results.push({ test: 'Federation API', status: 'PASS' });
      } else {
        throw new Error(`Federation API failed: ${federation.status}`);
      }
    } catch (error) {
      this.log(`❌ Federation API test failed: ${error.message}`);
      this.results.push({ test: 'Federation API', status: 'FAIL', error: error.message });
    }
    
    // Test 5: Test MCP Servers endpoint
    try {
      this.log('🔍 Testing MCP Servers API...');
      const mcpServers = await this.makeRequest('/api/v1/mcp/servers');
      if (mcpServers.status === 200 && Array.isArray(mcpServers.data)) {
        this.log('✅ MCP Servers API is working');
        this.results.push({ test: 'MCP Servers API', status: 'PASS' });
      } else {
        throw new Error('MCP Servers API not responding correctly');
      }
    } catch (error) {
      this.log(`❌ MCP Servers API test failed: ${error.message}`);
      this.results.push({ test: 'MCP Servers API', status: 'FAIL', error: error.message });
    }
    
    // Test 6: Test WebSocket connection
    try {
      this.log('🔍 Testing WebSocket connection...');
      await this.testWebSocket();
      this.log('✅ WebSocket is working');
      this.results.push({ test: 'WebSocket', status: 'PASS' });
    } catch (error) {
      this.log(`❌ WebSocket test failed: ${error.message}`);
      this.results.push({ test: 'WebSocket', status: 'FAIL', error: error.message });
    }
    
    // Test 7: Test Enhanced UI
    try {
      this.log('🔍 Testing Enhanced UI...');
      const ui = await this.makeRequest('/');
      if (ui.status === 200 && ui.data && ui.data.includes('FedMgr Admin Dashboard')) {
        this.log('✅ Enhanced UI is accessible');
        this.results.push({ test: 'Enhanced UI', status: 'PASS' });
      } else {
        throw new Error('Enhanced UI not accessible');
      }
    } catch (error) {
      this.log(`❌ Enhanced UI test failed: ${error.message}`);
      this.results.push({ test: 'Enhanced UI', status: 'FAIL', error: error.message });
    }
    
    // Print results
    this.log('');
    this.log('📊 Integration Test Results');
    this.log('===========================');
    
    let passed = 0;
    let failed = 0;
    
    this.results.forEach(result => {
      const status = result.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
      this.log(`${status} - ${result.test}`);
      if (result.error) {
        this.log(`    Error: ${result.error}`);
      }
      
      if (result.status === 'PASS') passed++;
      else failed++;
    });
    
    this.log('');
    this.log(`📈 Summary: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      this.log('🎉 All integration tests passed!');
      process.exit(0);
    } else {
      this.log('⚠️ Some integration tests failed');
      process.exit(1);
    }
  }
}

// Check if server is already running, if not suggest starting it
async function checkServer() {
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3001/health', resolve);
      req.on('error', reject);
      req.setTimeout(2000, () => reject(new Error('Timeout')));
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.log('❌ Server is not running on port 3001');
    console.log('');
    console.log('To start the enhanced federation admin server, run:');
    console.log('  node test-enhanced-admin.js');
    console.log('');
    console.log('Then run this integration test again.');
    process.exit(1);
  }
  
  const tester = new IntegrationTester();
  await tester.runTests();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = IntegrationTester;