/**
 * Test Setup
 * 
 * This file contains setup code that runs before tests.
 */

// Set up global test environment
process.env.NODE_ENV = 'test';

// Mock data for tests
global.mockData = {
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
  },
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

// Set up test environment variables
process.env.TEST_MODE = 'true';

// Create test directories if needed
const fs = require('fs');
const path = require('path');

const testDirs = [
  'test-results',
  'test-coverage'
];

testDirs.forEach(dir => {
  const dirPath = path.join(__dirname, '../../../', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Export a function to suppress console output during tests
const suppressConsoleOutput = () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
};

// Export a function to restore console output
const restoreConsoleOutput = () => {
  jest.restoreAllMocks();
};

// Export setup functions
module.exports = {
  suppressConsoleOutput,
  restoreConsoleOutput
};