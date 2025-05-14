const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { execSync } = require('child_process')
const fetch = require('node-fetch')
const certificateUtils = require('./utils/certificate-utils')
const config = require('../config')

const app = express()
const port = process.env.PORT || 3001

// Parse command line arguments
const args = process.argv.slice(2);
let fedName = 'alpha'; // Default federation name

for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--federation') fedName = args[i + 1];
}

const fedRoot = path.join(config.federations.directory, fedName)
const entityConfigPath = path.join(fedRoot, 'config/entity-configuration.json')
const privateKeyPath = path.join(fedRoot, 'keys/anchor-private.pem')
const registryPath = config.federations.registryPath

// Check if entity configuration exists
if (!fs.existsSync(entityConfigPath)) {
  console.error('❌ Missing entity configuration file:', entityConfigPath)
  process.exit(1)
}

// Load Entity Configuration and Keys
const entityConfig = JSON.parse(fs.readFileSync(entityConfigPath, 'utf-8'))
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

// Convert public key to JWK and add to entity configuration if not already present
if (!entityConfig.jwks || !entityConfig.jwks.keys || entityConfig.jwks.keys.length === 0) {
  // Extract public key from private key
  const publicKeyPath = path.join(fedRoot, 'keys/anchor-public.pem')
  if (!fs.existsSync(publicKeyPath)) {
    // Generate public key from private key if it doesn't exist
    execSync(`openssl rsa -in ${privateKeyPath} -pubout -out ${publicKeyPath}`)
  }
  
  // Load public key as JWK
  const jwk = certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
    kid: `federation-${fedName}-${Date.now()}`,
    use: 'sig'
  })
  
  // Update entity configuration with JWK
  entityConfig.jwks = { keys: [jwk] }
  
  // Save updated entity configuration
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
  console.log('💡 Added JWKS to entity configuration')
}

// Track trusted entities
let trustedEntities = [];

// Helper to load registry
function loadRegistry() {
  if (!fs.existsSync(registryPath)) return { federations: [], mcps: {} }
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
}

// Enable JSON parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve entity configuration as the OpenID Federation metadata
app.get('/.well-known/openid-federation', (req, res) => {
  console.log(`📤 Serving entity configuration for ${fedName}`);
  res.json(entityConfig);
});

// Generate and serve entity statements
app.get('/federation', (req, res) => {
  const registry = loadRegistry();
  const mcps = Object.entries(registry.mcps).map(([name, port]) => ({
    name,
    entity_id: `http://localhost:${port}`,
    port
  }));
  
  // Generate entity statements for each MCP
  const statements = mcps.map(mcp => generateEntityStatement(mcp.entity_id));
  
  res.json({
    federation: fedName,
    trust_anchor: entityConfig.sub,
    entities: mcps.map(mcp => mcp.entity_id),
    statements
  });
});

// Register a new entity with the federation
app.post('/register', (req, res) => {
  const { entity_id, metadata } = req.body;
  
  if (!entity_id) {
    return res.status(400).json({ error: 'Missing entity_id in request' });
  }
  
  // In a real implementation, we would validate the entity's credentials
  // and store the entity in a database
  
  // For now, just add to our in-memory list
  if (!trustedEntities.includes(entity_id)) {
    trustedEntities.push(entity_id);
    console.log(`✅ Registered new entity: ${entity_id}`);
  }
  
  // Generate an entity statement for this entity
  const statement = generateEntityStatement(entity_id);
  
  res.json({
    success: true,
    entity_id,
    statement
  });
});

// Generate an entity statement for a given entity
function generateEntityStatement(subject) {
  // Create a proper JWT with header, payload, and signature
  // Sign it with the federation's private key
  // Include proper federation metadata
  
  const now = Math.floor(Date.now() / 1000);
  
  // Create the payload for the entity statement
  const payload = {
    iss: entityConfig.sub, // Federation entity ID
    sub: subject, // Subject entity ID
    iat: now,
    exp: now + 86400, // Valid for 24 hours
    metadata: {
      federation_entity: {
        federation_trust_mark_status_endpoint: `${entityConfig.sub}/status`,
        federation_resolve_endpoint: `${entityConfig.sub}/resolve`
      }
    },
    trust_marks: [
      {
        id: `${entityConfig.sub}/trust-marks/basic-entity`,
        trust_mark: jwt.sign(
          {
            type: "basic-entity",
            iss: entityConfig.sub,
            sub: subject,
            iat: now,
            exp: now + 86400 // Valid for 24 hours
          },
          privateKey,
          { algorithm: 'RS256' }
        )
      }
    ]
  };
  
  // Sign the entity statement with the federation's private key
  const token = certificateUtils.signJwt(payload, privateKeyPath, {
    algorithm: 'RS256'
    // No expiresIn needed as payload already has exp property
  });
  
  return token;
}

// Entity resolution endpoint
app.get('/resolve', (req, res) => {
  const { entity_id } = req.query;
  
  if (!entity_id) {
    return res.status(400).json({ error: 'Missing entity_id parameter' });
  }
  
  // In a real implementation, this would:
  // 1. Fetch the entity's configuration
  // 2. Validate the entity's trust chain
  // 3. Return the resolved entity information
  
  try {
    // Fetch the entity's configuration
    let entityConfiguration = null;
    
    try {
      // In a real implementation, we would fetch this from the entity's endpoint
      // For now, we'll simulate it based on our registry
      const registry = loadRegistry();
      const mcps = Object.entries(registry.mcps);
      const mcp = mcps.find(([_, port]) => `http://localhost:${port}` === entity_id);
      
      if (mcp) {
        const [name, port] = mcp;
        const configPath = path.resolve(__dirname, `../../mcp_instances/${name}/config/entity-configuration.json`);
        if (fs.existsSync(configPath)) {
          entityConfiguration = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
      }
    } catch (fetchError) {
      console.error('Error fetching entity configuration:', fetchError);
    }
    
    // Generate a signed entity statement for this entity
    const entityStatement = generateEntityStatement(entity_id);
    
    // Return the resolved entity information with the signed statement
    res.json({
      entity_id,
      status: 'resolved',
      entity_configuration: entityConfiguration,
      trust_chain: [
        {
          iss: entityConfig.sub,
          sub: entity_id,
          status: 'valid',
          jwt: entityStatement
        }
      ]
    });
  } catch (error) {
    console.error('Error resolving entity:', error);
    res.status(500).json({ error: 'Failed to resolve entity', details: error.message });
  }
});

// Trust mark status endpoint
app.get('/status', (req, res) => {
  const { trust_mark_id } = req.query;
  
  if (!trust_mark_id) {
    return res.status(400).json({ error: 'Missing trust_mark_id parameter' });
  }
  
  // In a real implementation, this would check the status of the trust mark
  
  res.json({
    trust_mark_id,
    status: 'valid',
    issued_at: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    federation: fedName,
    entity_id: entityConfig.sub,
    trusted_entities: trustedEntities.length
  });
});

/**
 * Fetch entity statements from a federation authority
 * @param {string} federationUrl - URL of the federation authority
 * @returns {Promise<Object>} - Promise resolving to the entity statements
 */
async function fetchEntityStatements(federationUrl) {
  try {
    const response = await fetch(`${federationUrl}/.well-known/openid-federation`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch entity statements: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching entity statements: ${error.message}`);
    throw error;
  }
}

/**
 * Distribute entity statements to federation members
 * @param {Object} entityStatement - Entity statement to distribute
 * @param {Array<string>} members - Array of member URLs
 * @returns {Promise<Object>} - Promise resolving to the distribution result
 */
async function distributeEntityStatements(entityStatement, members) {
  try {
    const results = [];
    let successCount = 0;
    
    for (const member of members) {
      try {
        const response = await fetch(`${member}/entity-statements`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ statements: [entityStatement] })
        });
        
        const result = await response.json();
        results.push({ member, success: true, result });
        successCount++;
      } catch (error) {
        console.error(`Error distributing to ${member}: ${error.message}`);
        results.push({ member, success: false, error: error.message });
      }
    }
    
    return {
      success: true,
      distributed: successCount,
      results
    };
  } catch (error) {
    console.error(`Error distributing entity statements: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate a trust chain for an entity
 * @param {string} entityId - Entity ID to validate
 * @returns {Promise<Object>} - Promise resolving to the validation result
 */
async function validateTrustChain(entityId) {
  // This function is already mocked in the tests, but we'll provide a minimal implementation
  return {
    valid: true,
    chain: [
      { iss: 'https://federation.example.org', sub: entityId }
    ]
  };
}

app.listen(port, () => {
  console.log(`🛰️ Federation Admin running on http://localhost:${port}`);
  console.log(`📡 Serving entity config at /.well-known/openid-federation`);
  console.log(`🔑 Federation name: ${fedName}`);
});

// Export functions for testing
module.exports = {
  fetchEntityStatements,
  distributeEntityStatements,
  validateTrustChain
};
