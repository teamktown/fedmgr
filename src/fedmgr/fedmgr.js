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
const configManager = require('./config-manager')
const registerCreate = require('./commands/create')
const registerList = require('./commands/list')
const registerStop = require('./commands/stop')
const registerRestart = require('./commands/restart')
const registerDistribute = require('./commands/distribute')
const registerDelete = require('./commands/delete')
const registerInspect = require('./commands/inspect')
const registerKeys = require('./commands/keys')

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

  const mcpInstancesDir = path.join(FEDMGR_HOME, 'mcp_instances');
  const mcpProtocolServersDir = path.join(FEDMGR_HOME, 'mcp_protocol_servers');
  
  mcpInterface = new MCPInterface({
    registryPath: REGISTRY_PATH,
    mcpInstancesDir: mcpInstancesDir,
    mcpProtocolServersDir: mcpProtocolServersDir
  })
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
    return configManager.loadRegistry(REGISTRY_PATH)
  } catch (e) {
    console.error('❌ Failed to load registry:', e.message)
    console.error(`   Run 'fedmgr init --fix' to repair your configuration`)
    process.exit(1)
  }
}

function saveRegistry(reg) {
  try {
    mcpInterface.registry = reg
    configManager.saveRegistry(REGISTRY_PATH, reg)
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

const context = {
  FEDMGR_FED_DIR,
  ensureDirectoryExists,
  loadRegistry,
  saveRegistry,
  mcpInterface,
}

registerCreate(program, context)
registerList(program, context)
registerStop(program, context)
registerRestart(program, context)
registerDistribute(program, context)
registerDelete(program, context)
registerInspect(program, context)
registerKeys(program, context)

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
// Register auth commands (e.g., login, token storage)
registerAuthCommands(program)

program.parse(process.argv)
