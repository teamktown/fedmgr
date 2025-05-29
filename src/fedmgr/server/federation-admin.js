
const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { execSync } = require('child_process')
const fetch = require('node-fetch')
const certificateUtils = require('./utils/certificate-utils')
const config = require('../config')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 3001

// Parse command line arguments
const args = process.argv.slice(2)
let fedName = 'alpha'
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--federation') fedName = args[i + 1]
}

// OIDC OAuth configuration (GitHub App)
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/oauth/callback`
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || crypto.randomBytes(16).toString('hex')

// Use FEDMGR_FEDERATIONS_DIR env var or default to /usr/src/app/federations
const federationsDir = process.env.FEDMGR_FEDERATIONS_DIR || '/usr/src/app/federations'
const fedRoot = path.join(federationsDir, fedName)
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
  const publicKeyPath = path.join(fedRoot, 'keys/anchor-public.pem')
  if (!fs.existsSync(publicKeyPath)) {
    execSync(`openssl rsa -in ${privateKeyPath} -pubout -out ${publicKeyPath}`)
  }
  const jwk = certificateUtils.loadPublicKeyAsJwk(publicKeyPath, {
    kid: `federation-${fedName}-${Date.now()}`,
    use: 'sig'
  })
  entityConfig.jwks = { keys: [jwk] }
  fs.writeFileSync(entityConfigPath, JSON.stringify(entityConfig, null, 2))
  console.log('💡 Added JWKS to entity configuration')
}

// Enable JSON parsing middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// -------------------------------------------
// New OAuth endpoints for GitHub login
// -------------------------------------------

// Start OAuth flow
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

// OAuth callback
app.get('/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code
    const stateToken = req.query.state
    const verified = jwt.verify(stateToken, OAUTH_STATE_SECRET)
    if (!verified || verified.fed !== fedName) throw new Error('Invalid state')

    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
        state: stateToken
      })
    })
    const tokenJson = await tokenRes.json()
    if (!tokenJson.access_token) throw new Error(tokenJson.error_description || 'Token exchange failed')

    // Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'User-Agent': 'fedmgr' }
    })
    const user = await userRes.json()

    // Mint federation JWT
    const now = Math.floor(Date.now() / 1000)
    const idToken = jwt.sign({
      iss: entityConfig.sub,
      sub: user.id.toString(),
      login: user.login,
      iat: now,
      exp: now + 3600
    }, privateKey, { algorithm: 'RS256' })

    // Redirect back to UI with token in hash
    res.redirect(`/index.html#token=${encodeURIComponent(idToken)}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    res.status(500).send('Authentication failed')
  }
})

// -------------------------------------------
// Existing federation admin endpoints
// -------------------------------------------

// Serve federation metadata
app.get('/.well-known/openid-federation', (req, res) => {
  console.log(`📤 Serving entity configuration for ${fedName}`)
  res.json(entityConfig)
})

// Federation overview (entity statements for all MCPs)
app.get('/federation', (req, res) => {
  const registry = JSON.parse(fs.existsSync(registryPath) ? fs.readFileSync(registryPath) : '{"federations":[],"mcps":{}}')
  const mcps = Object.entries(registry.mcps).map(([name, port]) => ({ name, entity_id: `http://localhost:${port}`, port }))
  const statements = mcps.map(mcp => generateEntityStatement(mcp.entity_id))
  res.json({ federation: fedName, trust_anchor: entityConfig.sub, entities: mcps.map(m => m.entity_id), statements })
})

// Register new MCP or entity
app.post('/register', (req, res) => {
  const { entity_id } = req.body
  if (!entity_id) return res.status(400).json({ error: 'Missing entity_id' })
  if (!trustedEntities.includes(entity_id)) trustedEntities.push(entity_id)
  console.log(`✅ Registered new entity: ${entity_id}`)
  const statement = generateEntityStatement(entity_id)
  res.json({ success: true, entity_id, statement })
})

// Generate an entity statement
function generateEntityStatement(subject) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: entityConfig.sub,
    sub: subject,
    iat: now,
    exp: now + 86400,
    metadata: {
      federation_entity: { federation_trust_mark_status_endpoint: `${entityConfig.sub}/status`, federation_resolve_endpoint: `${entityConfig.sub}/resolve` }
    },
    trust_marks: [ { id: `${entityConfig.sub}/trust-marks/basic-entity`, trust_mark: jwt.sign({ type: 'basic-entity', iss: entityConfig.sub, sub: subject, iat: now, exp: now + 86400 }, privateKey, { algorithm: 'RS256' }) } ]
  }
  return certificateUtils.signJwt(payload, privateKeyPath, { algorithm: 'RS256' })
}

// Resolve entity and trust chain
app.get('/resolve', (req, res) => {
  const { entity_id } = req.query
  if (!entity_id) return res.status(400).json({ error: 'Missing entity_id' })
  let entityConfiguration = null
  try {
    const registry = JSON.parse(fs.existsSync(registryPath) ? fs.readFileSync(registryPath) : '{"federations":[],"mcps":{}}')
    const found = Object.entries(registry.mcps).find(([name, port]) => `http://localhost:${port}` === entity_id)
    if (found) {
      const [name] = found
      const configPath = path.resolve(__dirname, `../../mcp_instances/${name}/config/entity-configuration.json`)
      if (fs.existsSync(configPath)) entityConfiguration = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (e) {
    console.error('Error fetching entity configuration:', e)
  }
  const jwt = generateEntityStatement(entity_id)
  res.json({ entity_id, status: 'resolved', entity_configuration: entityConfiguration, trust_chain: [ { iss: entityConfig.sub, sub: entity_id, status: 'valid', jwt } ] })
})

// Trust mark status
app.get('/status', (req, res) => {
  const { trust_mark_id } = req.query
  if (!trust_mark_id) return res.status(400).json({ error: 'Missing trust_mark_id' })
  res.json({ trust_mark_id, status: 'valid', issued_at: new Date().toISOString() })
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', federation: fedName, entity_id: entityConfig.sub, trusted_entities: trustedEntities.length })
})

// Helper: fetch entity statements (unused ICU)
async function fetchEntityStatements(federationUrl) {
  const response = await fetch(`${federationUrl}/.well-known/openid-federation`)
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
  return await response.json()
}

// Helper: distribute entity statements
async function distributeEntityStatements(entityStatement, members) {
  const results = []
  let successCount = 0
  for (const member of members) {
    try {
      const resp = await fetch(`${member}/entity-statements`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ statements: [entityStatement] }) })
      const json = await resp.json()
      results.push({ member, success: true, result: json })
      successCount++
    } catch (e) {
      results.push({ member, success: false, error: e.message })
    }
  }
  return { success:true, distributed: successCount, results }
}

// Helper: validate trust chain (stub)
async function validateTrustChain(entityId) {
  return { valid: true, chain: [ { iss: entityConfig.sub, sub: entityId } ] }
}

app.listen(port, () => {
  console.log(`🛰️ Federation Admin running on http://localhost:${port}`)
  console.log(`📡 Serving entity config at /.well-known/openid-federation`)
  console.log(`🔑 Federation name: ${fedName}`)
})

// Export for tests
module.exports = { fetchEntityStatements, distributeEntityStatements, validateTrustChain }

