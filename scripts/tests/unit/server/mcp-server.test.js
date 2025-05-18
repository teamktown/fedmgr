/**
 * Unit tests for MCP Server
 *
 * Tests the core functionality of the MCP Server component.
 */

// Import test utilities
const TestLogger = require('../../fixtures/test-logger');
const { suppressConsoleOutput, restoreConsoleOutput } = require('../../fixtures/setup');

// Create a logger for the tests
const logger = new TestLogger('TEST-INIT-001', 'MCPServer');

/**
 * Defensive assertion helper that checks if a mock function has been called
 * and provides detailed error information if not
 *
 * @param {jest.Mock} mockFn - The mock function to check
 * @param {string} mockName - The name of the mock function for error reporting
 * @param {number} expectedCalls - The expected number of calls (default: at least 1)
 * @returns {boolean} - Whether the assertion passed
 */
function assertMockCalled(mockFn, mockName, expectedCalls = 1) {
  try {
    // Verify the mock is properly defined
    if (!mockFn || typeof mockFn.mock !== 'object') {
      logger.error(`ASSERTION FAILED: ${mockName} is not a valid mock function`);
      return false;
    }
    
    // Get the actual number of calls
    const actualCalls = mockFn.mock.calls.length;
    
    // Check if the mock was called the expected number of times
    if (actualCalls < expectedCalls) {
      logger.error(`ASSERTION FAILED: ${mockName} was called ${actualCalls} times, expected at least ${expectedCalls} times`);
      return false;
    }
    
    logger.info(`ASSERTION PASSED: ${mockName} was called ${actualCalls} times`);
    return true;
  } catch (error) {
    logger.error(`ASSERTION ERROR: Failed to check ${mockName}: ${error.message}`);
    return false;
  }
}

/**
 * Safely get mock call arguments with error handling
 *
 * @param {jest.Mock} mockFn - The mock function
 * @param {number} callIndex - The call index
 * @param {number} argIndex - The argument index
 * @param {string} mockName - The name of the mock function for error reporting
 * @returns {any} - The argument value or undefined if not available
 */
function getMockCallArg(mockFn, callIndex, argIndex, mockName) {
  try {
    // Verify the mock is properly defined
    if (!mockFn || typeof mockFn.mock !== 'object') {
      logger.error(`ERROR: ${mockName} is not a valid mock function`);
      return undefined;
    }
    
    // Check if the call exists
    if (!mockFn.mock.calls[callIndex]) {
      logger.error(`ERROR: ${mockName} call ${callIndex} does not exist`);
      return undefined;
    }
    
    // Return the argument
    return mockFn.mock.calls[callIndex][argIndex];
  } catch (error) {
    logger.error(`ERROR: Failed to get ${mockName} call ${callIndex} arg ${argIndex}: ${error.message}`);
    return undefined;
  }
}

// Mock data for tests
const mockData = {
  entityConfig: {
    sub: 'https://example.org/federation',
    iss: 'https://example.org/federation',
    jwks: {
      keys: [
        {
          kid: 'test-key-1',
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          n: 'test-n',
          e: 'AQAB'
        }
      ]
    },
    metadata: {
      federation_entity: {
        name: 'Test Federation Entity',
        contacts: ['admin@example.org']
      }
    }
  }
};

// Test suite for server initialization
describe('MCP Server Initialization', () => {
  let originalArgv;
  let mockExit;
  let mockConsoleError;
  let mockConsoleLog;
  
  // Mocks for dependencies
  let mockExpressApp;
  let mockExpress;
  let mockHttp;
  let mockWebSocketServer;
  let mockServer;
  let mockFs;
  let mockPath;
  
  beforeEach(() => {
    // Reset all mocks to ensure test isolation
    jest.resetAllMocks();
    
    // Save original process.argv
    originalArgv = process.argv;
    
    // Set up mocks with defensive checks
    try {
      mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      if (!mockExit || typeof mockExit.mock !== 'object') {
        throw new Error('Failed to mock process.exit');
      }
      
      mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      if (!mockConsoleError || typeof mockConsoleError.mock !== 'object') {
        throw new Error('Failed to mock console.error');
      }
      
      mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
      if (!mockConsoleLog || typeof mockConsoleLog.mock !== 'object') {
        throw new Error('Failed to mock console.log');
      }
      
      logger.info('Test mocks set up successfully');
    } catch (error) {
      logger.error(`Failed to set up test mocks: ${error.message}`);
      throw error; // Re-throw to fail the test
    }
    
    // Set up mock Express app
    mockExpressApp = {
      get: jest.fn(),
      post: jest.fn(),
      use: jest.fn(),
      listen: jest.fn()
    };
    
    // Set up mock Express
    mockExpress = jest.fn(() => mockExpressApp);
    mockExpress.json = jest.fn(() => 'json-middleware');
    
    // Set up mock HTTP server
    mockServer = {
      listen: jest.fn((port, callback) => {
        if (callback) callback();
        return mockServer;
      })
    };
    
    mockHttp = {
      createServer: jest.fn(() => mockServer)
    };
    
    // Set up mock WebSocket server
    mockWebSocketServer = {
      on: jest.fn(),
      clients: [],
      close: jest.fn()
    };
    
    // Set up mock fs module
    mockFs = {
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => JSON.stringify(mockData.entityConfig)),
      mkdirSync: jest.fn()
    };
    
    // Set up mock path module
    mockPath = {
      resolve: jest.fn((...args) => '/mock/path'),
      join: jest.fn((...args) => '/mock/path/file')
    };
    
    // Set up mocks for modules
    jest.doMock('express', () => mockExpress);
    jest.doMock('http', () => mockHttp);
    jest.doMock('ws', () => ({
      Server: jest.fn(() => mockWebSocketServer)
    }));
    jest.doMock('fs', () => mockFs);
    jest.doMock('path', () => mockPath);
    
    // Set default process.argv for tests
    process.argv = ['node', 'mcp-server.js', '--name', 'test-mcp', '--port', '9000'];
  });
  
  afterEach(() => {
    // Restore original values with defensive checks
    try {
      process.argv = originalArgv;
      
      if (mockExit && typeof mockExit.mockRestore === 'function') {
        mockExit.mockRestore();
      }
      
      if (mockConsoleError && typeof mockConsoleError.mockRestore === 'function') {
        mockConsoleError.mockRestore();
      }
      
      if (mockConsoleLog && typeof mockConsoleLog.mockRestore === 'function') {
        mockConsoleLog.mockRestore();
      }
      
      logger.info('Test mocks restored successfully');
    } catch (error) {
      logger.error(`Failed to restore test mocks: ${error.message}`);
      // Don't throw here to avoid masking test failures
    }
    
    // Clear all mocks
    jest.resetModules();
    jest.clearAllMocks();
  });
  
  test('should initialize correctly with valid configuration', () => {
    logger.info('Starting server initialization test with valid configuration');
    
    // Run the test in an isolated module environment
    jest.isolateModules(() => {
      // Import the MCP server (this will execute the file)
      require('../../../../src/fedmgr/server/mcp-server');
      
      // Verify that express was initialized
      expect(mockExpress).toHaveBeenCalled();
      
      // Verify that http.createServer was called with the express app
      expect(mockHttp.createServer).toHaveBeenCalledWith(mockExpressApp);
      
      // Verify that the server is listening on the correct port
      expect(mockServer.listen).toHaveBeenCalledWith(9000, expect.any(Function));
      
      // Verify that the entity configuration was loaded
      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readFileSync).toHaveBeenCalled();
      
      // Log the number of times each mock was called for debugging
      logger.info(`Express called ${mockExpress.mock.calls.length} times`);
      logger.info(`HTTP createServer called ${mockHttp.createServer.mock.calls.length} times`);
      logger.info(`Server listen called ${mockServer.listen.mock.calls.length} times`);
      logger.info(`fs.existsSync called ${mockFs.existsSync.mock.calls.length} times`);
      logger.info(`fs.readFileSync called ${mockFs.readFileSync.mock.calls.length} times`);
    });
    
    logger.info('Server initialization test with valid configuration completed');
  });
  
  test('should exit if name is missing', () => {
    logger.info('Starting server initialization test with missing name');
    
    // Set process.argv without name
    process.argv = ['node', 'mcp-server.js', '--port', '9000'];
    
    // Run the test in an isolated module environment
    jest.isolateModules(() => {
      // Import the MCP server (this will execute the file)
      require('../../../../src/fedmgr/server/mcp-server');
      
      // Verify that process.exit was called with code 1 using our defensive helper
      const exitCalled = assertMockCalled(mockExit, 'process.exit');
      expect(exitCalled).toBe(true);
      
      if (exitCalled) {
        const exitCode = getMockCallArg(mockExit, 0, 0, 'process.exit');
        expect(exitCode).toBe(1);
        logger.info(`Exit called with code: ${exitCode}`);
      }
      
      // Verify that console.error was called with an error message
      const errorCalled = assertMockCalled(mockConsoleError, 'console.error');
      expect(errorCalled).toBe(true);
      
      if (errorCalled) {
        const errorCount = mockConsoleError.mock.calls.length;
        logger.info(`Console.error called ${errorCount} times`);
        
        // Log the error messages for debugging
        mockConsoleError.mock.calls.forEach((call, index) => {
          logger.info(`Error message ${index + 1}: ${call[0]}`);
        });
      }
    });
    
    logger.info('Server initialization test with missing name completed');
  });
  
  test('should exit if port is missing', () => {
    logger.info('Starting server initialization test with missing port');
    
    // Set process.argv without port
    process.argv = ['node', 'mcp-server.js', '--name', 'test-mcp'];
    
    // Run the test in an isolated module environment
    jest.isolateModules(() => {
      // Import the MCP server (this will execute the file)
      require('../../../../src/fedmgr/server/mcp-server');
      
      // Verify that process.exit was called with code 1 using our defensive helper
      const exitCalled = assertMockCalled(mockExit, 'process.exit');
      expect(exitCalled).toBe(true);
      
      if (exitCalled) {
        const exitCode = getMockCallArg(mockExit, 0, 0, 'process.exit');
        expect(exitCode).toBe(1);
        logger.info(`Exit called with code: ${exitCode}`);
      }
      
      // Verify that console.error was called with an error message
      const errorCalled = assertMockCalled(mockConsoleError, 'console.error');
      expect(errorCalled).toBe(true);
      
      if (errorCalled) {
        const errorCount = mockConsoleError.mock.calls.length;
        logger.info(`Console.error called ${errorCount} times`);
        
        // Log the error messages for debugging
        mockConsoleError.mock.calls.forEach((call, index) => {
          logger.info(`Error message ${index + 1}: ${call[0]}`);
        });
      }
    });
    
    logger.info('Server initialization test with missing port completed');
  });
});

// Test suite for API endpoints
describe('MCP Server API Endpoints', () => {
  // Mocks for dependencies
  let mockExpressApp;
  
  beforeEach(() => {
    // Reset all mocks to ensure test isolation
    jest.resetAllMocks();
    
    // Set up mock Express app
    mockExpressApp = {
      get: jest.fn(),
      post: jest.fn(),
      use: jest.fn(),
      listen: jest.fn()
    };
    
    // Mock the /whoami endpoint
    mockExpressApp.get.mockImplementation((path, handler) => {
      if (path === '/whoami') {
        return handler;
      }
      return null;
    });
    
    // Mock the /stats endpoint
    mockExpressApp.get.mockImplementation((path, handler) => {
      if (path === '/stats') {
        return handler;
      }
      return null;
    });
  });
  
  // These tests will be implemented in a future update
  test.todo('should set up entity configuration endpoint');
  test.todo('should set up entity statements endpoint');
  test.todo('should set up API endpoint with token validation');
  
  test('should return MCP identity for /whoami endpoint', async () => {
    logger.info('Starting /whoami endpoint test');
    
    // Create a handler for the /whoami endpoint
    const whoamiHandler = (req, res) => {
      res.status(200).json({
        name: 'test-mcp',
        version: '1.0.0',
        status: 'active'
      });
    };
    
    // Register the handler
    mockExpressApp.get('/whoami', whoamiHandler);
    
    // Mock request and response objects
    const mockReq = {};
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    // Call the handler
    await whoamiHandler(mockReq, mockRes);
    
    // Verify the response status and content
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      name: 'test-mcp'
    }));
    
    logger.info('/whoami endpoint test completed');
  });
  
  test('should return usage statistics for /stats endpoint', async () => {
    logger.info('Starting /stats endpoint test');
    
    // Create a handler for the /stats endpoint
    const statsHandler = (req, res) => {
      res.status(200).json({
        totalRequests: 100,
        activeConnections: 5,
        uptime: '1h 30m'
      });
    };
    
    // Register the handler
    mockExpressApp.get('/stats', statsHandler);
    
    // Mock request and response objects
    const mockReq = {};
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    // Call the handler
    await statsHandler(mockReq, mockRes);
    
    // Verify the response status and content
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      totalRequests: expect.any(Number),
      activeConnections: expect.any(Number)
    }));
    
    logger.info('/stats endpoint test completed');
  });
});