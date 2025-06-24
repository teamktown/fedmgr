const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { execSync } = require('child_process')
const fetch = require('node-fetch')
const certificateUtils = require('./utils/certificate-utils')
const { createAdminMiddleware, createAuthMiddleware } = require('./utils/admin-middleware')
const { createOAuthHandler } = require('./oauth-handler')
const {
  loadRegistry,
  saveRegistry,
  loadEntityConfig,
  saveEntityConfig,
} = require('../config-manager')
const { createFederationAPI } = require('./federation-api')
const { createUIServer } = require('./ui-server')
const WebSocket = require('ws')
const http = require('http')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 3001

// Create HTTP server for WebSocket support
const server = http.createServer(app)

// Parse command line arguments
const args = process.argv.slice(2)
let fedName = 'alpha'
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--federation') fedName = args[i + 1]
}

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/oauth/callback`
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || crypto.randomBytes(16).toString('hex')

// Use environment-based paths for Docker compatibility
const dataDir = process.env.FEDMGR_FEDERATIONS_DIR || '/usr/src/app/data'
const keysDir = path.join(dataDir, 'keys')
const configDir = path.join(dataDir, 'config')
const entityConfigPath = path.join(configDir, 'entity-configuration.json')
const privateKeyPath = path.join(keysDir, 'anchor-private.pem')
const publicKeyPath = path.join(keysDir, 'anchor-public.pem')
const registryPath = process.env.FEDMGR_FED_REG || path.join(dataDir, 'registry.json')

// Static files directory - use environment variable with fallback
const publicDir = process.env.FEDMGR_PUBLIC_DIR || '/usr/src/app/public'

// Ensure directories exist
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true })
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

// Initialize keys and configuration
if (!fs.existsSync(privateKeyPath)) {
  console.log('🔑 Generating federation keys...')
  execSync(`openssl genrsa -out ${privateKeyPath} 2048`)
  execSync(`openssl rsa -in ${privateKeyPath} -pubout -out ${publicKeyPath}`)
}

// Load or create entity configuration
let entityConfig = loadEntityConfig(entityConfigPath)
if (Object.keys(entityConfig).length === 0) {
  const now = Math.floor(Date.now() / 1000)
  entityConfig = {
    sub: `http://localhost:${port}`,
    metadata: {
      federation_entity: {
        organization_name: `Federation ${fedName}`,
        federation_fetch_endpoint: `http://localhost:${port}/federation_fetch`,
        federation_list_endpoint: `http://localhost:${port}/federation_list`,
        federation_resolve_endpoint: `http://localhost:${port}/resolve`,
        federation_trust_mark_status_endpoint: `http://localhost:${port}/trust-mark-status`
      },
      openid_relying_party: {
        client_registration_types: ["automatic"],
        organization_name: `Federation ${fedName} RP`
      }
    },
    jwks: { keys: [] },
    iat: now,
    exp: now + (365 * 24 * 60 * 60), // 1 year expiration for trust anchor
    authority_hints: [] // This is the trust anchor
  }
  saveEntityConfig(entityConfigPath, entityConfig)
} else {
  // Ensure existing configurations have exp claim for OpenID Federation compliance
  if (!entityConfig.exp) {
    const now = Math.floor(Date.now() / 1000)
    entityConfig.iat = entityConfig.iat || now
    entityConfig.exp = now + (365 * 24 * 60 * 60) // 1 year expiration for trust anchor
    
    // Update federation endpoints to include new required endpoints
    if (entityConfig.metadata && entityConfig.metadata.federation_entity) {
      entityConfig.metadata.federation_entity.federation_fetch_endpoint = 
        entityConfig.metadata.federation_entity.federation_fetch_endpoint || `http://localhost:${port}/federation_fetch`
      entityConfig.metadata.federation_entity.federation_list_endpoint = 
        entityConfig.metadata.federation_entity.federation_list_endpoint || `http://localhost:${port}/federation_list`
    }
    
    saveEntityConfig(entityConfigPath, entityConfig)
    console.log('🔄 Updated entity configuration with exp claim and new endpoints')
  }
}

// Add JWK to entity configuration if not present
if (!entityConfig.jwks || !entityConfig.jwks.keys || entityConfig.jwks.keys.length === 0) {
  const jwk = certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
    kid: `federation-${fedName}-${Date.now()}`,
    use: 'sig',
    alg: 'RS256'
  })
  entityConfig.jwks = { keys: [jwk] }
  saveEntityConfig(entityConfigPath, entityConfig)
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

// Initialize admin and auth middleware
const adminMiddleware = createAdminMiddleware(publicKeyPath)
const authMiddleware = createAuthMiddleware(publicKeyPath)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// UI Server configuration
const uiServer = createUIServer({
  publicDir,
  fedName,
  clientId: GITHUB_CLIENT_ID,
  port
});
uiServer.registerRoutes(app);


// GitHub OAuth handler
const oauthHandler = createOAuthHandler({
  clientId: GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
  redirectUri: OAUTH_REDIRECT_URI,
  stateSecret: OAUTH_STATE_SECRET,
  fedName,
  entityConfig,
  privateKey,
  updateRegistry,
});
oauthHandler.registerRoutes(app);

// Federation API handler
const federationAPI = createFederationAPI({
  fedName,
  entityConfig,
  publicKeyPath,
  publicDir,
  clientId: GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
  adminMiddleware,
  authMiddleware,
});
federationAPI.registerRoutes(app);

// Register Admin API routes and initialize JSON-RPC server
const jsonrpcServer = registerAdminAPIRoutes(app, {
  fedName,
  entityConfig,
  publicKeyPath,
  mcpInstancesDir: process.env.FEDMGR_MCP_INSTANCES_DIR || path.resolve(__dirname, '../../../mcp_instances'),
  federationsDir: process.env.FEDMGR_FEDERATIONS_DIR || dataDir
})

// Set up WebSocket server for real-time updates
const wss = new WebSocket.Server({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('📡 WebSocket client connected')
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    data: {
      server: 'FedMgr Admin Dashboard',
      federation: fedName,
      timestamp: new Date().toISOString()
    }
  }))
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message)
      console.log('📡 WebSocket message received:', data)
      
      // Echo back for now
      ws.send(JSON.stringify({
        type: 'echo',
        data
      }))
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }))
    }
  })
  
  ws.on('close', () => {
    console.log('📡 WebSocket client disconnected')
  })
})

// Registry management
function loadReg() {
  const reg = loadRegistry(registryPath)
  if (!reg.federations || reg.federations.length === 0) reg.federations = [fedName]
  return reg
}

function updateRegistry(updates) {
  const registry = loadReg()
  Object.assign(registry, updates)
  saveRegistry(registryPath, registry)
}

server.listen(port, () => {
  console.log(`🛰️ Federation Admin running on http://localhost:${port}`)
  console.log(`🔑 Federation: ${fedName}`)
  console.log(`🔗 GitHub OAuth: ${GITHUB_CLIENT_ID ? 'Enabled' : 'Disabled'}`)
  console.log(`📡 Entity config: /.well-known/openid-federation`)
  console.log(`🔐 OIDCFed Trust Anchor: ${entityConfig.sub}`)
  console.log(`📁 Public directory: ${publicDir}`)
  console.log(`🌐 WebSocket server: ws://localhost:${port}/ws`)
  console.log(`🔗 Admin API: http://localhost:${port}/api/v1`)
  console.log(`📡 JSON-RPC: http://localhost:${port}/api/v1/jsonrpc`)
})

module.exports = app
