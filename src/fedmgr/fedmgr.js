#!/usr/bin/env node

const { Command } = require('commander')
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const MCPInterface = require('./server/mcp-interface')
const { registerAuthCommands, getToken } = require('./auth-commands')

const program = new Command()

// Environment and paths
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../..')
const FEDMGR_FED_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations')
const REGISTRY_PATH = process.env.FEDMGR_FED_REG || path.join(FEDMGR_HOME, 'data', 'fed-reg', 'registry.json')

// Ensure directories
if (!fs.existsSync(FEDMGR_FED_DIR)) fs.mkdirSync(FEDMGR_FED_DIR, { recursive: true })
const mcpInterface = new MCPInterface(REGISTRY_PATH)

// Helpers
function loadRegistry() {
  try {
    return mcpInterface.loadRegistry()
  } catch (e) {
    console.error('❌ Failed to load registry:', e.message)
    process.exit(1)
  }
}

function saveRegistry(reg) {
  try {
    mcpInterface.registry = reg
    mcpInterface.saveRegistry()
  } catch (e) {
    console.error('❌ Failed to save registry:', e.message)
    process.exit(1)
  }
}

// Commands
program.name('fedmgr').description('Manage federated MCPs & trust environments').version('0.3.0')

program
  .command('create <type> <name>')
  .option('--federation <fed>', 'Federation name')
  .description('Create resources: fed, op, mcp, mcp-protocol')
  .action((type, name, opts) => {
    switch(type) {
      case 'fed': {
        const fedPath = path.join(FEDMGR_FED_DIR, name)
        if (fs.existsSync(path.join(fedPath, 'config', 'entity-configuration.json'))) {
          console.log(`⚠️ Federation '${name}' exists`) ; return
        }
        try {
          fs.mkdirSync(path.join(fedPath, 'keys'), { recursive: true })
          fs.mkdirSync(path.join(fedPath, 'config'), { recursive: true })
          execSync(`openssl genrsa -out ${path.join(fedPath, 'keys', 'anchor-private.pem')} 2048`)
          execSync(`openssl rsa -in ${path.join(fedPath, 'keys', 'anchor-private.pem')} -pubout -out ${path.join(fedPath, 'keys', 'anchor-public.pem')}`)
        } catch(e) {
          console.error('❌ Key generation failed:', e.message); process.exit(1)
        }
        // minimal entity-config
        const now = Math.floor(Date.now()/1000)
        const entityId = `http://localhost:3001`
        const cfg = { sub: entityId, metadata:{}, jwks:{keys:[]} , iat: now }
        fs.writeFileSync(path.join(fedPath,'config','entity-configuration.json'), JSON.stringify(cfg, null,2))
        const reg = loadRegistry(); reg.federations = reg.federations||[]
        if (!reg.federations.includes(name)) { reg.federations.push(name); saveRegistry(reg) }
        console.log(`✅ Federation '${name}' initialized`)
        break
      }
      case 'mcp-protocol': {
        const res = mcpInterface.createMcpProtocolServer(name)
        if (res.success) {
          console.log(`✅ MCP Protocol Server '${name}' on port ${res.port}`)
          mcpInterface.startMcpProtocolServer(name)
        } else console.error(`❌ ${res.message}`)
        break
      }
      case 'mcp': {
        if (!opts.federation) {
          console.error(`❌ --federation required for mcp`); process.exit(1)
        }
        const res = mcpInterface.createMcp(name)
        if (res.success) mcpInterface.startMcp(name)
        else console.error(`❌ ${res.message}`)
        break
      }
      case 'op': {
        // stub: implement createOp in future
        console.error('❌ Operator creation not yet implemented')
        break
      }
      default:
        console.error(`❌ Unknown resource type '${type}'`)
        process.exit(1)
    }
  })

program
  .command('login <provider>')
  .description('Authenticate with an identity provider (e.g., github)')
  .action(provider => {
    registerAuthCommands(program)
    program.parse(['node','fedmgr','login',provider], { from: 'user' })
  })

program
  .command('call <mcp>')
  .option('--provider <p>','Auth provider','local-oidc-op')
  .option('--token <t>','JWT token override')
  .description('Send authenticated request to MCP')
  .action(async (mcp, opts) => {
    try {
      let token = opts.token || getToken(opts.provider)
      if (!token) { console.error(`❌ No token for ${opts.provider}. Run 'fedmgr login ${opts.provider}'`); process.exit(1) }
      const res = await mcpInterface.routeRequest(mcp,{ path:'/api', headers:{ Authorization:`Bearer ${token}` }})
      console.log(`✅ MCP '${mcp}' reply:`, res.data)
    } catch(e) { console.error('❌ MCP call error:', e.message); process.exit(1) }
  })

program
  .command('list')
  .description('List federations, MCPs, protocol servers')
  .action(() => {
    const reg = loadRegistry()
    console.log('📜 Federations:', reg.federations||[])
    console.log('🤖 MCPs:', Object.keys(reg.mcps||{}))
    console.log('🔌 Protocol Servers:', Object.keys(reg.mcpProtocolServers||{}))
  })

program
  .command('stop <mcp>')
  .description('Stop MCP instance')
  .action(mcp => {
    const r = mcpInterface.stopMcp(mcp)
    console.log(r.success ? `✅ Stopped ${mcp}` : `❌ ${r.message}`)
  })

program
  .command('restart <mcp>')
  .description('Restart MCP instance')
  .action(mcp => {
    const r = mcpInterface.restartMcp(mcp)
    if (r.success) console.log(`✅ Restarted ${mcp} on port ${r.port}`)
    else console.error(`❌ ${r.message}`)
  })

program
  .command('distribute <fed>')
  .description('Distribute trust statements')
  .action(async fed => {
    try {
      const r = await mcpInterface.distributeEntityStatements(fed)
      console.log(r.success ? `✅ Distributed from ${fed}` : `❌ ${r.message}`)
      if (r.distributionResults) r.distributionResults.forEach(d => console.log(` - ${d.member}: ${d.success?'OK':d.error}`))
    } catch(e) { console.error('❌ Distribute error:', e.message) }
  })

program
  .command('delete fed <name>')
  .description('Remove federation')
  .action((_,name) => {
    const dir = path.join(FEDMGR_FED_DIR,name)
    if (fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true})
    const reg = loadRegistry(); reg.federations=(reg.federations||[]).filter(f=>f!==name); saveRegistry(reg)
    console.log(`✅ Federation '${name}' deleted`)
  })

// Register auth commands (e.g., login, token storage)
registerAuthCommands(program)

program.parse(process.argv)
