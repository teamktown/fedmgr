/**
 * End-to-End tests for Federation Workflow
 * 
 * Tests the complete federation workflow from entity registration to trust verification.
 */

const { spawn } = require('child_process');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const TestLogger = require('../fixtures/test-logger');

const logger = new TestLogger('TEST-E2E-001', 'FederationWorkflow');

// Test configuration
const TEST_CONFIG = {
  federationPort: 9001,
  mcp1Port: 9002,
  mcp2Port: 9003,
  federationName: 'test-federation',
  mcp1Name: 'test-mcp1',
  mcp2Name: 'test-mcp2',
  testTimeout: 30000 // 30 seconds
};

// Helper function to start a server process
const startServer = (name, port) => {
  logger.info(`Starting ${name} on port ${port}`);
  
  const serverProcess = spawn('node', [
    'src/server/mcp-server.js',
    '--name', name,
    '--port', port.toString()
  ], {
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  
  // Log server output
  serverProcess.stdout.on('data', (data) => {
    logger.info(`[${name}] ${data.toString().trim()}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    logger.error(`[${name}] ${data.toString().trim()}`);
  });
  
  return serverProcess;
};

// Helper function to wait for a server to be ready
const waitForServer = async (port, maxRetries = 10, retryDelay = 1000) => {
  logger.info(`Waiting for server on port ${port} to be ready`);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/.well-known/openid-federation`);
      if (response.ok) {
        logger.info(`Server on port ${port} is ready`);
        return true;
      }
    } catch (error) {
      logger.info(`Server on port ${port} not ready yet, retrying... (${i + 1}/${maxRetries})`);
    }
    
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
  
  throw new Error(`Server on port ${port} did not become ready in time`);
};

// Helper function to register an MCP with the federation
const registerMCP = async (mcpName, mcpPort, federationPort) => {
  logger.info(`Registering ${mcpName} with federation`);
  
  // Get the MCP entity configuration
  const mcpConfigResponse = await fetch(`http://localhost:${mcpPort}/.well-known/openid-federation`);
  const mcpConfig = await mcpConfigResponse.json();
  
  // Register the MCP with the federation
  const registerResponse = await fetch(`http://localhost:${federationPort}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      entity_id: mcpConfig.sub,
      metadata: mcpConfig.metadata
    })
  });
  
  const result = await registerResponse.json();
  logger.info(`Registration result: ${JSON.stringify(result)}`);
  
  return result;
};

// Helper function to verify trust between two MCPs
const verifyTrust = async (sourcePort, targetEntityId) => {
  logger.info(`Verifying trust from port ${sourcePort} to ${targetEntityId}`);
  
  const verifyResponse = await fetch(`http://localhost:${sourcePort}/verify-trust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      entity_id: targetEntityId
    })
  });
  
  const result = await verifyResponse.json();
  logger.info(`Trust verification result: ${JSON.stringify(result)}`);
  
  return result;
};

describe('Federation Workflow', () => {
  let federationProcess;
  let mcp1Process;
  let mcp2Process;
  
  // This test takes longer than the default Jest timeout
  jest.setTimeout(TEST_CONFIG.testTimeout);
  
  beforeAll(async () => {
    logger.info('Setting up federation workflow test');
    
    // Create test directories if they don't exist
    const testDirs = [
      `mcp_instances/${TEST_CONFIG.federationName}/config`,
      `mcp_instances/${TEST_CONFIG.mcp1Name}/config`,
      `mcp_instances/${TEST_CONFIG.mcp2Name}/config`
    ];
    
    testDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Start the federation server
    federationProcess = startServer(TEST_CONFIG.federationName, TEST_CONFIG.federationPort);
    
    // Start the MCP servers
    mcp1Process = startServer(TEST_CONFIG.mcp1Name, TEST_CONFIG.mcp1Port);
    mcp2Process = startServer(TEST_CONFIG.mcp2Name, TEST_CONFIG.mcp2Port);
    
    // Wait for all servers to be ready
    await Promise.all([
      waitForServer(TEST_CONFIG.federationPort),
      waitForServer(TEST_CONFIG.mcp1Port),
      waitForServer(TEST_CONFIG.mcp2Port)
    ]);
    
    logger.info('All servers started and ready');
  });
  
  afterAll(() => {
    logger.info('Tearing down federation workflow test');
    
    // Kill all server processes
    if (federationProcess) federationProcess.kill();
    if (mcp1Process) mcp1Process.kill();
    if (mcp2Process) mcp2Process.kill();
    
    logger.info('All servers stopped');
  });
  
  test('should complete the full federation workflow', async () => {
    logger.info('Starting full federation workflow test');
    
    // Step 1: Register MCP1 with the federation
    const mcp1Registration = await registerMCP(
      TEST_CONFIG.mcp1Name,
      TEST_CONFIG.mcp1Port,
      TEST_CONFIG.federationPort
    );
    
    expect(mcp1Registration.success).toBe(true);
    expect(mcp1Registration.entity_id).toBeDefined();
    
    // Step 2: Register MCP2 with the federation
    const mcp2Registration = await registerMCP(
      TEST_CONFIG.mcp2Name,
      TEST_CONFIG.mcp2Port,
      TEST_CONFIG.federationPort
    );
    
    expect(mcp2Registration.success).toBe(true);
    expect(mcp2Registration.entity_id).toBeDefined();
    
    // Step 3: Distribute entity statements
    const distributeResponse = await fetch(`http://localhost:${TEST_CONFIG.federationPort}/distribute-statements`, {
      method: 'POST'
    });
    
    const distributeResult = await distributeResponse.json();
    expect(distributeResult.success).toBe(true);
    expect(distributeResult.distributed).toBeGreaterThan(0);
    
    // Step 4: Verify trust from MCP1 to MCP2
    const mcp1ToMcp2Trust = await verifyTrust(
      TEST_CONFIG.mcp1Port,
      mcp2Registration.entity_id
    );
    
    expect(mcp1ToMcp2Trust.valid).toBe(true);
    expect(mcp1ToMcp2Trust.chain).toBeDefined();
    expect(mcp1ToMcp2Trust.chain.length).toBeGreaterThan(0);
    
    // Step 5: Verify trust from MCP2 to MCP1
    const mcp2ToMcp1Trust = await verifyTrust(
      TEST_CONFIG.mcp2Port,
      mcp1Registration.entity_id
    );
    
    expect(mcp2ToMcp1Trust.valid).toBe(true);
    expect(mcp2ToMcp1Trust.chain).toBeDefined();
    expect(mcp2ToMcp1Trust.chain.length).toBeGreaterThan(0);
    
    logger.info('Full federation workflow test completed successfully');
  });
});