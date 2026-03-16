/**
 * Test Setup
 * 
 * This file contains setup code that runs before tests.
 */

// Set up global test environment
process.env.NODE_ENV = 'test';

// Set up federation environment variables for tests
const path = require('path');
const fs = require('fs');
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../../..');
process.env.FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'test-federations');
process.env.FEDMGR_FED_REG = process.env.FEDMGR_FED_REG || path.join(FEDMGR_HOME, 'test-data', 'fed-reg');
// FEDMGR_FED_REG_FILE is the full path to the registry JSON file
process.env.FEDMGR_FED_REG_FILE = process.env.FEDMGR_FED_REG_FILE || path.join(process.env.FEDMGR_FED_REG, 'registry.json');

// Create federation directories if they don't exist
if (!fs.existsSync(process.env.FEDMGR_FEDERATIONS_DIR)) {
  fs.mkdirSync(process.env.FEDMGR_FEDERATIONS_DIR, { recursive: true });
  console.log(`Created federation directory: ${process.env.FEDMGR_FEDERATIONS_DIR}`);
}

const fedRegDir = path.dirname(process.env.FEDMGR_FED_REG);
if (!fs.existsSync(fedRegDir)) {
  fs.mkdirSync(fedRegDir, { recursive: true });
  console.log(`Created federation registry directory: ${fedRegDir}`);
}

// Create an empty registry file if it doesn't exist
if (!fs.existsSync(process.env.FEDMGR_FED_REG)) {
  const registryPath = path.join(process.env.FEDMGR_FED_REG, 'registry.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ federations: [] }));
  console.log(`Created empty registry file: ${registryPath}`);
}

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
// fs was already required above, no need to require it again

const testDirs = [
  'test-results',
  'test-coverage',
  process.env.FEDMGR_FEDERATIONS_DIR,
  path.dirname(process.env.FEDMGR_FED_REG)
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