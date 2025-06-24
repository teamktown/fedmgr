/**
 * Test Data Setup
 * 
 * Creates the necessary federation structure for tests
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Set up environment variables directly
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../../..');
const FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'test-federations');
const ALPHA_FED_DIR = path.join(FEDMGR_FEDERATIONS_DIR, 'alpha');
const ALPHA_CONFIG_DIR = path.join(ALPHA_FED_DIR, 'config');
const ALPHA_KEYS_DIR = path.join(ALPHA_FED_DIR, 'keys');
const ENTITY_CONFIG_PATH = path.join(ALPHA_CONFIG_DIR, 'entity-configuration.json');
const PRIVATE_KEY_PATH = path.join(ALPHA_KEYS_DIR, 'anchor-private.pem');
const PUBLIC_KEY_PATH = path.join(ALPHA_KEYS_DIR, 'anchor-public.pem');

// Create directory structure
function createTestDirectories() {
  console.log(`Creating test federation directory structure in ${FEDMGR_FEDERATIONS_DIR}`);
  fs.mkdirSync(ALPHA_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(ALPHA_KEYS_DIR, { recursive: true });
}

// Generate keypair for federation
function generateKeys() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.log('Generating RSA keypair for test federation');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey);
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
    console.log('Keypair generated');
  } else {
    console.log('Using existing federation keypair');
  }
}

// Create mock entity configuration
function createEntityConfiguration() {
  if (!fs.existsSync(ENTITY_CONFIG_PATH)) {
    console.log('Creating mock entity configuration');
    const entityConfig = {
      sub: 'https://federation.example.org',
      iss: 'https://federation.example.org',
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
          name: 'Test Federation Entity',
          contacts: ['admin@example.org']
        }
      }
    };
    
    fs.writeFileSync(ENTITY_CONFIG_PATH, JSON.stringify(entityConfig, null, 2));
    console.log('Entity configuration created');
  } else {
    console.log('Using existing entity configuration');
  }
}

// Execute setup steps
function setupTestData() {
  console.log(`Setting up test data for federation tests in ${FEDMGR_FEDERATIONS_DIR}`);
  createTestDirectories();
  generateKeys();
  createEntityConfiguration();
  console.log('Test data setup complete');
}

// Run if executed directly
if (require.main === module) {
  setupTestData();
}

module.exports = {
  setupTestData
};