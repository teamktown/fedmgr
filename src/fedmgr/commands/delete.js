const path = require('path');
const fs = require('fs');

function register(program, ctx) {
  program
    .command('delete fed <name>')
    .description('Remove federation')
    .action((_, name) => {
      const dir = path.join(ctx.FEDMGR_FED_DIR, name);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const reg = ctx.loadRegistry();
      reg.federations = (reg.federations || []).filter((f) => f !== name);
      ctx.saveRegistry(reg);
      console.log(`✅ Federation '${name}' deleted`);
    });
}

module.exports = register;
