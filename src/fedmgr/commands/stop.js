function register(program, ctx) {
  program
    .command('stop <mcp>')
    .description('Stop MCP instance')
    .action((mcp) => {
      const r = ctx.mcpInterface.stopMcp(mcp);
      console.log(r.success ? `✅ Stopped ${mcp}` : `❌ ${r.message}`);
    });
}

module.exports = register;
