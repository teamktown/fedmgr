const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const port = process.env.PORT || 3001
const fedName = process.argv[3] || 'alpha'

const fedRoot = path.join(__dirname, '../../federations', fedName)
const entityConfigPath = path.join(fedRoot, 'config/entity-configuration.json')
const privateKeyPath = path.join(fedRoot, 'keys/anchor-private.pem')

if (!fs.existsSync(entityConfigPath)) {
  console.error('❌ Missing entity configuration file:', entityConfigPath)
  process.exit(1)
}

// Load Entity Configuration and Keys
const entityConfig = JSON.parse(fs.readFileSync(entityConfigPath, 'utf-8'))
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

// Serve entity configuration as the OpenID Federation metadata
app.get('/.well-known/openid-federation', (req, res) => {
  res.json(entityConfig)
})

// Placeholder: List entities this anchor trusts (to be expanded)
app.get('/federation', (req, res) => {
  res.json({
    entities: [],
    note: 'Entity trust chain resolution not implemented yet'
  })
})

app.listen(port, () => {
  console.log(`🛰️ Federation Admin MCP running on http://localhost:${port}`)
  console.log(`📡 Serving entity config at /.well-known/openid-federation`)
})
