#!/usr/bin/env node

process.removeAllListeners('warning');
process.env.NODE_NO_WARNINGS = '1';

const { Command } = require('commander')
const { execSync, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
require('dotenv').config()
const MCPInterface = require('./server/mcp-interface')
const { registerAuthCommands, getToken } = require('./auth-commands')
const { initializeWorkspace, repairWorkspace } = require('./init-workspace')

const program = new Command()

// Environment and paths - with better error handling
let FEDMGR_HOME, FEDMGR_FED_DIR, REGISTRY_PATH, mcpInterface

try {
  FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../..')
  FEDMGR_FED_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations')
  REGISTRY_PATH = process.env.FEDMGR_FED_REG_FILE || path.join(FEDMGR_HOME, 'data', 'fed-reg', 'registry.json')

  console.log(`🔧 FEDMGR_HOME: ${FEDMGR_HOME}`)
  console.log(`🔧 FEDMGR_FED_DIR: ${FEDMGR_FED_DIR}`)
  console.log(`🔧 REGISTRY_PATH: ${REGISTRY_PATH}`)

  // Check if registry path points to a directory (common misconfiguration)
  if (fs.existsSync(REGISTRY_PATH) && fs.statSync(REGISTRY_PATH).isDirectory()) {
    console.warn(`⚠️  Registry path points to directory, not file: ${REGISTRY_PATH}`)
    console.warn(`   Run 'fedmgr init --fix' to repair this configuration`)
    REGISTRY_PATH = path.join(REGISTRY_PATH, 'registry.json')
    console.log(`🔧 Using corrected registry path: ${REGISTRY_PATH}`)
  }

  mcpInterface = new MCPInterface(REGISTRY_PATH)
} catch (error) {
  console.error(`❌ Configuration error: ${error.message}`)
  console.error(`   Run 'fedmgr init' to set up your workspace`)
  process.exit(1)
}

// Ensure directories exist
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log(`📁 Creating directory: ${dirPath}`)
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

// Helpers
function loadRegistry() {
  try {
    return mcpInterface.loadRegistry()
  } catch (e) {
    console.error('❌ Failed to load registry:', e.message)
    console.error(`   Run 'fedmgr init --fix' to repair your configuration`)
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
program
  .name('fedmgr')
  .description('Manage federated MCPs & trust environments')
  .version('0.3.0')

// Init command - NEW
program
  .command('init')
  .option('--fix', 'Repair existing configuration issues')
  .option('--force', 'Overwrite existing configuration')
  .option('--workspace <path>', 'Specify workspace directory (default: current directory)')
  .description('Initialize fedmgr workspace with proper directory structure and configuration')
  .action(async (opts) => {
    try {
      const workspacePath = opts.workspace ? path.resolve(opts.workspace) : process.cwd()
      
      if (opts.fix) {
        console.log('🔧 Repairing existing fedmgr workspace...')
        const result = await repairWorkspace(workspacePath, opts)
        if (result.success) {
          console.log('✅ Workspace repair completed successfully')
          console.log('📋 Summary of changes:')
          result.changes.forEach(change => console.log(`   - ${change}`))
          console.log('\n�� You can now run fedmgr commands')
        } else {
          console.error('❌ Workspace repair failed:', result.error)
          process.exit(1)
        }
      } else {
        console.log('🚀 Initializing new fedmgr workspace...')
        const result = await initializeWorkspace(workspacePath, opts)
        if (result.success) {
          console.log('✅ Workspace initialization completed successfully')
          console.log('📋 Created:')
          result.created.forEach(item => console.log(`   - ${item}`))
          console.log('\n🚀 Next steps:')
          console.log('   1. Review the generated .env file')
          console.log('   2. Run: fedmgr create fed my-federation')
          console.log('   3. Run: fedmgr list')
        } else {
          console.error('❌ Workspace initialization failed:', result.error)
          process.exit(1)
        }
      }
    } catch (error) {
      console.error('❌ Init command failed:', error.message)
      process.exit(1)
    }
  })

program
  .command('create <type> <name>')
  .option('--federation <fed>', 'Federation name')
  .description('Create resources: fed, op, mcp, mcp-protocol')
  .action((type, name, opts) => {
    switch (type) {
      case 'fed': {
        const fedPath = path.join(FEDMGR_FED_DIR, name)
        const keysPath = path.join(fedPath, 'keys')
        const configPath = path.join(fedPath, 'config')
        const entityConfigFile = path.join(configPath, 'entity-configuration.json')
        const privateKeyFile = path.join(keysPath, 'anchor-private.pem')
        const publicKeyFile = path.join(keysPath, 'anchor-public.pem')
        
        if (fs.existsSync(entityConfigFile)) {
          console.log(`⚠️ Federation '${name}' exists`)
          return
        }
        
        try {
          // Ensure directories exist first
          console.log(`📁 Creating federation directories for '${name}'...`)
          ensureDirectoryExists(keysPath)
          ensureDirectoryExists(configPath)
          
          // Generate keys with absolute paths
          console.log(`🔑 Generating private key: ${privateKeyFile}`)
          execSync(`openssl genrsa -out "${privateKeyFile}" 2048`, { stdio: 'inherit' })
          
          console.log(`🔑 Generating public key: ${publicKeyFile}`)
          execSync(`openssl rsa -in "${privateKeyFile}" -pubout -out "${publicKeyFile}"`, { stdio: 'inherit' })
          
          console.log(`✅ Keys generated successfully`)
        } catch (e) {
          console.error('❌ Key generation failed:', e.message)
          console.error('Command output:', e.stdout?.toString())
          console.error('Command error:', e.stderr?.toString())
          process.exit(1)
        }
        
        // Create minimal entity-config
        const now = Math.floor(Date.now() / 1000)
        const entityId = `http://localhost:3001`
        const cfg = { 
          sub: entityId, 
          metadata: {
            federation_entity: {
              organization_name: `Federation ${name}`,
              federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
              federation_resolve_endpoint: `${entityId}/resolve`,
              federation_trust_mark_status_endpoint: `${entityId}/trust-mark-status`
            }
          }, 
          jwks: { keys: [] }, 
          iat: now 
        }
        
        console.log(`📝 Writing entity configuration: ${entityConfigFile}`)
        fs.writeFileSync(entityConfigFile, JSON.stringify(cfg, null, 2))
        
        const reg = loadRegistry()
        reg.federations = reg.federations || []
        if (!reg.federations.includes(name)) {
          reg.federations.push(name)
          saveRegistry(reg)
        }
        console.log(`✅ Federation '${name}' initialized at ${fedPath}`)
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
          console.error(`❌ --federation required for mcp`)
          process.exit(1)
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
  .action((provider) => {
    registerAuthCommands(program)
    program.parse(['node', 'fedmgr', 'login', provider], { from: 'user' })
  })

program
  .command('call <mcp>')
  .option('--provider <p>', 'Auth provider', 'local-oidc-op')
  .option('--token <t>', 'JWT token override')
  .description('Send authenticated request to MCP')
  .action(async (mcp, opts) => {
    try {
      let token = opts.token || getToken(opts.provider)
      if (!token) {
        console.error(
          `❌ No token for ${opts.provider}. Run 'fedmgr login ${opts.provider}'`,
        )
        process.exit(1)
      }
      const res = await mcpInterface.routeRequest(mcp, {
        path: '/api',
        headers: { Authorization: `Bearer ${token}` },
      })
      console.log(`✅ MCP '${mcp}' reply:`, res.data)
    } catch (e) {
      console.error('❌ MCP call error:', e.message)
      process.exit(1)
    }
  })

program
  .command('list')
  .description('List federations, MCPs, protocol servers')
  .action(() => {
    const reg = loadRegistry()
    console.log('📜 Federations:', reg.federations || [])
    console.log('🤖 MCPs:', Object.keys(reg.mcps || {}))
    console.log(
      '🔌 Protocol Servers:',
      Object.keys(reg.mcpProtocolServers || {}),
    )
  })

program
  .command('stop <mcp>')
  .description('Stop MCP instance')
  .action((mcp) => {
    const r = mcpInterface.stopMcp(mcp)
    console.log(r.success ? `✅ Stopped ${mcp}` : `❌ ${r.message}`)
  })

program
  .command('restart <mcp>')
  .description('Restart MCP instance')
  .action((mcp) => {
    const r = mcpInterface.restartMcp(mcp)
    if (r.success) console.log(`✅ Restarted ${mcp} on port ${r.port}`)
    else console.error(`❌ ${r.message}`)
  })

program
  .command('distribute <fed>')
  .description('Distribute trust statements')
  .action(async (fed) => {
    try {
      const r = await mcpInterface.distributeEntityStatements(fed)
      console.log(r.success ? `✅ Distributed from ${fed}` : `❌ ${r.message}`)
      if (r.distributionResults)
        r.distributionResults.forEach((d) =>
          console.log(` - ${d.member}: ${d.success ? 'OK' : d.error}`),
        )
    } catch (e) {
      console.error('❌ Distribute error:', e.message)
    }
  })

program
  .command('delete fed <name>')
  .description('Remove federation')
  .action((_, name) => {
    const dir = path.join(FEDMGR_FED_DIR, name)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    const reg = loadRegistry()
    reg.federations = (reg.federations || []).filter((f) => f !== name)
    saveRegistry(reg)
    console.log(`✅ Federation '${name}' deleted`)
  })

program
  .command('inspect <mcp>')
  .option('--cli', 'Run MCP Inspector in CLI mode')
  .option(
    '--inspector-ui-port <port>',
    'Port for the MCP Inspector UI (if not CLI)',
    '6274',
  )
  .option(
    '--inspector-args <args...>',
    'Additional arguments/commands for the MCP Inspector executable (e.g., "tools list" or specific flags)',
  )
  .description('Launch MCP Inspector to connect to a running MCP instance')
  .action((mcpName, opts) => {
    const registry = loadRegistry()
    const mcpPort = registry.mcps?.[mcpName] || registry.mcpProtocolServers?.[mcpName]

    if (!mcpPort) {
      console.error(
        `❌ MCP instance '${mcpName}' not found or its port is not defined in registry.`,
      )
      console.error(
        `   Available MCPs: ${JSON.stringify(registry.mcps)}`,
      )
      console.error(
        `   Available Protocol Servers: ${JSON.stringify(registry.mcpProtocolServers)}`,
      )
      process.exit(1)
    }

    const mcpUrl = `http://localhost:${mcpPort}`
    const inspectorCommand = 'npx'
    let finalInspectorArgs = ['@modelcontextprotocol/inspector']
    const inspectorCliCommands = []
    const envVars = { ...process.env }

    if (opts.cli) {
      finalInspectorArgs.push('--cli')
      if (opts.inspectorArgs && opts.inspectorArgs.length > 0) {
        inspectorCliCommands.push(...opts.inspectorArgs)
      }
    } else {
      // For UI mode, inspectorArgs could be flags for the inspector itself (less common)
      if (opts.inspectorArgs && opts.inspectorArgs.length > 0) {
        finalInspectorArgs.push(...opts.inspectorArgs)
      }
      if (opts.inspectorUiPort !== '6274') {
        envVars.CLIENT_PORT = opts.inspectorUiPort
        console.log(
          `ℹ️  Setting CLIENT_PORT=${opts.inspectorUiPort} for Inspector UI.`,
        )
      }
    }

    // Add the target MCP URL
    finalInspectorArgs.push(mcpUrl)

    // Add CLI commands after the URL
    if (opts.cli && inspectorCliCommands.length > 0) {
      finalInspectorArgs.push(...inspectorCliCommands)
    }

    console.log(
      `🚀 Launching MCP Inspector for MCP '${mcpName}' at ${mcpUrl}`,
    )
    console.log(
      `   Inspector command: ${inspectorCommand} ${finalInspectorArgs.join(' ')}`,
    )
    if (!opts.cli) {
      console.log(
        `   Inspector UI should be available at http://localhost:${opts.inspectorUiPort}`,
      )
      console.log(
        `   Note: If fedmgr is running in Docker, ensure port ${opts.inspectorUiPort} (CLIENT_PORT for inspector) is mapped from the container.`,
      )
    }

    const inspectorProcess = spawn(inspectorCommand, finalInspectorArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32', // Use shell on Windows for npx compatibility
      env: envVars,
    })

    inspectorProcess.on('error', (err) => {
      console.error(`❌ Failed to start MCP Inspector: ${err.message}`)
      if (err.message.includes('ENOENT') && inspectorCommand === 'npx') {
        console.error(
          '💡 Make sure Node.js and npx are installed and in your PATH.',
        )
      } else if (err.message.includes('ENOENT')) {
        console.error(
          `💡 Command not found: ${inspectorCommand}. Ensure it's installed and in PATH.`,
        )
      }
      process.exit(1)
    })

    inspectorProcess.on('exit', (code, signal) => {
      if (signal) {
        console.log(`👋 MCP Inspector process was killed with signal ${signal}`)
      } else {
        console.log(`👋 MCP Inspector exited with code ${code}`)
      }
    })
  })

// Register auth commands (e.g., login, token storage)
registerAuthCommands(program)

program.parse(process.argv)
