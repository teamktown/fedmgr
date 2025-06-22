const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { execSync } = require('child_process')
const fetch = require('node-fetch')
const certificateUtils = require('./utils/certificate-utils')
const {
  loadRegistry,
  saveRegistry,
  loadEntityConfig,
  saveEntityConfig,
} = require('../config-manager')
const registerOAuthRoutes = require('./oauth-routes')
const registerFederationRoutes = require('./federation-routes')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 3001

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
  entityConfig = {
    sub: `http://localhost:${port}`,
    metadata: {
      federation_entity: {
        organization_name: `Federation ${fedName}`,
        federation_fetch_endpoint: `http://localhost:${port}/.well-known/openid-federation`,
        federation_resolve_endpoint: `http://localhost:${port}/resolve`,
        federation_trust_mark_status_endpoint: `http://localhost:${port}/trust-mark-status`
      },
      openid_relying_party: {
        client_registration_types: ["automatic"],
        organization_name: `Federation ${fedName} RP`
      }
    },
    jwks: { keys: [] },
    iat: Math.floor(Date.now() / 1000),
    authority_hints: [] // This is the trust anchor
  }
  saveEntityConfig(entityConfigPath, entityConfig)
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

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serve static files from the configured public directory
console.log(`📁 Serving static files from: ${publicDir}`)
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  console.log(`✅ Static files directory found and configured`)
} else {
  console.log(`⚠️ Static files directory not found: ${publicDir}`)
}

// Root route with better path handling
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html')
  
  console.log(`🔍 Looking for index.html at: ${indexPath}`)
  
  if (fs.existsSync(indexPath)) {
    console.log(`✅ Found index.html, serving file`)
    res.sendFile(indexPath)
  } else {
    console.log(`❌ index.html not found, serving fallback HTML`)
    // Enhanced fallback HTML with JWT decoder
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Federation Demo - Fallback</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f8f9fa; }
          .container { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
          button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
          button:hover { background: #005a8b; }
          .token { background: #e8f4f8; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; }
          .success { color: #28a745; }
          .error { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="warning">
          <strong>⚠️ Notice:</strong> Using fallback HTML. The main index.html file was not found at: <code>${indexPath}</code>
        </div>
        
        <h1>🛰️ Federation Demo (Fallback)</h1>
        
        <div class="container">
          <h2>Authentication</h2>
          <p><strong>Status:</strong> Federation "${fedName}" is active</p>
          <p><strong>OAuth:</strong> ${GITHUB_CLIENT_ID ? 'Enabled' : 'Disabled'}</p>
          <button onclick="window.location.href='/login'">Login with GitHub</button>
          <div id="auth-info" style="margin-top: 15px;"></div>
        </div>
        
        <div class="container">
          <h2>API Endpoints</h2>
          <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/.well-known/openid-federation">Federation Metadata</a></li>
          </ul>
          <button onclick="testMcp()">Test MCP Server</button>
          <div id="test-results"></div>
        </div>

        <script>
          // Check for token in URL
          const urlParams = new URLSearchParams(window.location.search);
          const token = urlParams.get('token');
          const user = urlParams.get('user');
          
          if (token && user) {
            document.getElementById('auth-info').innerHTML = 
              '<div class="success">✅ Authenticated as: ' + user + '</div>' +
              '<div class="token">Token: ' + token.substring(0, 50) + '...</div>';
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          
          async function testMcp() {
            if (!token) {
              alert('Please login first');
              return;
            }
            
            try {
              const response = await fetch('http://localhost:4001/api', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const data = await response.json();
              document.getElementById('test-results').innerHTML = 
                '<h3 class="success">✅ MCP Test Result:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } catch (error) {
              document.getElementById('test-results').innerHTML = 
                '<h3 class="error">❌ MCP Test Failed:</h3><p>' + error.message + '</p>';
            }
          }
        </script>
      </body>
      </html>
    `)
  }
})

// GitHub OAuth and federation API routes
registerOAuthRoutes(app, {
  clientId: GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
  redirectUri: OAUTH_REDIRECT_URI,
  stateSecret: OAUTH_STATE_SECRET,
  fedName,
  entityConfig,
  privateKey,
  updateRegistry,
})

registerFederationRoutes(app, {
  fedName,
  entityConfig,
  publicKeyPath,
  publicDir,
  clientId: GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
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

app.listen(port, () => {
  console.log(`🛰️ Federation Admin running on http://localhost:${port}`)
  console.log(`🔑 Federation: ${fedName}`)
  console.log(`🔗 GitHub OAuth: ${GITHUB_CLIENT_ID ? 'Enabled' : 'Disabled'}`)
  console.log(`📡 Entity config: /.well-known/openid-federation`)
  console.log(`🔐 OIDCFed Trust Anchor: ${entityConfig.sub}`)
  console.log(`📁 Public directory: ${publicDir}`)
})

module.exports = app
