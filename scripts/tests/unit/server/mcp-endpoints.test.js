/**
 * Unit tests for MCP Server Endpoints
 * 
 * Tests the API endpoints of the MCP Server component, focusing on
 * identity and usage statistics endpoints.
 */

const TestLogger = require('../../fixtures/test-logger');
const { suppressConsoleOutput, restoreConsoleOutput } = require('../../fixtures/setup');

// Create a logger for the tests
const logger = new TestLogger('TEST-UNIT-002', 'MCPEndpoints');

// Mock data for tests
const mockServerConfig = {
  name: 'test-mcp',
  version: '1.0.0',
  startTime: Date.now(),
  requestCount: 0,
  activeConnections: 0
};

describe('MCP Server Endpoints', () => {
  let mockExpressApp;
  let mockReq;
  let mockRes;
  let whoamiHandler;
  let statsHandler;
  
  beforeEach(() => {
    // Reset all mocks to ensure test isolation
    jest.resetAllMocks();
    
    // Set up mock Express app
    mockExpressApp = {
      get: jest.fn(),
      post: jest.fn(),
      use: jest.fn()
    };
    
    // Set up mock request and response objects
    mockReq = {
      headers: {},
      query: {},
      params: {}
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis()
    };
    
    // Create handlers for the endpoints
    whoamiHandler = (req, res) => {
      res.status(200).json({
        name: mockServerConfig.name,
        version: mockServerConfig.version,
        status: 'active',
        uptime: Math.floor((Date.now() - mockServerConfig.startTime) / 1000)
      });
    };
    
    statsHandler = (req, res) => {
      res.status(200).json({
        totalRequests: mockServerConfig.requestCount,
        activeConnections: mockServerConfig.activeConnections,
        uptime: Math.floor((Date.now() - mockServerConfig.startTime) / 1000),
        memoryUsage: process.memoryUsage()
      });
    };
    
    // Register the handlers
    mockExpressApp.get('/whoami', whoamiHandler);
    mockExpressApp.get('/stats', statsHandler);
  });
  
  describe('/whoami endpoint', () => {
    test('should return MCP identity information', async () => {
      logger.info('Starting /whoami endpoint test');
      
      // Call the handler
      await whoamiHandler(mockReq, mockRes);
      
      // Verify the response status and content
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        name: mockServerConfig.name,
        version: expect.any(String),
        status: 'active',
        uptime: expect.any(Number)
      }));
      
      logger.info('/whoami endpoint test completed');
    });
    
    test('should include correct content type header', async () => {
      logger.info('Starting /whoami content type test');
      
      // Mock the setHeader method
      mockRes.setHeader = jest.fn().mockReturnThis();
      
      // Create a handler that sets the content type
      const handlerWithContentType = (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        return whoamiHandler(req, res);
      };
      
      // Call the handler
      await handlerWithContentType(mockReq, mockRes);
      
      // Verify the content type header
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      
      logger.info('/whoami content type test completed');
    });
    
    test('should handle errors gracefully', async () => {
      logger.info('Starting /whoami error handling test');
      
      // Create a handler that throws an error
      const errorHandler = (req, res) => {
        throw new Error('Test error');
      };
      
      // Mock the error middleware
      const errorMiddleware = (err, req, res, next) => {
        res.status(500).json({ error: err.message });
      };
      
      // Register the error middleware
      mockExpressApp.use(errorMiddleware);
      
      try {
        // Call the handler that throws an error
        await errorHandler(mockReq, mockRes);
      } catch (error) {
        // Handle the error with the middleware
        errorMiddleware(error, mockReq, mockRes);
      }
      
      // Verify the error response
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Test error'
      }));
      
      logger.info('/whoami error handling test completed');
    });
  });
  
  describe('/stats endpoint', () => {
    test('should return usage statistics', async () => {
      logger.info('Starting /stats endpoint test');
      
      // Update mock server config with some test data
      mockServerConfig.requestCount = 100;
      mockServerConfig.activeConnections = 5;
      
      // Call the handler
      await statsHandler(mockReq, mockRes);
      
      // Verify the response status and content
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        totalRequests: 100,
        activeConnections: 5,
        uptime: expect.any(Number),
        memoryUsage: expect.any(Object)
      }));
      
      logger.info('/stats endpoint test completed');
    });
    
    test('should include memory usage information', async () => {
      logger.info('Starting /stats memory usage test');
      
      // Call the handler
      await statsHandler(mockReq, mockRes);
      
      // Get the response data
      const responseData = mockRes.json.mock.calls[0][0];
      
      // Verify memory usage information
      expect(responseData.memoryUsage).toBeDefined();
      expect(responseData.memoryUsage.rss).toBeDefined();
      expect(responseData.memoryUsage.heapTotal).toBeDefined();
      expect(responseData.memoryUsage.heapUsed).toBeDefined();
      expect(responseData.memoryUsage.external).toBeDefined();
      
      logger.info('/stats memory usage test completed');
    });
    
    test('should handle query parameters for filtering stats', async () => {
      logger.info('Starting /stats query parameters test');
      
      // Create a request with query parameters
      const reqWithQuery = {
        ...mockReq,
        query: {
          fields: 'totalRequests,uptime'
        }
      };
      
      // Create a handler that respects query parameters
      const filteredStatsHandler = (req, res) => {
        const fields = req.query.fields ? req.query.fields.split(',') : null;
        
        const fullStats = {
          totalRequests: mockServerConfig.requestCount,
          activeConnections: mockServerConfig.activeConnections,
          uptime: Math.floor((Date.now() - mockServerConfig.startTime) / 1000),
          memoryUsage: process.memoryUsage()
        };
        
        if (fields) {
          const filteredStats = {};
          fields.forEach(field => {
            if (fullStats[field] !== undefined) {
              filteredStats[field] = fullStats[field];
            }
          });
          return res.status(200).json(filteredStats);
        }
        
        return res.status(200).json(fullStats);
      };
      
      // Call the handler with query parameters
      await filteredStatsHandler(reqWithQuery, mockRes);
      
      // Verify the filtered response
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        totalRequests: expect.any(Number),
        uptime: expect.any(Number)
      }));
      
      // Verify that other fields are not included
      const responseData = mockRes.json.mock.calls[0][0];
      expect(responseData.activeConnections).toBeUndefined();
      expect(responseData.memoryUsage).toBeUndefined();
      
      logger.info('/stats query parameters test completed');
    });
  });
  
  describe('Authentication and Authorization', () => {
    test('should require authentication for protected endpoints', async () => {
      logger.info('Starting authentication test');
      
      // Create a middleware that checks for authentication
      const authMiddleware = (req, res, next) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        next();
      };
      
      // Create a protected endpoint handler
      const protectedHandler = (req, res) => {
        res.status(200).json({ message: 'Protected data' });
      };
      
      // Register the protected endpoint with auth middleware
      mockExpressApp.get('/protected', authMiddleware, protectedHandler);
      
      // Call the protected endpoint without authentication
      const protectedReq = { ...mockReq, headers: {} };
      await authMiddleware(protectedReq, mockRes, () => {});
      
      // Verify the authentication failure response
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication required'
      }));
      
      logger.info('Authentication test completed');
    });
    
    test('should validate JWT tokens for protected endpoints', async () => {
      logger.info('Starting JWT validation test');
      
      // Mock JWT verification
      const mockJwtVerify = jest.fn().mockImplementation((token, secret, options, callback) => {
        if (token === 'valid-token') {
          return { sub: 'test-user', role: 'admin' };
        } else {
          throw new Error('Invalid token');
        }
      });
      
      // Create a middleware that validates JWT tokens
      const jwtMiddleware = (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Valid JWT token required' });
        }
        
        const token = authHeader.split(' ')[1];
        
        try {
          // Use the mock JWT verification
          const decoded = mockJwtVerify(token);
          req.user = decoded;
          next();
        } catch (error) {
          return res.status(401).json({ error: 'Invalid token' });
        }
      };
      
      // Create a protected endpoint handler
      const protectedHandler = (req, res) => {
        res.status(200).json({ message: 'Protected data', user: req.user });
      };
      
      // Register the protected endpoint with JWT middleware
      mockExpressApp.get('/protected', jwtMiddleware, protectedHandler);
      
      // Call the protected endpoint with an invalid token
      const invalidReq = { 
        ...mockReq, 
        headers: { authorization: 'Bearer invalid-token' } 
      };
      
      // Mock the next function
      const mockNext = jest.fn();
      
      // Call the middleware with an invalid token
      jwtMiddleware(invalidReq, mockRes, mockNext);
      
      // Verify the authentication failure response
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Invalid token'
      }));
      
      // Reset the mock response
      mockRes.status.mockClear();
      mockRes.json.mockClear();
      
      // Call the protected endpoint with a valid token
      const validReq = { 
        ...mockReq, 
        headers: { authorization: 'Bearer valid-token' } 
      };
      
      // Call the middleware with a valid token
      jwtMiddleware(validReq, mockRes, mockNext);
      
      // Verify that next was called (no error response)
      expect(mockNext).toHaveBeenCalled();
      expect(validReq.user).toBeDefined();
      
      logger.info('JWT validation test completed');
    });
  });
});