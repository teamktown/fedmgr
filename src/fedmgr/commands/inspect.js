const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function register(program, ctx) {
  program
    .command('inspect <typeOrName> [name]')
    .option('--cli', 'Run MCP Inspector in CLI mode')
    .option('--inspector-ui-port <port>', 'Port for the MCP Inspector UI (if not CLI)', '6274')
    .option('--inspector-args <args...>', 'Additional arguments/commands for the MCP Inspector executable (e.g., "tools list" or specific flags)')
    .description('Inspect federation or MCP entity configuration, or launch MCP Inspector')
    .action((typeOrName, name, opts) => {
      const registry = ctx.loadRegistry();

      // Handle 'inspect fed <fedname>' - show federation entity configuration
      if (typeOrName === 'fed' && name) {
        const fedPath = path.join(ctx.FEDMGR_FED_DIR, name);
        const configFile = path.join(fedPath, 'config', 'entity-configuration.json');

        if (!fs.existsSync(fedPath)) {
          console.error(`❌ Federation '${name}' not found at ${fedPath}`);
          process.exit(1);
        }

        console.log(`🔍 Federation: ${name}`);
        console.log(`   Path: ${fedPath}`);

        if (fs.existsSync(configFile)) {
          const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
          console.log(`   Entity ID: ${config.sub}`);
          if (config.metadata && config.metadata.federation_entity) {
            const fe = config.metadata.federation_entity;
            if (fe.organization_name) console.log(`   Organization: ${fe.organization_name}`);
            if (fe.federation_fetch_endpoint) console.log(`   Fetch endpoint: ${fe.federation_fetch_endpoint}`);
          }
        }
        return;
      }

      // Handle 'inspect mcp <mcpname>' - show MCP entity configuration
      if (typeOrName === 'mcp' && name) {
        const mcpPort = registry.mcps?.[name];

        if (mcpPort === undefined) {
          console.error(`❌ MCP '${name}' not found in registry.`);
          console.error(`   Available MCPs: ${JSON.stringify(registry.mcps)}`);
          process.exit(1);
        }

        const mcpInstancesDir = ctx.mcpInterface ? ctx.mcpInterface.mcpInstancesDir : null;
        console.log(`🔍 MCP: ${name}`);
        console.log(`   Port: ${mcpPort}`);

        if (mcpInstancesDir) {
          const configFile = path.join(mcpInstancesDir, name, 'config', 'entity-configuration.json');
          if (fs.existsSync(configFile)) {
            const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            console.log(`   Entity ID: ${config.sub}`);
          }
        }
        return;
      }

      // Backward compat: 'inspect <mcpName>' - launch MCP Inspector
      const mcpName = typeOrName;
      const mcpPort = registry.mcps?.[mcpName] || registry.mcpProtocolServers?.[mcpName];

      if (!mcpPort) {
        console.error(`❌ MCP instance '${mcpName}' not found or its port is not defined in registry.`);
        console.error(`   Available MCPs: ${JSON.stringify(registry.mcps)}`);
        console.error(`   Available Protocol Servers: ${JSON.stringify(registry.mcpProtocolServers)}`);
        process.exit(1);
      }

      const mcpUrl = `http://localhost:${mcpPort}`;
      const inspectorCommand = 'npx';
      let finalInspectorArgs = ['@modelcontextprotocol/inspector'];
      const inspectorCliCommands = [];
      const envVars = { ...process.env };

      if (opts.cli) {
        finalInspectorArgs.push('--cli');
        if (opts.inspectorArgs && opts.inspectorArgs.length > 0) {
          inspectorCliCommands.push(...opts.inspectorArgs);
        }
      } else {
        if (opts.inspectorArgs && opts.inspectorArgs.length > 0) {
          finalInspectorArgs.push(...opts.inspectorArgs);
        }
        if (opts.inspectorUiPort !== '6274') {
          envVars.CLIENT_PORT = opts.inspectorUiPort;
          console.log(`ℹ️  Setting CLIENT_PORT=${opts.inspectorUiPort} for Inspector UI.`);
        }
      }

      finalInspectorArgs.push(mcpUrl);

      if (opts.cli && inspectorCliCommands.length > 0) {
        finalInspectorArgs.push(...inspectorCliCommands);
      }

      console.log(`🚀 Launching MCP Inspector for MCP '${mcpName}' at ${mcpUrl}`);
      console.log(`   Inspector command: ${inspectorCommand} ${finalInspectorArgs.join(' ')}`);
      if (!opts.cli) {
        console.log(`   Inspector UI should be available at http://localhost:${opts.inspectorUiPort}`);
        console.log(`   Note: If fedmgr is running in Docker, ensure port ${opts.inspectorUiPort} (CLIENT_PORT for inspector) is mapped from the container.`);
      }

      const inspectorProcess = spawn(inspectorCommand, finalInspectorArgs, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: envVars,
      });

      inspectorProcess.on('error', (err) => {
        console.error(`❌ Failed to start MCP Inspector: ${err.message}`);
        if (err.message.includes('ENOENT') && inspectorCommand === 'npx') {
          console.error('💡 Make sure Node.js and npx are installed and in your PATH.');
        } else if (err.message.includes('ENOENT')) {
          console.error(`💡 Command not found: ${inspectorCommand}. Ensure it's installed and in PATH.`);
        }
        process.exit(1);
      });

      inspectorProcess.on('exit', (code, signal) => {
        if (signal) {
          console.log(`👋 MCP Inspector process was killed with signal ${signal}`);
        } else {
          console.log(`👋 MCP Inspector exited with code ${code}`);
        }
      });
    });
}

module.exports = register;
