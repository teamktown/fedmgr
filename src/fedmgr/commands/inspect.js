const { spawn } = require('child_process');

function register(program, ctx) {
  program
    .command('inspect <mcp>')
    .option('--cli', 'Run MCP Inspector in CLI mode')
    .option('--inspector-ui-port <port>', 'Port for the MCP Inspector UI (if not CLI)', '6274')
    .option('--inspector-args <args...>', 'Additional arguments/commands for the MCP Inspector executable (e.g., "tools list" or specific flags)')
    .description('Launch MCP Inspector to connect to a running MCP instance')
    .action((mcpName, opts) => {
      const registry = ctx.loadRegistry();
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
