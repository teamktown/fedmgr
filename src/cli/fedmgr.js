#!/usr/bin/env node

const { Command } = require('commander')
const { execSync, spawnSync, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const MCPInterface = require('../server/mcp-interface')

const program = new Command()
const registryPath = path.resolve(__dirname, '../../data/registry.json')
const mcpInterface = new MCPInterface(registryPath)

// Helper to load registry state
function loadRegistry() {
  return mcpInterface.loadRegistry();
}

// Save updated registry
function saveRegistry(data) {
  mcpInterface.registry = data;
  mcpInterface.saveRegistry();
}

/**
 * Create a new MCP Protocol server
 * @param {string} name - Name of the MCP Protocol server
 */
function createMcpProtocolServer(name) {
  // Use the MCP Interface to create and start the MCP Protocol server
  const result = mcpInterface.createMcpProtocolServer(name);
  
  if (result.success) {
    console.log(`✅ MCP Protocol Server '${name}' created on port ${result.port}`);
    // Start the MCP Protocol server
    mcpInterface.startMcpProtocolServer(name);
  } else {
    console.error(`❌ ${result.message}`);
  }
}

/**
 * Create a new MCP instance
 * @param {string} name - Name of the MCP instance
 */
function createMcp(name) {
  // Use the MCP Interface to create and start the MCP
  const result = mcpInterface.createMcp(name);
  
  if (result.success) {
    // Start the MCP instance
    mcpInterface.startMcp(name);
  }
}

/**
 * Bootstrap a new federation
 * @param {string} name - Name of the federation
 */
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

  const reg = loadRegistry()
  if (!reg.federations.includes(name)) {
    reg.federations.push(name)
    saveRegistry(reg)
  }

  console.log(`✅ Federation '${name}' initialized at ${fedPath}`)
}

program
  .name('fedmgr')
  .description('CLI to manage federated MCPs and trust environments')
  .version('0.3.0')

program
  .command('create')
  .description('Create resources: federation, MCP instance, or MCP Protocol server')
  .argument('<type>', 'resource type: fed, mcp, or mcp-protocol')
  .argument('<name>', 'resource name (e.g., alpha or MCPA)')
  .action((type, name) => {
    if (type === 'fed') {
      bootstrapFederation(name)
    } else if (type === 'mcp') {
      createMcp(name)
    } else if (type === 'mcp-protocol') {
      createMcpProtocolServer(name)
    } else {
      console.error(`❌ Unknown type '${type}'`)
    }
  })

program
  .command('list')
  .description('List federations, registered MCP instances, and MCP Protocol servers')
  .action(() => {
    const federations = mcpInterface.getAllFederations();
    const mcps = mcpInterface.getAllMcps();
    const mcpProtocolServers = mcpInterface.getAllMcpProtocolServers();
    
    console.log(`\n📜 Federations:`)
    federations.forEach(f => console.log(`  - ${f}`))
    
    console.log(`\n🤖 MCP Instances:`)
    Object.entries(mcps).forEach(([name, port]) => {
      console.log(`  - ${name} (http://localhost:${port})`)
    })
    
    console.log(`\n🔌 MCP Protocol Servers:`)
    Object.entries(mcpProtocolServers).forEach(([name, port]) => {
      console.log(`  - ${name} (http://localhost:${port})`)
    })
    
    console.log()
  })

program
  .command('call')
  .description('Send a JWT-authenticated request to an MCP')
  .argument('<mcp>', 'target MCP name')
  .requiredOption('--token <jwt>', 'JWT token to use')
  .action(async (mcp, options) => {
    try {
      // Use the MCP Interface to route the request
      const response = await mcpInterface.routeRequest(mcp, {
        path: '/api',
        headers: {
          Authorization: `Bearer ${options.token}`
        }
      });
      
      console.log(`✅ Response from ${mcp}: ${response.data}`);
    } catch (error) {
      console.error(`❌ MCP call failed:`, error.message);
      process.exit(1);
    }
  })

// Add commands for MCP lifecycle management
program
  .command('stop')
  .description('Stop a running MCP instance')
  .argument('<mcp>', 'MCP name to stop')
  .action((mcp) => {
    const result = mcpInterface.stopMcp(mcp);
    if (result.success) {
      console.log(`✅ MCP '${mcp}' stopped successfully`);
    } else {
      console.error(`❌ ${result.message}`);
    }
  });

program
  .command('restart')
  .description('Restart a running MCP instance')
  .argument('<mcp>', 'MCP name to restart')
  .action((mcp) => {
    const result = mcpInterface.restartMcp(mcp);
    if (result.success) {
      console.log(`✅ MCP '${mcp}' restarted successfully on port ${result.port}`);
    } else {
      console.error(`❌ ${result.message}`);
    }
  });

program
  .command('distribute')
  .description('Distribute entity statements from Federation Admin to MCPs')
  .argument('<federation>', 'Federation name')
  .action(async (federation) => {
    try {
      const result = await mcpInterface.distributeEntityStatements(federation);
      if (result.success) {
        console.log(`✅ Entity statements distributed from federation '${federation}'`);
        console.log(`📡 Distribution results:`);
        result.distributionResults.forEach(r => {
          console.log(`  - ${r.name}: ${r.success ? '✅ Success' : `❌ Failed: ${r.error}`}`);
        });
      } else {
        console.error(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error(`❌ Distribution failed:`, error.message);
    }
  });

// Add commands for MCP Protocol server management
program
  .command('mcp-protocol')
  .description('Manage MCP Protocol servers')
  .argument('<action>', 'Action to perform: start, stop, restart')
  .argument('<name>', 'MCP Protocol server name')
  .action((action, name) => {
    if (action === 'start') {
      const result = mcpInterface.startMcpProtocolServer(name);
      if (result.success) {
        console.log(`✅ MCP Protocol Server '${name}' started successfully on port ${result.port}`);
      } else {
        console.error(`❌ ${result.message}`);
      }
    }
    else if (action === 'stop') {
      const result = mcpInterface.stopMcpProtocolServer(name);
      if (result.success) {
        console.log(`✅ MCP Protocol Server '${name}' stopped successfully`);
      } else {
        console.error(`❌ ${result.message}`);
      }
    }
    else if (action === 'restart') {
      const result = mcpInterface.restartMcpProtocolServer(name);
      if (result.success) {
        console.log(`✅ MCP Protocol Server '${name}' restarted successfully`);
      } else {
        console.error(`❌ ${result.message}`);
      }
    }
    else {
      console.error(`❌ Unknown action '${action}'`);
    }
  });

program.parse()
