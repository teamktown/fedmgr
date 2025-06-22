function register(program, ctx) {
  program
    .command('list')
    .description('List federations, MCPs, protocol servers')
    .action(() => {
      const reg = ctx.loadRegistry();
      console.log('📜 Federations:', reg.federations || []);
      console.log('🤖 MCPs:', Object.keys(reg.mcps || {}));
      console.log('🔌 Protocol Servers:', Object.keys(reg.mcpProtocolServers || {}));
    });
}

module.exports = register;
