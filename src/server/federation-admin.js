const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
const port = process.env.PORT || 3001

// Parse command line arguments
const args = process.argv.slice(2);
let fedName = 'alpha'; // Default federation name

for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--federation') fedName = args[i + 1];
}

const fedRoot = path.join(__dirname, '../../federations', fedName)
const entityConfigPath = path.join(fedRoot, 'config/entity-configuration.json')
const privateKeyPath = path.join(fedRoot, 'keys/anchor-private.pem')
const registryPath = path.resolve(__dirname, '../../data/registry.json')

// Check if entity configuration exists
if (!fs.existsSync(entityConfigPath)) {
  console.error('❌ Missing entity configuration file:', entityConfigPath)
  process.exit(1)
}

// Load Entity Configuration and Keys
const entityConfig = JSON.parse(fs.readFileSync(entityConfigPath, 'utf-8'))
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

// Track trusted entities
let trustedEntities = [];

// Helper to load registry
function loadRegistry() {
  if (!fs.existsSync(registryPath)) return { federations: [], mcps: {} }
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
}

// Enable JSON parsing middleware
app.use(express.json());

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
  // In a real implementation, this would:
  // 1. Create a proper JWT with header, payload, and signature
  // 2. Sign it with the federation's private key
  // 3. Include proper federation metadata
  
  const now = Math.floor(Date.now() / 1000);
  
  // Create a simulated entity statement
  const statement = {
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
        trust_mark: "simulated_trust_mark_jwt_would_go_here"
      }
    ],
    // In a real implementation, this would be a proper JWT signature
    signature: "simulated_signature_" + crypto.randomBytes(8).toString('hex')
  };
  
  return statement;
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
  
  res.json({
    entity_id,
    status: 'resolved',
    trust_chain: [
      {
        iss: entityConfig.sub,
        sub: entity_id,
        status: 'valid'
      }
    ]
  });
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

app.listen(port, () => {
  console.log(`🛰️ Federation Admin running on http://localhost:${port}`);
  console.log(`📡 Serving entity config at /.well-known/openid-federation`);
  console.log(`🔑 Federation name: ${fedName}`);
});
