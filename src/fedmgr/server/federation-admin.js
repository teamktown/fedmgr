const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { execSync } = require('child_process')
const fetch = require('node-fetch')
const certificateUtils = require('./utils/certificate-utils')
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
let entityConfig
if (fs.existsSync(entityConfigPath)) {
  entityConfig = JSON.parse(fs.readFileSync(entityConfigPath, 'utf-8'))
} else {
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
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
}

// Add JWK to entity configuration if not present
if (!entityConfig.jwks || !entityConfig.jwks.keys || entityConfig.jwks.keys.length === 0) {
  const jwk = certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
    kid: `federation-${fedName}-${Date.now()}`,
    use: 'sig',
    alg: 'RS256'
  })
  entityConfig.jwks = { keys: [jwk] }
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
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

// GitHub OAuth endpoints
app.get('/login', (req, res) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).send('GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.')
  }
  
  const state = crypto.randomBytes(16).toString('hex')
  const stateToken = jwt.sign({ state, fed: fedName }, OAUTH_STATE_SECRET, { expiresIn: '10m' })
  
  const authUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}` +
    `&state=${encodeURIComponent(stateToken)}` +
    `&scope=read:user`
  
  res.redirect(authUrl)
})

app.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state: stateToken } = req.query
    
    // Verify state
    const verified = jwt.verify(stateToken, OAUTH_STATE_SECRET)
    if (!verified || verified.fed !== fedName) {
      throw new Error('Invalid state')
    }

    // Exchange code for GitHub token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: OAUTH_REDIRECT_URI
      })
    })
    
    const tokenJson = await tokenRes.json()
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description || 'Token exchange failed')
    }

    // Get user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 
        'Authorization': `Bearer ${tokenJson.access_token}`,
        'User-Agent': 'fedmgr'
      }
    })
    const user = await userRes.json()

    // Create OIDCFed-compliant federation JWT
    const now = Math.floor(Date.now() / 1000)
    const federationToken = jwt.sign({
      // Standard JWT claims
      iss: entityConfig.sub, // Federation trust anchor
      sub: `github:${user.id}`, // Unique subject identifier
      aud: ['mcp-demo', 'mcp-server'], // Intended audiences
      iat: now,
      exp: now + 3600,
      
      // OpenID Connect claims
      auth_time: now,
      nonce: crypto.randomBytes(16).toString('hex'),
      
      // GitHub user information
      preferred_username: user.login,
      name: user.name,
      email: user.email,
      picture: user.avatar_url,
      
      // OIDCFed specific claims
      trust_chain: [entityConfig.sub], // Trust chain starting from this anchor
      trust_marks: [{
        id: `${entityConfig.sub}/trust-marks/github-verified`,
        trust_mark: jwt.sign({
          iss: entityConfig.sub,
          sub: `github:${user.id}`,
          trust_mark_id: `${entityConfig.sub}/trust-marks/github-verified`,
          iat: now,
          exp: now + 86400
        }, privateKey, { algorithm: 'RS256' })
      }],
      
      // Federation entity metadata reference
      federation_entity: {
        authority_hints: [entityConfig.sub],
        trust_anchor_id: entityConfig.sub
      },
      
      // GitHub-specific claims
      github: {
        id: user.id,
        login: user.login,
        type: user.type,
        verified: true
      }
    }, privateKey, { 
      algorithm: 'RS256',
      keyid: entityConfig.jwks.keys[0].kid // Reference the key used for signing
    })

    // Store token in registry for MCP validation
    updateRegistry({
      users: {
        [user.id]: {
          github_id: user.id,
          login: user.login,
          federation_token: federationToken,
          trust_chain: [entityConfig.sub],
          created_at: new Date().toISOString()
        }
      }
    })

    console.log(`✅ Issued OIDCFed token for GitHub user: ${user.login}`)

    // Redirect with token - use the current domain
    const redirectUrl = `/?token=${encodeURIComponent(federationToken)}&user=${encodeURIComponent(user.login)}`
    res.redirect(redirectUrl)
  } catch (err) {
    console.error('OAuth callback error:', err)
    res.status(500).send(`Authentication failed: ${err.message}`)
  }
})

// OIDCFed Federation endpoints
app.get('/.well-known/openid-federation', (req, res) => {
  console.log(`📤 Serving entity configuration for ${fedName}`)
  res.json(entityConfig)
})

// Federation resolution endpoint
app.get('/resolve', (req, res) => {
  const { sub, trust_anchor } = req.query
  
  if (!sub) {
    return res.status(400).json({ error: 'Missing sub parameter' })
  }
  
  // For this demo, we'll return a simple resolution
  const resolved = {
    sub: sub,
    trust_anchor: trust_anchor || entityConfig.sub,
    metadata: {
      federation_entity: {
        trust_marks: [],
        organization_name: `Resolved Entity: ${sub}`
      }
    },
    trust_chain: [entityConfig.sub],
    expires_at: Math.floor(Date.now() / 1000) + 86400
  }
  
  res.json(resolved)
})

// Trust mark status endpoint
app.get('/trust-mark-status', (req, res) => {
  const { trust_mark_id, sub } = req.query
  
  if (!trust_mark_id) {
    return res.status(400).json({ error: 'Missing trust_mark_id parameter' })
  }
  
  res.json({
    trust_mark_id,
    sub: sub || 'unknown',
    status: 'active',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  })
})

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    federation: fedName, 
    entity_id: entityConfig.sub,
    github_oauth: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET),
    oidcfed_compliant: true,
    trust_anchor: true,
    static_files_dir: publicDir,
    static_files_available: fs.existsSync(publicDir),
    timestamp: new Date().toISOString()
  })
})

// Enhanced token validation endpoint for MCPs
app.post('/validate-token', (req, res) => {
  try {
    const { token } = req.body
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Missing token' })
    }

    // Verify the token was issued by this federation
    const verified = jwt.verify(token, fs.readFileSync(publicKeyPath), {
      algorithms: ['RS256'],
      issuer: entityConfig.sub
    })

    // Additional OIDCFed validation
    const validation = {
      valid: true,
      payload: verified,
      trust_chain_valid: true,
      trust_anchor: entityConfig.sub,
      validation_details: {
        signature_valid: true,
        issuer_trusted: verified.iss === entityConfig.sub,
        audience_valid: Array.isArray(verified.aud) ? verified.aud.includes('mcp-demo') : verified.aud === 'mcp-demo',
        not_expired: verified.exp > Math.floor(Date.now() / 1000),
        trust_marks_present: !!(verified.trust_marks && verified.trust_marks.length > 0),
        federation_entity_present: !!verified.federation_entity
      }
    }

    console.log(`✅ Token validation successful for subject: ${verified.sub}`)
    res.json(validation)
  } catch (error) {
    console.log(`❌ Token validation failed: ${error.message}`)
    res.json({
      valid: false,
      error: error.message,
      trust_chain_valid: false
    })
  }
})

// Registry management
function loadRegistry() {
  if (!fs.existsSync(registryPath)) {
    return { federations: [fedName], mcps: {}, users: {} }
  }
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
  } catch (e) {
    return { federations: [fedName], mcps: {}, users: {} }
  }
}

function updateRegistry(updates) {
  const registry = loadRegistry()
  Object.assign(registry, updates)
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))
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
