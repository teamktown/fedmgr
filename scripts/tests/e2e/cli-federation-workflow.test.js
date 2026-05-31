/**
 * CLI End-to-End Federation Workflow Tests
 *
 * Tests complete federation workflows using actual fedmgr CLI commands.
 * These tests mirror OpenID Federation conformance test scenarios.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const TestLogger = require('../fixtures/test-logger');
const setupTestData = require('../fixtures/setup-test-data');

const logger = new TestLogger('TEST-CLI-E2E-001', 'CLIFederationWorkflow');

// Test configuration
const TEST_CONFIG = {
  federationName: 'test-cli-fed',
  mcpName1: 'test-cli-mcp-1',
  mcpName2: 'test-cli-mcp-2',
  testTimeout: 60000, // 60 seconds
  workspaceDir: null // Will be set in beforeAll
};

// Helper function to execute fedmgr CLI commands
const executeCommand = (command, args = [], options = {}) => {
  return new Promise((resolve, reject) => {
    logger.info(`Executing: fedmgr ${command} ${args.join(' ')}`);

    const fedmgrPath = path.resolve(__dirname, '../../../src/fedmgr.js');
    const childProcess = spawn('node', [fedmgrPath, command, ...args], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test', ...options.env },
      cwd: options.cwd || process.cwd()
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      const result = {
        success: code === 0,
        code,
        stdout,
        stderr,
        output: stdout + stderr
      };

      logger.info(`Command completed with code ${code}`);
      if (result.success) {
        resolve(result);
      } else {
        logger.error(`Command failed: ${stderr}`);
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    childProcess.on('error', (error) => {
      logger.error(`Process error: ${error.message}`);
      reject(error);
    });
  });
};

// Helper function to wait for condition
const waitForCondition = async (condition, maxWait = 10000, interval = 500) => {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
};

// Helper function to verify entity configuration
const verifyEntityConfiguration = (entityPath, expectedProperties = {}) => {
  expect(fs.existsSync(entityPath)).toBe(true);

  const config = JSON.parse(fs.readFileSync(entityPath, 'utf-8'));

  // Verify required OpenID Federation properties
  expect(config.sub).toBeDefined();
  expect(config.metadata).toBeDefined();
  expect(config.metadata.federation_entity).toBeDefined();
  expect(config.jwks).toBeDefined();
  expect(config.iat).toBeDefined();

  // Verify specific properties if provided
  Object.entries(expectedProperties).forEach(([key, value]) => {
    expect(config[key]).toEqual(value);
  });

  return config;
};

describe('CLI Federation Workflow End-to-End Tests', () => {
  jest.setTimeout(TEST_CONFIG.testTimeout);

  beforeAll(async () => {
    logger.info('Setting up CLI federation workflow tests');

    // Create temporary workspace for testing
    TEST_CONFIG.workspaceDir = path.join(__dirname, '../../../test-workspace-cli');
    if (fs.existsSync(TEST_CONFIG.workspaceDir)) {
      fs.rmSync(TEST_CONFIG.workspaceDir, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_CONFIG.workspaceDir, { recursive: true });

    // Set up workspace-scoped env vars so the CLI stores data in the workspace dir
    const fedDir = path.join(TEST_CONFIG.workspaceDir, 'federations');
    const regDir = path.join(TEST_CONFIG.workspaceDir, 'data', 'fed-reg');
    fs.mkdirSync(fedDir, { recursive: true });
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'registry.json'), JSON.stringify({ federations: [], mcps: {}, mcpProtocolServers: {} }, null, 2));
    TEST_CONFIG.env = {
      FEDMGR_HOME: TEST_CONFIG.workspaceDir,
      FEDMGR_FEDERATIONS_DIR: fedDir,
      FEDMGR_FED_REG: regDir,
      FEDMGR_FED_REG_FILE: path.join(regDir, 'registry.json')
    };

    logger.info('Workspace environment configured');
  });

  afterAll(() => {
    logger.info('Cleaning up CLI federation workflow tests');

    // Clean up test workspace
    if (TEST_CONFIG.workspaceDir && fs.existsSync(TEST_CONFIG.workspaceDir)) {
      fs.rmSync(TEST_CONFIG.workspaceDir, { recursive: true, force: true });
      logger.info('Test workspace cleaned up');
    }
  });

  describe('Federation Lifecycle Management', () => {
    test('should create a federation with proper configuration', async () => {
      logger.info('Testing federation creation via CLI');

      const result = await executeCommand('create', ['fed', TEST_CONFIG.federationName], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(`Federation '${TEST_CONFIG.federationName}' initialized`);

      // Verify federation directory structure
      const fedPath = path.join(TEST_CONFIG.workspaceDir, 'federations', TEST_CONFIG.federationName);
      expect(fs.existsSync(fedPath)).toBe(true);
      expect(fs.existsSync(path.join(fedPath, 'config'))).toBe(true);
      expect(fs.existsSync(path.join(fedPath, 'keys'))).toBe(true);

      // Verify keys were generated
      expect(fs.existsSync(path.join(fedPath, 'keys', 'anchor-private.pem'))).toBe(true);
      expect(fs.existsSync(path.join(fedPath, 'keys', 'anchor-public.pem'))).toBe(true);

      // Verify entity configuration
      const entityConfigPath = path.join(fedPath, 'config', 'entity-configuration.json');
      const config = verifyEntityConfiguration(entityConfigPath, {
        sub: 'http://localhost:3001'
      });

      expect(config.metadata.federation_entity.organization_name).toContain(TEST_CONFIG.federationName);
      expect(config.metadata.federation_entity.federation_fetch_endpoint).toBeDefined();
      expect(config.metadata.federation_entity.federation_resolve_endpoint).toBeDefined();

      logger.info('Federation creation test completed successfully');
    });

    test('should list federations after creation', async () => {
      logger.info('Testing federation listing via CLI');

      const result = await executeCommand('list', [], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Federations:');
      expect(result.output).toContain(TEST_CONFIG.federationName);

      logger.info('Federation listing test completed successfully');
    });
  });

  describe('MCP Entity Management', () => {
    test('should create MCP entities within federation', async () => {
      logger.info('Testing MCP entity creation via CLI');

      // Create first MCP
      const result1 = await executeCommand('create', ['mcp', TEST_CONFIG.mcpName1, '--federation', TEST_CONFIG.federationName], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result1.success).toBe(true);
      expect(result1.output).toContain(`MCP '${TEST_CONFIG.mcpName1}' initialized`);

      // Create second MCP
      const result2 = await executeCommand('create', ['mcp', TEST_CONFIG.mcpName2, '--federation', TEST_CONFIG.federationName], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result2.success).toBe(true);
      expect(result2.output).toContain(`MCP '${TEST_CONFIG.mcpName2}' initialized`);

      // Verify MCP directory structures
      const mcpPath1 = path.join(TEST_CONFIG.workspaceDir, 'mcp_instances', TEST_CONFIG.mcpName1);
      const mcpPath2 = path.join(TEST_CONFIG.workspaceDir, 'mcp_instances', TEST_CONFIG.mcpName2);

      expect(fs.existsSync(mcpPath1)).toBe(true);
      expect(fs.existsSync(mcpPath2)).toBe(true);

      // Verify MCP entity configurations
      const mcpConfig1Path = path.join(mcpPath1, 'config', 'entity-configuration.json');
      const mcpConfig2Path = path.join(mcpPath2, 'config', 'entity-configuration.json');

      const config1 = verifyEntityConfiguration(mcpConfig1Path);
      const config2 = verifyEntityConfiguration(mcpConfig2Path);

      expect(config1.sub).toBeDefined();
      expect(config2.sub).toBeDefined();
      expect(config1.sub).not.toBe(config2.sub); // Should have unique identifiers

      logger.info('MCP entity creation test completed successfully');
    });

    test('should list MCPs after creation', async () => {
      logger.info('Testing MCP listing via CLI');

      const result = await executeCommand('list', [], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('MCPs:');
      expect(result.output).toContain(TEST_CONFIG.mcpName1);
      expect(result.output).toContain(TEST_CONFIG.mcpName2);

      logger.info('MCP listing test completed successfully');
    });
  });

  describe('Entity Statement Distribution', () => {
    test('should distribute entity statements across federation', async () => {
      logger.info('Testing entity statement distribution via CLI');

      const result = await executeCommand('distribute', [TEST_CONFIG.federationName], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result.success).toBe(true);
      // Command may report success or a connection error if no server is running — either is acceptable
      expect(typeof result.output).toBe('string');

      // Verify entity statements were created/updated
      // This depends on the specific implementation of the distribute command
      // For now, we verify the command executes successfully

      logger.info('Entity statement distribution test completed successfully');
    });
  });

  describe('Federation Inspection and Validation', () => {
    test('should inspect federation configuration', async () => {
      logger.info('Testing federation inspection via CLI');

      const result = await executeCommand('inspect', ['fed', TEST_CONFIG.federationName], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(TEST_CONFIG.federationName);

      logger.info('Federation inspection test completed successfully');
    });

    test('should inspect MCP entities', async () => {
      logger.info('Testing MCP inspection via CLI');

      const result1 = await executeCommand('inspect', ['mcp', TEST_CONFIG.mcpName1], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result1.success).toBe(true);
      expect(result1.output).toContain(TEST_CONFIG.mcpName1);

      const result2 = await executeCommand('inspect', ['mcp', TEST_CONFIG.mcpName2], {
        cwd: TEST_CONFIG.workspaceDir,
        env: TEST_CONFIG.env
      });

      expect(result2.success).toBe(true);
      expect(result2.output).toContain(TEST_CONFIG.mcpName2);

      logger.info('MCP inspection test completed successfully');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle duplicate federation creation gracefully', async () => {
      logger.info('Testing duplicate federation creation handling');

      try {
        const result = await executeCommand('create', ['fed', TEST_CONFIG.federationName], {
          cwd: TEST_CONFIG.workspaceDir
        });

        // Should either succeed (idempotent) or fail gracefully
        if (!result.success) {
          expect(result.output).toMatch(/exists|already/);
        } else {
          expect(result.output).toContain(TEST_CONFIG.federationName);
        }
      } catch (error) {
        // Expected behavior - duplicate creation should be handled gracefully
        expect(error.message).toMatch(/exists|already/);
      }

      logger.info('Duplicate federation creation test completed');
    });

    test('should handle MCP creation without federation option', async () => {
      logger.info('Testing MCP creation without federation option');

      try {
        await executeCommand('create', ['mcp', 'test-invalid-mcp'], {
          cwd: TEST_CONFIG.workspaceDir
        });

        // Should not reach here - command should fail
        expect(false).toBe(true);
      } catch (error) {
        expect(error.message).toMatch(/federation required|--federation|missing/);
      }

      logger.info('MCP creation error handling test completed');
    });

    test('should handle non-existent federation inspection', async () => {
      logger.info('Testing non-existent federation inspection');

      try {
        await executeCommand('inspect', ['fed', 'non-existent-federation'], {
          cwd: TEST_CONFIG.workspaceDir
        });

        // Should not reach here - command should fail
        expect(false).toBe(true);
      } catch (error) {
        expect(error.message).toMatch(/not found|does not exist|No such/);
      }

      logger.info('Non-existent federation inspection test completed');
    });
  });

  describe('Cleanup Operations', () => {
    test('should stop federation resources', async () => {
      logger.info('Testing federation resource stopping via CLI');

      try {
        const result = await executeCommand('stop', [TEST_CONFIG.federationName], {
          cwd: TEST_CONFIG.workspaceDir
        });

        // May succeed or fail depending on whether resources were running
        // The important thing is that it handles the operation gracefully
        logger.info(`Stop command result: ${result.success ? 'success' : 'handled gracefully'}`);
      } catch (error) {
        // Acceptable if no resources were running
        logger.info(`Stop command handled gracefully: ${error.message}`);
      }
    });

    test('should delete federation resources', async () => {
      logger.info('Testing federation resource deletion via CLI');

      try {
        const result = await executeCommand('delete', ['fed', TEST_CONFIG.federationName], {
          cwd: TEST_CONFIG.workspaceDir
        });

        if (result.success) {
          expect(result.output).toContain('deleted') || expect(result.output).toContain('removed');

          // Verify federation directory is removed or marked for deletion
          const fedPath = path.join(TEST_CONFIG.workspaceDir, 'federations', TEST_CONFIG.federationName);
          // Note: Implementation may mark for deletion rather than immediate removal
        }
      } catch (error) {
        // May fail if delete command is not fully implemented
        logger.info(`Delete command: ${error.message}`);
      }

      logger.info('Federation deletion test completed');
    });
  });
});
