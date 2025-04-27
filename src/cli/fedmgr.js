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

  const reg = loadRegistry() || { federations: [] }
  if (!reg.federations) {
    reg.federations = []
  }
  
  if (!reg.federations.includes(name)) {
    reg.federations.push(name)
    saveRegistry(reg)
  }

  console.log(`✅ Federation '${name}' initialized at ${fedPath}`)
}

/**
 * Reads the federation entity configuration file.
 * @param {string} name - Name of the federation
 * @returns {object | null} The federation configuration object, or null if not found.
 */
function readFederationConfig(name) {
  const fedPath = path.resolve(__dirname, '../../federations', name);
  const entityConfigFile = path.join(fedPath, 'config', 'entity-configuration.json');
  if (fs.existsSync(entityConfigFile)) {
    const content = fs.readFileSync(entityConfigFile, 'utf8');
    return JSON.parse(content);
  }
  return null;
}

/**
 * Writes the federation entity configuration file.
 * @param {string} name - Name of the federation
 * @param {object} config - The federation configuration object
 */
function writeFederationConfig(name, config) {
  const fedPath = path.resolve(__dirname, '../../federations', name);
  const entityConfigFile = path.join(fedPath, 'config', 'entity-configuration.json');
  fs.writeFileSync(entityConfigFile, JSON.stringify(config, null, 2));
}

/**
 * Create a new Operator configuration within a federation
 * @param {string} fedName - Name of the federation
 * @param {string} opName - Name of the Operator
 */
function createOp(fedName, opName) {
  const fedConfig = readFederationConfig(fedName);
  if (!fedConfig) {
    console.error(`❌ Federation '${fedName}' not found.`);
    process.exit(1);
  }

  // Basic operator creation logic - this would be expanded based on spec details
  // For now, just add a placeholder entry or similar to the config
  if (!fedConfig.metadata.operators) {
    fedConfig.metadata.operators = {};
  }

  if (fedConfig.metadata.operators[opName]) {
    console.log(`⚠️ Operator '${opName}' already exists in federation '${fedName}'.`);
    return; // Or prompt for overwrite
  }

  // Generate keys for the operator (simplified)
  const opKeysPath = path.resolve(__dirname, `../../federations/${fedName}/keys/operators`);
  fs.mkdirSync(opKeysPath, { recursive: true });
  execSync(`openssl genrsa -out ${opKeysPath}/${opName}-private.pem 2048`);
  execSync(`openssl rsa -in ${opKeysPath}/${opName}-private.pem -pubout -out ${opKeysPath}/${opName}-public.pem`);

  // Add operator info to federation config (simplified)
  fedConfig.metadata.operators[opName] = {
    name: opName,
    public_key_path: `federations/${fedName}/keys/operators/${opName}-public.pem`
    // More details would be added based on spec
  };

  writeFederationConfig(fedName, fedConfig);
  console.log(`✅ Operator '${opName}' created in federation '${fedName}'.`);
}

/**
 * Add an MCP to a federation (simplified)
 * @param {string} fedName - Name of the federation
 * @param {string} mcpName - Name of the MCP
 */
function addMcpToFederation(fedName, mcpName) {
  const fedConfig = readFederationConfig(fedName);
  if (!fedConfig) {
    console.error(`❌ Federation '${fedName}' not found.`);
    process.exit(1);
  }

  // This is a simplified approach. A real implementation would likely
  // involve more complex interaction, possibly via mcpInterface,
  // to register the MCP's entity ID and metadata with the federation.
  // For now, we'll just add the MCP name to a list in the federation config.
  if (!fedConfig.metadata.associated_mcps) {
    fedConfig.metadata.associated_mcps = [];
  }

  if (fedConfig.metadata.associated_mcps.includes(mcpName)) {
    console.log(`⚠️ MCP '${mcpName}' is already associated with federation '${fedName}'.`);
    return;
  }

  fedConfig.metadata.associated_mcps.push(mcpName);
  writeFederationConfig(fedName, fedConfig);
  console.log(`✅ MCP '${mcpName}' associated with federation '${fedName}'.`);
}

/**
 * Delete a federation
 * @param {string} name - Name of the federation
 */
function deleteFederation(name) {
  const fedPath = path.resolve(__dirname, '../../federations', name);

  if (!fs.existsSync(fedPath)) {
    console.log(`⚠️ Federation '${name}' not found at ${fedPath}`);
    return;
  }

  // Remove the federation directory
  fs.rmSync(fedPath, { recursive: true, force: true });
  console.log(`✅ Federation '${name}' directory removed.`);

  // Update the registry
  const reg = loadRegistry() || { federations: [] };
  if (reg.federations) {
    reg.federations = reg.federations.filter(f => f !== name);
    saveRegistry(reg);
    console.log(`✅ Federation '${name}' removed from registry.`);
  } else {
     console.log(`⚠️ Federation '${name}' not found in registry.`);
  }

  console.log(`✅ Federation '${name}' deleted.`);
}


program
  .name('fedmgr')
  .description('CLI to manage federated MCPs and trust environments')
  .version('0.3.0')

program
  .command('create')
  .description('Create resources: federation, operator, MCP instance, or MCP Protocol server')
  .argument('<type>', 'resource type: fed, op, mcp, or mcp-protocol')
  .argument('<name>', 'resource name (e.g., alpha, OperatorA, MCPA)')
  .option('--federation <fed_name>', 'Specify the federation for op or mcp types')
  .action((type, name, options) => {
    if (type === 'fed') {
      bootstrapFederation(name);
    } else if (type === 'op') {
      if (!options.federation) {
        console.error(`❌ Option '--federation' is required for type 'op'.`);
        program.help();
      } else {
        createOp(options.federation, name);
      }
    } else if (type === 'mcp') {
       if (!options.federation) {
        console.error(`❌ Option '--federation' is required for type 'mcp'.`);
        program.help();
      } else {
        addMcpToFederation(options.federation, name);
      }
    } else if (type === 'mcp-protocol') {
      createMcpProtocolServer(name);
    } else {
      console.error(`❌ Unknown type '${type}'`);
      program.help();
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
  .command('delete')
  .description('Delete resources: federation')
  .argument('<type>', 'resource type: fed')
  .argument('<name>', 'resource name (e.g., alpha)')
  .action((type, name) => {
    if (type === 'fed') {
      deleteFederation(name);
    } else {
      console.error(`❌ Unknown type '${type}' for delete command.`);
      program.help();
    }
  });

program
  .command('help')
  .description('Outputs trust metadata and connection info (basic help)')
  .action(() => {
    program.help(); // Use commander's built-in help for now
    // TODO: Implement more detailed help output as per spec if needed
  });

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
