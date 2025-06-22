async function action(fed, ctx) {
  try {
    const r = await ctx.mcpInterface.distributeEntityStatements(fed);
    console.log(r.success ? `✅ Distributed from ${fed}` : `❌ ${r.message}`);
    if (r.distributionResults)
      r.distributionResults.forEach((d) =>
        console.log(` - ${d.member}: ${d.success ? 'OK' : d.error}`)
      );
  } catch (e) {
    console.error('❌ Distribute error:', e.message);
  }
}

function register(program, ctx) {
  program
    .command('distribute <fed>')
    .description('Distribute trust statements')
    .action((fed) => action(fed, ctx));
}

module.exports = register;
