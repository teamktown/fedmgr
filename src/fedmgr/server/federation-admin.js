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
        federation_fetch_endpoint: `http://localhost:${port}/.well-known/openid-federation`
      }
    },
    jwks: { keys: [] },
    iat: Math.floor(Date.now() / 1000)
  }
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
}

// Add JWK to entity configuration if not present
if (!entityConfig.jwks || !entityConfig.jwks.keys || entityConfig.jwks.keys.length === 0) {
  const jwk = certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
    kid: `federation-${fedName}-${Date.now()}`,
    use: 'sig'
  })
  entityConfig.jwks = { keys: [jwk] }
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serve static files for the UI
app.use(express.static(path.join(__dirname, '../../../public')))

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

    // Create federation JWT with OIDCFed claims
    const now = Math.floor(Date.now() / 1000)
    const federationToken = jwt.sign({
      iss: entityConfig.sub,
      sub: user.id.toString(),
      aud: 'mcp-demo',
      login: user.login,
      name: user.name,
      email: user.email,
      iat: now,
      exp: now + 3600,
      // OIDCFed specific claims
      federation_entity: {
        trust_chain: [entityConfig.sub],
        authority_hints: [entityConfig.sub]
      },
      github_user: {
        id: user.id,
        login: user.login,
        avatar_url: user.avatar_url
      }
    }, privateKey, { algorithm: 'RS256' })

    // Store token in registry for MCP validation
    updateRegistry({
      users: {
        [user.id]: {
          github_id: user.id,
          login: user.login,
          federation_token: federationToken,
          created_at: new Date().toISOString()
        }
      }
    })

    // Redirect with token
    res.redirect(`/index.html#token=${encodeURIComponent(federationToken)}&user=${encodeURIComponent(user.login)}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    res.status(500).send('Authentication failed')
  }
})

// Federation endpoints
app.get('/.well-known/openid-federation', (req, res) => {
  console.log(`📤 Serving entity configuration for ${fedName}`)
  res.json(entityConfig)
})

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    federation: fedName, 
    entity_id: entityConfig.sub,
    github_oauth: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)
  })
})

// Token validation endpoint for MCPs
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

    res.json({
      valid: true,
      payload: verified,
      trust_chain_valid: true
    })
  } catch (error) {
    res.json({
      valid: false,
      error: error.message
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
})

module.exports = app
