/**
 * Unit tests for NPX execution of the fedmgr CLI
 * 
 * Tests the ability to execute the fedmgr CLI via NPX.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { suppressConsoleOutput, restoreConsoleOutput } = require('../../fixtures/setup');
const TestLogger = require('../../fixtures/test-logger');

// Ensure setup is required to set environment variables
require('../../fixtures/setup');

const logger = new TestLogger('TEST-UNIT-CLI-001', 'NPXExecution');

// Helper function to execute NPX commands
const executeNpxCommand = (args) => {
  try {
    // Get the absolute path to the CLI script
    const cliPath = path.resolve(__dirname, '../../../../src/fedmgr.js');
    
    // Execute the command directly using Node.js to simulate NPX execution
    const output = execSync(`node ${cliPath} ${args}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });
    return { success: true, output, exitCode: 0 };
  } catch (error) {
    // If the command fails, capture the error output and exit code
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || '',
      exitCode: error.status || 1
    };
  }
};

// Resolve registry path consistently with the CLI's config
const REGISTRY_FILE = process.env.FEDMGR_FED_REG
  ? path.join(process.env.FEDMGR_FED_REG, 'registry.json')
  : path.resolve(__dirname, '../../../../data/fed-reg/registry.json');

// Helper function to clean up test resources
const cleanupTestResources = (fedName, mcpName) => {
  const fedPath = path.join(process.env.FEDMGR_FEDERATIONS_DIR, fedName);
  if (fs.existsSync(fedPath)) {
    fs.rmSync(fedPath, { recursive: true, force: true });
    logger.info(`Cleaned up test federation: ${fedName}`);
  }
  // Also clean up registry entries
  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      let changed = false;
      if (fedName && registry.federations) {
        const idx = registry.federations.indexOf(fedName);
        if (idx !== -1) { registry.federations.splice(idx, 1); changed = true; }
      }
      if (mcpName && registry.mcps && registry.mcps[mcpName]) {
        delete registry.mcps[mcpName]; changed = true;
      }
      if (changed) fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    } catch (_) {}
  }
};

describe('NPX Execution of fedmgr CLI', () => {
  // Suppress console output during tests
  beforeAll(() => {
    suppressConsoleOutput();
  });

  // Restore console output after tests
  afterAll(() => {
    restoreConsoleOutput();
  });

  // Clean up any test federations and registry entries created during tests
  afterEach(() => {
    cleanupTestResources('test-npx-fed', 'test-npx-mcp');
  });

  /**
   * Scenario 1: Basic Execution
   * Verify that `npx @letsfederate/fedmgr --help` runs successfully and outputs the expected help text.
   */
  describe('Basic Execution', () => {
    test('should execute --help command successfully', () => {
      // Execute the command
      const result = executeNpxCommand('--help');
      
      // Verify the command executed successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify the output contains expected help text
      expect(result.output).toContain('Usage: fedmgr');
      expect(result.output).toContain('Options:');
      expect(result.output).toContain('Commands:');
    });

    test('should execute --version command successfully', () => {
      // Execute the command
      const result = executeNpxCommand('--version');
      
      // Verify the command executed successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify the output contains a version number
      expect(result.output).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  /**
   * Scenario 2: Command Execution
   * Test specific `fedmgr` commands executed via `npx`.
   */
  describe('Command Execution', () => {
    test('should create a federation successfully', () => {
      // Execute the command to create a federation
      const result = executeNpxCommand('create fed test-npx-fed');
      
      // Verify the command executed successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify the output indicates success
      expect(result.output).toContain('Federation \'test-npx-fed\' initialized');
      
      // Verify the federation directory was created
      const fedPath = path.join(process.env.FEDMGR_FEDERATIONS_DIR, 'test-npx-fed');
      expect(fs.existsSync(fedPath)).toBe(true);
      
      // Verify the federation configuration file was created
      const configPath = path.join(fedPath, 'config', 'entity-configuration.json');
      expect(fs.existsSync(configPath)).toBe(true);
      
      // Verify the federation keys were created
      const keysPath = path.join(fedPath, 'keys');
      expect(fs.existsSync(path.join(keysPath, 'anchor-private.pem'))).toBe(true);
      expect(fs.existsSync(path.join(keysPath, 'anchor-public.pem'))).toBe(true);
    });

    test('should create an MCP instance in a federation successfully', () => {
      // First create a federation
      executeNpxCommand('create fed test-npx-fed');
      
      // Then create an MCP instance in the federation
      const result = executeNpxCommand('create mcp test-npx-mcp --federation test-npx-fed');
      
      // Verify the command executed successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify the output indicates success
      expect(result.output).toContain('test-npx-mcp');
    });

    test('should list federations successfully', () => {
      // First create a federation
      executeNpxCommand('create fed test-npx-fed');
      
      // Then list federations
      const result = executeNpxCommand('list');
      
      // Verify the command executed successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify the output contains the created federation
      expect(result.output).toContain('test-npx-fed');
    });
  });

  /**
   * Scenario 3: Error Handling
   * Test how the CLI behaves when executed via `npx` with invalid arguments.
   */
  describe('Error Handling', () => {
    test('should handle non-existent command gracefully', () => {
      // Execute a non-existent command
      const result = executeNpxCommand('non-existent-command');
      
      // Verify the command failed
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      
      // Verify the error output indicates the command is unknown
      expect(result.error).toContain('unknown command');
    });

    test('should handle missing required arguments gracefully', () => {
      // Execute a command without required arguments
      const result = executeNpxCommand('create fed');
      
      // Verify the command failed
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      
      // Verify the error output indicates missing arguments
      expect(result.error).toContain('missing required argument');
    });

    test('should handle missing federation option for MCP creation gracefully', () => {
      // Execute a command without required options
      const result = executeNpxCommand('create mcp test-npx-mcp');
      
      // The CLI exits with an error when the federation option is missing
      expect(result.success).toBe(false);
      expect(result.error).toContain('--federation required for mcp');
    });
  });
});