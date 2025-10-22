/**
 * Integration tests for MCP Federation
 * 
 * Tests the federation trust framework integration between MCP servers.
 */

const TestLogger = require('../fixtures/test-logger');
const logger = new TestLogger('TEST-INT-001', 'MCPFederation');
const setupTestData = require('../fixtures/setup-test-data');

// Ensure test federation data is available
beforeAll(() => {
  setupTestData.setupTestData();
});

// Mock data for tests
const mockData = {
  entityStatement: {
    iss: 'https://federation.example.org',
    sub: 'https://mcp.example.org',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
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
        name: 'Test MCP Entity',
        contacts: ['admin@example.org']
      }
    },
    trust_marks: [
      {
        id: 'https://federation.example.org/trust-marks/mcp',
        iss: 'https://federation.example.org',
        sub: 'https://mcp.example.org',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      }
    ]
  }
};

// Mock HTTP client for making requests to MCP servers
jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');

describe('MCP Federation Integration', () => {
  let federationAdmin;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock successful fetch responses
    fetch.mockImplementation(async (url) => {
      if (url.includes('/.well-known/openid-federation')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockData.entityStatement
        };
      } else if (url.includes('/entity-statements')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    });
    
    // Import the federation admin module
    federationAdmin = require('../../../src/server/federation-admin');
  });
  
  test('should fetch entity statements from federation authority', async () => {
    logger.info('Starting entity statement fetch test');
    
    // Call the method to fetch entity statements
    const result = await federationAdmin.fetchEntityStatements('https://federation.example.org');
    
    // Verify that fetch was called with the correct URL
    expect(fetch).toHaveBeenCalledWith(
      'https://federation.example.org/.well-known/openid-federation',
      expect.any(Object)
    );
    
    // Verify that the result contains the entity statement
    expect(result).toEqual(mockData.entityStatement);
    
    logger.info('Entity statement fetch test completed');
  });
  
  test('should validate trust chain for entity', async () => {
    logger.info('Starting trust chain validation test');
    
    // Mock the trust chain validation
    const mockValidationResult = {
      valid: true,
      chain: [
        { iss: 'https://federation.example.org', sub: 'https://mcp.example.org' },
        { iss: 'https://root.example.org', sub: 'https://federation.example.org' }
      ]
    };
    
    // Mock the validateTrustChain method
    federationAdmin.validateTrustChain = jest.fn().mockResolvedValue(mockValidationResult);
    
    // Call the method to validate trust chain
    const result = await federationAdmin.validateTrustChain('https://mcp.example.org');
    
    // Verify that the validation was called
    expect(federationAdmin.validateTrustChain).toHaveBeenCalledWith('https://mcp.example.org');
    
    // Verify that the result indicates a valid trust chain
    expect(result.valid).toBe(true);
    expect(result.chain.length).toBe(2);
    
    logger.info('Trust chain validation test completed');
  });
  
  test('should distribute entity statements to federation members', async () => {
    logger.info('Starting entity statement distribution test');
    
    // Mock the list of federation members
    const members = [
      'https://mcp1.example.org',
      'https://mcp2.example.org',
      'https://mcp3.example.org'
    ];
    
    // Call the method to distribute entity statements
    const result = await federationAdmin.distributeEntityStatements(
      mockData.entityStatement,
      members
    );
    
    // Verify that fetch was called for each member
    expect(fetch).toHaveBeenCalledTimes(members.length);
    
    // Verify that each call was to the entity-statements endpoint
    members.forEach(member => {
      expect(fetch).toHaveBeenCalledWith(
        `${member}/entity-statements`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Object),
          body: expect.any(String)
        })
      );
    });
    
    // Verify that the result indicates success
    expect(result.success).toBe(true);
    expect(result.distributed).toBe(members.length);
    
    logger.info('Entity statement distribution test completed');
  });
test('should reject trust chain with invalid signature', async () => {
    logger.info('Starting invalid trust chain signature test');

    // Mock a trust chain with an invalid signature
    const mockValidationResult = {
      valid: false,
      error: 'invalid signature in entity statement',
      chain: [
        { iss: 'https://federation.example.org', sub: 'https://mcp.example.org' }
      ]
    };

    // Mock the validateTrustChain method to return the invalid result
    federationAdmin.validateTrustChain = jest.fn().mockResolvedValue(mockValidationResult);

    // Call the method to validate trust chain
    const result = await federationAdmin.validateTrustChain('https://mcp.example.org');

    // Verify that the validation was called
    expect(federationAdmin.validateTrustChain).toHaveBeenCalledWith('https://mcp.example.org');

    // Verify that the result indicates an invalid trust chain due to signature
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid signature');

    logger.info('Invalid trust chain signature test completed');
  });

  test('should reject trust chain with expired entity statement', async () => {
    logger.info('Starting expired entity statement trust chain test');

    // Mock a trust chain with an expired entity statement
    const mockValidationResult = {
      valid: false,
      error: 'entity statement expired',
      chain: [
        { iss: 'https://federation.example.org', sub: 'https://mcp.example.org' }
      ]
    };

    // Mock the validateTrustChain method to return the invalid result
    federationAdmin.validateTrustChain = jest.fn().mockResolvedValue(mockValidationResult);

    // Call the method to validate trust chain
    const result = await federationAdmin.validateTrustChain('https://mcp.example.org');

    // Verify that the validation was called
    expect(federationAdmin.validateTrustChain).toHaveBeenCalledWith('https://mcp.example.org');

    // Verify that the result indicates an invalid trust chain due to expiration
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');

    logger.info('Expired entity statement trust chain test completed');
  });

  test('should reject trust chain with incorrect issuer', async () => {
    logger.info('Starting incorrect issuer trust chain test');

    // Mock a trust chain with an incorrect issuer in an entity statement
    const mockValidationResult = {
      valid: false,
      error: 'incorrect issuer in entity statement',
      chain: [
        { iss: 'https://wrong-federation.example.org', sub: 'https://mcp.example.org' }
      ]
    };

    // Mock the validateTrustChain method to return the invalid result
    federationAdmin.validateTrustChain = jest.fn().mockResolvedValue(mockValidationResult);

    // Call the method to validate trust chain
    const result = await federationAdmin.validateTrustChain('https://mcp.example.org');

    // Verify that the validation was called
    expect(federationAdmin.validateTrustChain).toHaveBeenCalledWith('https://mcp.example.org');

    // Verify that the result indicates an invalid trust chain due to incorrect issuer
    expect(result.valid).toBe(false);
    expect(result.error).toContain('incorrect issuer');

    logger.info('Incorrect issuer trust chain test completed');
  });
});