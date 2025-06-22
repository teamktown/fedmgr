function register(program, ctx) {
  program
    .command('restart <mcp>')
    .description('Restart MCP instance')
    .action((mcp) => {
      const r = ctx.mcpInterface.restartMcp(mcp);
      if (r.success) console.log(`✅ Restarted ${mcp} on port ${r.port}`);
      else console.error(`❌ ${r.message}`);
    });
}

module.exports = register;
