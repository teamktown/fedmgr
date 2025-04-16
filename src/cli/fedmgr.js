#!/usr/bin/env node

const { Command } = require('commander')
const { execSync, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const program = new Command()
let portCounter = 3100 // Starting MCP port

program
  .name('fedmgr')
  .description('CLI to manage federated MCPs and trust environments')
  .version('0.1.0')

program
  .command('create')
  .description('Create resources: federation or MCP instance')
  .argument('<type>', 'resource type: fed or mcp')
  .argument('<name>', 'resource name (e.g., alpha or MCPA)')
  .action((type, name) => {
    if (type === 'fed') {
      bootstrapFederation(name)
    } else if (type === 'mcp') {
      createMcp(name)
    } else {
      console.error(`❌ Unknown type '${type}'`)
    }
  })

program.parse()

function bootstrapFederation(name) {
  const fedPath = path.resolve(__dirname, '../../federations', name)
  const keysPath = path.join(fedPath, 'keys')
  const configPath = path.join(fedPath, 'config')
  const entityConfigFile = path.join(configPath, 'entity-configuration.json')

  if (fs.existsSync(entityConfigFile)) {
    console.log(`⚠️ Federation '${name}' already exists at ${fedPath}`)
    return
  }

  fs.mkdirSync(keysPath, { recursive: true })
  fs.mkdirSync(configPath, { recursive: true })

  execSync(`openssl genrsa -out ${keysPath}/anchor-private.pem 2048`)
  execSync(`openssl rsa -in ${keysPath}/anchor-private.pem -pubout -out ${keysPath}/anchor-public.pem`)

  const now = Math.floor(Date.now() / 1000)
  const entityId = `http://localhost:3001`

  const config = {
    sub: entityId,
    metadata: {
      federation_entity: {
        organization_name: `fedmgr Federation ${name}`,
        contacts: [`admin@${name}.local`],
        federation_fetch_endpoint: `${entityId}/federation`,
        trust_marks: []
      }
    },
    authority_hints: [],
    jwks: { keys: [] },
    iat: now
  }

  fs.writeFileSync(entityConfigFile, JSON.stringify(config, null, 2))
  console.log(`✅ Federation '${name}' initialized at ${fedPath}`)
}

function createMcp(name) {
  const baseDir = path.resolve(__dirname, '../../mcp_instances', name)
  const keysPath = path.join(baseDir, 'keys')
  const configPath = path.join(baseDir, 'config')
  const entityConfigFile = path.join(configPath, 'entity-configuration.json')
  const port = portCounter++

  if (fs.existsSync(baseDir)) {
    console.log(`⚠️ MCP '${name}' already exists at ${baseDir}`)
    return
  }

  fs.mkdirSync(keysPath, { recursive: true })
  fs.mkdirSync(configPath, { recursive: true })

  execSync(`openssl genrsa -out ${keysPath}/mcp-private.pem 2048`)
  execSync(`openssl rsa -in ${keysPath}/mcp-private.pem -pubout -out ${keysPath}/mcp-public.pem`)

  const entityId = `http://localhost:${port}`
  const now = Math.floor(Date.now() / 1000)

  const config = {
    sub: entityId,
    metadata: {
      federation_entity: {
        organization_name: `MCP Instance ${name}`,
        contacts: [`ops@${name}.local`],
        federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
        trust_marks: []
      }
    },
    authority_hints: ["http://localhost:3001"],
    jwks: { keys: [] },
    iat: now
  }

  fs.writeFileSync(entityConfigFile, JSON.stringify(config, null, 2))
  console.log(`✅ MCP '${name}' initialized with config at ${baseDir}`)

  const serverPath = path.resolve(__dirname, '../server/mcp-server.js')
  console.log(`🚀 Starting MCP '${name}' on port ${port}...`)
  spawn('node', [serverPath, '--name', name, '--port', port], {
    stdio: 'inherit',
    env: { ...process.env, NAME: name, PORT: port.toString() }
  })
}
